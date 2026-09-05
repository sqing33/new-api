/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// Shared scheduler for upstream plan-quota queries (GET /api/channel/:id/usage
// and the forced-refresh POST). One store instance is shared by every visible
// channel row. It owns:
//   - a result cache keyed by channel identity (id + key index + settings)
//   - a 30s dedup TTL so remounts/page flips do not refetch
//   - a cooldown after failed fetches so broken channels cannot loop
//   - a FIFO queue with bounded concurrency (max 3 in-flight requests)
//   - cancellation of queued tasks when their row unmounts, plus a stale
//     guard that discards responses of cancelled tasks
// This module is dependency-free on purpose: no React, no axios. The fetcher
// (which must resolve to the API payload `{success, data, message}` — i.e.
// axios' `res.data`), clock and limits are injected so tests drive everything
// deterministically.

export const PLAN_QUOTA_TTL_MS = 30000;
export const PLAN_QUOTA_FAILED_COOLDOWN_MS = 60000;
export const PLAN_QUOTA_MAX_CONCURRENCY = 3;

export const PLAN_QUOTA_STATUS = {
  IDLE: 'idle',
  PENDING: 'pending',
  OK: 'ok',
  ERROR: 'error',
};

const IDLE_ENTRY = Object.freeze({
  status: PLAN_QUOTA_STATUS.IDLE,
  loading: false,
  data: null,
  error: null,
  fetchedAt: 0,
  failedAt: 0,
  cacheHit: false,
});

// Cache key covers everything that can change the upstream answer: channel
// id, selected key index, channel type, base URL, the raw settings JSON
// (preset binding / credential mode live there) and a cheap key-version
// fingerprint (multi-key size + per-key status list).
export const planQuotaCacheKey = ({
  id,
  keyIndex,
  type,
  baseUrl,
  settings,
  keyVersion,
}) =>
  [
    id ?? '',
    keyIndex ?? '',
    type ?? '',
    baseUrl ?? '',
    settings ?? '',
    keyVersion ?? '',
  ].join('\u0000');

// Best-effort client fingerprint of "which keys does this channel have now".
// The raw keys are never available client-side, so multi-key status metadata
// is the closest stable proxy.
export const planQuotaKeyVersion = (record) => {
  const info = record?.channel_info;
  if (info?.is_multi_key) {
    return JSON.stringify([
      Number(info.multi_key_size) || 0,
      info.multi_key_status_list ?? {},
    ]);
  }
  return '';
};

export const planQuotaRequestArgs = (record, keyIndex) => ({
  channelId: record?.id,
  keyIndex: keyIndex ?? null,
  type: record?.type,
  baseUrl: record?.base_url ?? '',
  settings: record?.settings ?? '',
  keyVersion: planQuotaKeyVersion(record),
});

export const createPlanQuotaStore = ({
  fetcher,
  now = () => Date.now(),
  ttlMs = PLAN_QUOTA_TTL_MS,
  failedCooldownMs = PLAN_QUOTA_FAILED_COOLDOWN_MS,
  maxConcurrency = PLAN_QUOTA_MAX_CONCURRENCY,
} = {}) => {
  const entries = new Map();
  const tasks = new Map();
  const queue = [];
  let running = 0;
  const listeners = new Set();

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const getSnapshot = (cacheKey) => entries.get(cacheKey) || IDLE_ENTRY;

  const setEntry = (cacheKey, patch) => {
    entries.set(cacheKey, { ...getSnapshot(cacheKey), ...patch });
    notify();
  };

  const runTask = async (task) => {
    setEntry(task.cacheKey, {
      status: PLAN_QUOTA_STATUS.PENDING,
      loading: true,
      error: null,
    });
    let payload;
    try {
      payload = (await task.execute(task.signal)) || { success: false };
    } catch (error) {
      if (task.cancelled) return;
      setEntry(task.cacheKey, {
        status: PLAN_QUOTA_STATUS.ERROR,
        loading: false,
        data: null,
        error: 'Failed to fetch plan usage',
        fetchedAt: now(),
        failedAt: now(),
        cacheHit: false,
      });
      return;
    }
    if (task.cancelled) return;
    const ts = now();
    if (payload.success) {
      setEntry(task.cacheKey, {
        status: PLAN_QUOTA_STATUS.OK,
        loading: false,
        data: payload.data ?? null,
        error: null,
        fetchedAt: ts,
        failedAt: 0,
        cacheHit: payload.data?.cache_hit === true,
      });
    } else {
      setEntry(task.cacheKey, {
        status: PLAN_QUOTA_STATUS.ERROR,
        loading: false,
        data: null,
        error: payload.message || 'Failed to fetch plan usage',
        fetchedAt: ts,
        failedAt: ts,
        cacheHit: false,
      });
    }
  };

  const pump = () => {
    while (running < maxConcurrency && queue.length > 0) {
      const task = queue.shift();
      if (task.cancelled) continue;
      running += 1;
      task.execute = () =>
        fetcher({
          channelId: task.channelId,
          keyIndex: task.keyIndex,
          method: task.method,
          signal: task.controller.signal,
        });
      runTask(task).finally(() => {
        running -= 1;
        // Completed (or aborted) tasks must not keep blocking future requests
        // for the same key via the in-flight dedup guard.
        if (tasks.get(task.cacheKey) === task) {
          tasks.delete(task.cacheKey);
        }
        pump();
      });
    }
  };

  const makeTask = ({ cacheKey, channelId, keyIndex, method }) => ({
    cacheKey,
    channelId,
    keyIndex,
    method,
    controller: new AbortController(),
    cancelled: false,
    execute: null,
  });

  const enqueue = (task) => {
    tasks.set(task.cacheKey, task);
    queue.push(task);
    pump();
  };

  // Auto (GET) request issued by a mounted row. Deduped by TTL, by an
  // in-flight task for the same key, and by the failure cooldown.
  const requestAuto = ({ cacheKey, channelId, keyIndex }) => {
    const entry = getSnapshot(cacheKey);
    const ts = now();
    if (entry.status === PLAN_QUOTA_STATUS.OK && ts - entry.fetchedAt < ttlMs) {
      return;
    }
    if (
      entry.status === PLAN_QUOTA_STATUS.ERROR &&
      entry.failedAt > 0 &&
      ts - entry.failedAt < failedCooldownMs
    ) {
      return;
    }
    const existing = tasks.get(cacheKey);
    if (existing && !existing.cancelled) {
      return;
    }
    enqueue(makeTask({ cacheKey, channelId, keyIndex, method: 'GET' }));
  };

  // Forced refresh from the row button: POST bypasses the server TTL cache,
  // so it also bypasses the client dedup/cooldown, but never overlaps with an
  // in-flight task for the same key.
  const requestForce = ({ cacheKey, channelId, keyIndex }) => {
    const entry = getSnapshot(cacheKey);
    if (entry.loading) {
      return;
    }
    enqueue(makeTask({ cacheKey, channelId, keyIndex, method: 'POST' }));
  };

  // A row unmounted (or changed key): drop it from the queue when it has not
  // started, abort it when already running, and discard any late response.
  const release = (cacheKey) => {
    const task = tasks.get(cacheKey);
    if (!task || task.cancelled) {
      return;
    }
    task.cancelled = true;
    task.controller.abort();
    tasks.delete(cacheKey);
    const queueIndex = queue.indexOf(task);
    if (queueIndex >= 0) {
      queue.splice(queueIndex, 1);
    }
    setEntry(cacheKey, {
      loading: false,
      status: getSnapshot(cacheKey).status,
    });
  };

  // Test seam: pre-seed a snapshot without any network activity, so render
  // tests can assert DOM structure for given usage payloads.
  const seedSnapshot = (cacheKey, patch) => {
    setEntry(cacheKey, patch);
  };

  return {
    subscribe,
    getSnapshot,
    requestAuto,
    requestForce,
    release,
    seedSnapshot,
  };
};
