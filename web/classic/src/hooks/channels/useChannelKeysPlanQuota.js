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

import { useEffect, useRef, useState } from 'react';
import { API } from '../../helpers';
import { KEYS_PLAN_QUOTA_TTL_MS } from './planQuotaFormat';

// Module-level 30s cache keyed by `${channelId}:${keyIndexesKey}` so
// remounts and pagination flips within the TTL do not refetch. Entries hold
// both the payload and the failure state so broken channels cool down too.
const responseCache = new Map();

const cacheKeyFor = (channelId, keyIndexesKey) =>
  `${channelId ?? ''}:${keyIndexesKey ?? ''}`;

export const __clearKeysPlanQuotaCacheForTests = () => {
  responseCache.clear();
};

// Read-now fetch used by the cache path; returns the API payload
// (`{success, data, message}`) or null.
const fetchKeysPlanQuota = async (channelId, keyIndexesKey, signal) => {
  const params = {};
  if (keyIndexesKey) {
    params.key_indexes = keyIndexesKey;
  }
  const res = await API.get(`/api/channel/${channelId}/usage/keys`, {
    params,
    skipErrorHandler: true,
    signal,
  });
  return res?.data ?? { success: false };
};

const stateFromPayload = (payload, fetchedAt) => {
  if (payload?.success) {
    return {
      status: 'ok',
      loading: false,
      data: payload.data ?? null,
      error: null,
      fetchedAt,
    };
  }
  return {
    status: 'error',
    loading: false,
    data: null,
    error: payload?.message || 'Failed to fetch plan usage',
    fetchedAt,
  };
};

// Fetch the per-key plan usage of one multi-key channel (GET
// /api/channel/:id/usage/keys). One request per `keyIndexes` identity: the
// fetch happens once when the hook becomes enabled (or when the requested
// indexes change), with no polling. Results are cached module-level for 30s.
// Returns {state}: `state.loading` while in flight, `state.data` carrying the
// ChannelKeysQuotaUsage payload, `state.error` on failure.
export const useChannelKeysPlanQuota = ({ channelId, keyIndexes, enabled }) => {
  const keyIndexesKey = Array.isArray(keyIndexes)
    ? keyIndexes.join(',')
    : keyIndexes || '';
  const [state, setState] = useState(() => {
    const cached = responseCache.get(cacheKeyFor(channelId, keyIndexesKey));
    if (cached && Date.now() - cached.fetchedAt < KEYS_PLAN_QUOTA_TTL_MS) {
      return cached.state;
    }
    return { status: 'idle', loading: false, data: null, error: null };
  });
  const abortRef = useRef(null);

  useEffect(() => {
    if (!enabled || !channelId) {
      return undefined;
    }
    const cacheKey = cacheKeyFor(channelId, keyIndexesKey);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < KEYS_PLAN_QUOTA_TTL_MS) {
      setState(cached.state);
      return undefined;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    let cancelled = false;
    fetchKeysPlanQuota(channelId, keyIndexesKey, controller.signal)
      .then((payload) => {
        if (cancelled) return;
        const next = stateFromPayload(payload, Date.now());
        responseCache.set(cacheKey, { state: next, fetchedAt: next.fetchedAt });
        setState(next);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        const aborted =
          error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED';
        if (aborted) return;
        const next = {
          status: 'error',
          loading: false,
          data: null,
          error: error?.message || 'Failed to fetch plan usage',
          fetchedAt: Date.now(),
        };
        responseCache.set(cacheKey, { state: next, fetchedAt: next.fetchedAt });
        setState(next);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelId, keyIndexesKey]);

  return { state };
};
