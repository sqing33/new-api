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

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { API } from '../../helpers';
import {
  createPlanQuotaStore,
  planQuotaCacheKey,
  planQuotaRequestArgs,
} from './planQuotaStore';

// Module-level store shared by every mounted Plan quota cell. Created lazily
// so tests can import the pure module without dragging axios in.
let sharedStore = null;

const getSharedStore = () => {
  if (!sharedStore) {
    sharedStore = createPlanQuotaStore({
      fetcher: async ({ channelId, keyIndex, method, signal }) => {
        const params = keyIndex == null ? {} : { key_index: keyIndex };
        const config = { params, skipErrorHandler: true, signal };
        const res =
          method === 'POST'
            ? await API.post(`/api/channel/${channelId}/usage`, {}, config)
            : await API.get(`/api/channel/${channelId}/usage`, config);
        // The store consumes the API payload, not the axios wrapper.
        return res?.data ?? { success: false };
      },
    });
  }
  return sharedStore;
};

// Test seam: swap the fetcher of the shared store (used by tests that do not
// render through axios).
export const __setPlanQuotaFetcherForTests = (fetcher) => {
  sharedStore = createPlanQuotaStore({ fetcher });
};

// Test seam: replace the shared store entirely (render tests seed snapshots
// through a store they control). Pass null to restore lazy creation.
export const __setPlanQuotaStoreForTests = (store) => {
  sharedStore = store;
};

// Component-owned view of the shared store for one channel row (+ selected
// key index). The row must be mounted and its column visible for this hook to
// be called at all — callers gate it via `enabled`. No network happens in
// render: the auto GET is scheduled from the effect below.
export const useChannelPlanQuota = ({ record, keyIndex, enabled }) => {
  const store = getSharedStore();

  const args = useMemo(
    () => planQuotaRequestArgs(record, keyIndex),
    [record?.id, keyIndex, record?.type, record?.base_url, record?.settings],
  );
  const cacheKey = planQuotaCacheKey(args);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot(cacheKey),
    () => store.getSnapshot(cacheKey),
  );

  useEffect(() => {
    if (!enabled || !args.channelId) {
      return undefined;
    }
    const identity = {
      cacheKey,
      channelId: args.channelId,
      keyIndex: args.keyIndex,
    };
    store.requestAuto(identity);
    return () => store.release(cacheKey);
  }, [store, enabled, cacheKey, args.channelId, args.keyIndex]);

  const forceRefresh = () => {
    if (!enabled || !args.channelId) {
      return;
    }
    store.requestForce({
      cacheKey,
      channelId: args.channelId,
      keyIndex: args.keyIndex,
    });
  };

  return { state: snapshot, refresh: forceRefresh };
};
