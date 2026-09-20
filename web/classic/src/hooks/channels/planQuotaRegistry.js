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

// Module-level registry of per-channel "plan usage remaining" values for the
// channels-table sort. Plan quota cells report the five-hour window's
// remaining metric of every successfully queried channel here; the table
// toolbar reads the values to reorder the current page client-side.
//
// The reported value is a remaining metric, preferring the absolute
// remaining amount (summed across keys for multi-key channels) and falling
// back to the remaining-percent scale (100 - usedPercent) when the upstream
// only exposes percents. Mixing the two scales in one comparison would be
// wrong, but within one channel type the sources are homogeneous in
// practice, and unknown channels simply keep their relative order at the
// end.
//
// Dependency-free on purpose: no React, no axios — like planQuotaStore.js.

const SORT_WINDOW_NAME = 'five_hour';

const entries = new Map();
const listeners = new Set();
let version = 0;

const notify = () => {
  listeners.forEach((listener) => listener());
};

// Sort metric of one window item: the absolute remaining when finite, else
// the remaining-percent scale derived from `percent`. null when the item
// carries neither.
const sortValueOfItem = (item) => {
  if (typeof item?.remaining === 'number' && Number.isFinite(item.remaining)) {
    return item.remaining;
  }
  const percent = Number(item?.percent);
  if (Number.isFinite(percent)) {
    return Math.max(0, Math.min(100, 100 - percent));
  }
  return null;
};

export const recordChannelSortValue = (channelId, value) => {
  if (channelId == null) return;
  if (value == null || !Number.isFinite(Number(value))) {
    if (entries.has(channelId)) {
      entries.delete(channelId);
      version += 1;
      notify();
    }
    return;
  }
  const numeric = Number(value);
  entries.set(channelId, { value: numeric, updatedAt: Date.now() });
  version += 1;
  notify();
};

export const getChannelSortValue = (channelId) =>
  entries.get(channelId)?.value ?? null;

export const subscribePlanQuotaRegistry = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getPlanQuotaRegistryVersion = () => version;

// Test seam: drop every recorded value.
export const __clearPlanQuotaRegistryForTests = () => {
  entries.clear();
  version += 1;
  notify();
};

// Compute the five-hour remaining metric from a window item list (the same
// shape as PlanQuotaCell snapshots / aggregateKeyWindows output): the
// `five_hour` window when present, else the first window item as fallback.
// null when nothing is usable.
export const planQuotaSortValueFromWindows = (windows) => {
  const items = Array.isArray(windows) ? windows : [];
  if (items.length === 0) return null;
  const window =
    items.find((item) => (item?.name ?? '') === SORT_WINDOW_NAME) || items[0];
  return sortValueOfItem(window);
};
