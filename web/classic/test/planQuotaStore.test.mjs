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

// Deterministic scheduler tests: controlled promises and a fake clock, no
// sleeps. The fetcher resolves to the API payload ({success, data, message}),
// exactly what useChannelPlanQuota's axios fetcher returns via res.data.
// Run with: node --test test/planQuotaStore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlanQuotaStore,
  planQuotaCacheKey,
  planQuotaKeyVersion,
  PLAN_QUOTA_MAX_CONCURRENCY,
  PLAN_QUOTA_STATUS,
} from '../src/hooks/channels/planQuotaStore.js';

// --- test helpers ---------------------------------------------------------

const makeClock = (start = 1000000) => {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
};

// A fetcher whose in-flight requests are resolved/rejected manually.
const makeControlledFetcher = () => {
  const pending = [];
  const fetcher = () =>
    new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  fetcher.pending = pending;
  return fetcher;
};

const identity = (n) => ({
  cacheKey: planQuotaCacheKey({ id: n, keyIndex: null }),
  channelId: n,
  keyIndex: null,
});

const ok = (items = []) => ({
  success: true,
  data: { status: 'ok', items, cache_hit: false },
});
const fail = (message) => ({ success: false, message });

const drain = () => new Promise((resolve) => setImmediate(resolve));

// --- tests ----------------------------------------------------------------

test('in-flight requests are deduplicated per cache key', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  store.requestAuto(identity(1));
  store.requestAuto(identity(1));
  store.requestAuto(identity(1));
  assert.equal(fetcher.pending.length, 1, 'only one request issued');

  fetcher.pending[0].resolve(ok());
  await drain();
  const snap = store.getSnapshot(identity(1).cacheKey);
  assert.equal(snap.status, PLAN_QUOTA_STATUS.OK);
  assert.deepEqual(snap.data.items, []);
});

test('TTL cache suppresses repeated auto requests within 30s', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  const id = identity(7);
  store.requestAuto(id);
  fetcher.pending[0].resolve(ok());
  await drain();

  clock.advance(29999);
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 1, 'TTL hit: no refetch');

  clock.advance(1); // 30s boundary reached
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 2, 'TTL expired: refetches');
});

test('failed requests enter a cooldown that blocks auto retries', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  const id = identity(3);
  store.requestAuto(id);
  fetcher.pending[0].resolve(fail('Rate limited'));
  await drain();
  const snap = store.getSnapshot(id.cacheKey);
  assert.equal(snap.status, PLAN_QUOTA_STATUS.ERROR);
  assert.equal(snap.error, 'Rate limited');

  // Within cooldown: no new request.
  clock.advance(59999);
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 1);

  // After cooldown: retry allowed.
  clock.advance(1);
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 2);
});

test('concurrency is capped at 3 and queued tasks start on completion', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  const ids = [1, 2, 3, 4, 5].map(identity);
  ids.forEach((id) => store.requestAuto(id));
  assert.equal(fetcher.pending.length, PLAN_QUOTA_MAX_CONCURRENCY);

  fetcher.pending[0].resolve(ok());
  await drain();
  assert.equal(fetcher.pending.length, 4, 'queued task started');

  fetcher.pending.forEach((p) => p.resolve(ok()));
  await drain();
  // Finishing those started the last queued task; resolve it too.
  fetcher.pending.forEach((p) => p.resolve(ok()));
  await drain();
  ids.forEach((id) =>
    assert.equal(store.getSnapshot(id.cacheKey).status, PLAN_QUOTA_STATUS.OK),
  );
});

test('release removes queued tasks before they start and aborts running ones', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  const ids = [1, 2, 3, 4].map(identity);
  ids.forEach((id) => store.requestAuto(id));
  assert.equal(fetcher.pending.length, 3);

  // id 4 is still queued; releasing it must never reach the fetcher.
  store.release(ids[3].cacheKey);
  fetcher.pending.forEach((p) => p.resolve(ok()));
  await drain();
  await drain();
  assert.equal(fetcher.pending.length, 3, 'queued task was cancelled');

  // A running task that is released must not write its late response.
  const late = identity(9);
  store.requestAuto(late);
  store.release(late.cacheKey);
  fetcher.pending[3].resolve(ok([{ name: 'five_hour', percent: 42 }]));
  await drain();
  const snap = store.getSnapshot(late.cacheKey);
  assert.equal(snap.data, null, 'stale response discarded');
  assert.equal(snap.loading, false);
});

test('rejected fetch marks the entry as error with cooldown', async () => {
  const clock = makeClock();
  const fetcher = makeControlledFetcher();
  const store = createPlanQuotaStore({ fetcher, now: clock.now });

  const id = identity(11);
  store.requestAuto(id);
  fetcher.pending[0].reject(new Error('network down'));
  await drain();

  const snap = store.getSnapshot(id.cacheKey);
  assert.equal(snap.status, PLAN_QUOTA_STATUS.ERROR);
  assert.equal(snap.error, 'Failed to fetch plan usage');

  clock.advance(59999);
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 1, 'cooldown after rejection');

  clock.advance(1);
  store.requestAuto(id);
  assert.equal(fetcher.pending.length, 2);
});

test('cache key changes when identity inputs change', () => {
  const base = {
    id: 1,
    keyIndex: null,
    type: 1,
    baseUrl: '',
    settings: '',
    keyVersion: '',
  };
  const original = planQuotaCacheKey(base);
  const other = (patch) => planQuotaCacheKey({ ...base, ...patch });
  assert.equal(original, other({}), 'same inputs, same key');
  assert.notEqual(original, other({ keyIndex: 1 }));
  assert.notEqual(
    original,
    other({ settings: '{"quota_query_preset_id":"kimi_coding_plan"}' }),
  );
  assert.notEqual(original, other({ baseUrl: 'https://api.example.com' }));
  assert.notEqual(original, other({ keyVersion: '[2,{}]' }));
});

test('key version fingerprint tracks multi-key metadata only', () => {
  assert.equal(planQuotaKeyVersion({}), '');
  assert.equal(planQuotaKeyVersion({ channel_info: {} }), '');
  const single = planQuotaKeyVersion({
    channel_info: { is_multi_key: false, multi_key_size: 3 },
  });
  assert.equal(single, '', 'single-key channels carry no fingerprint');
  const multi = planQuotaKeyVersion({
    channel_info: { is_multi_key: true, multi_key_size: 3 },
  });
  const multiOtherStatus = planQuotaKeyVersion({
    channel_info: {
      is_multi_key: true,
      multi_key_size: 3,
      multi_key_status_list: { 1: 2 },
    },
  });
  const multiBigger = planQuotaKeyVersion({
    channel_info: { is_multi_key: true, multi_key_size: 4 },
  });
  assert.notEqual(multi, multiOtherStatus, 'status list change bumps version');
  assert.notEqual(multi, multiBigger, 'key count change bumps version');
});
