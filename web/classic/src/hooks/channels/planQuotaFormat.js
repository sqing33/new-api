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

// Pure display helpers for the Plan quota column. Dependency-free and JSX-free
// so node tests can exercise the percentage semantics directly. The upstream
// contract (service/quota_query.go): `percent` is the used percentage;
// `used`/`remaining` are ABSOLUTE amounts qualified by `unit` ("usd",
// "quota") — they are never percentages and must never be converted into one.

export const clampPercent = (value) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
};

export const pickStrokeColor = (percent) => {
  const p = clampPercent(percent);
  if (p >= 95) return '#ef4444';
  if (p >= 80) return '#f59e0b';
  return '#3b82f6';
};

export const formatAmount = (value) => {
  // A missing amount must render as "-", never as a fabricated "0"
  // (Number(null) and Number('') are both 0).
  if (value == null || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 1000000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

export const formatResetTime = (reset) => {
  if (!reset) return null;
  const date = new Date(reset);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
};

export const getDisplayText = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

export const WINDOW_NAME_KEYS = {
  five_hour: '5-hour window',
  weekly_limit: 'Weekly window',
  monthly: 'Monthly window',
  daily: 'Daily window',
  quota_window: 'Quota window',
};

export const windowTitle = (name, t) => {
  const key = WINDOW_NAME_KEYS[name];
  return key ? t(key) : getDisplayText(name) || t('Quota window');
};

export const STATUS_TAG_KEYS = {
  ready: 'Ready to query',
  needs_configuration: 'Needs configuration',
  unresolved: 'Plan not recognized',
  unsupported: 'Preset does not support query',
  disabled: 'No preset bound',
  authentication_error: 'Authentication failed',
  rate_limited: 'Rate limited',
  timeout: 'Query timed out',
  network_error: 'Network error',
  upstream_error: 'Upstream returned an error',
  response_too_large: 'Response too large',
  invalid_response: 'Failed to parse response',
  cancelled: 'Cancelled',
};

// Localized text for a usage status. The store payload is only rendered
// through this helper when the cell has a problem to report; `ok` is
// suppressed by the cell and never reaches a tag, so it intentionally has
// no text mapping here.
export const statusTagText = (usage, t) => {
  const status = getDisplayText(usage?.status);
  return t(STATUS_TAG_KEYS[status] || status || 'Unknown status');
};

// The only trusted source of a window's used percentage is `percent`.
// `remaining` is an absolute amount (unit-qualified); deriving 100-remaining
// from it would fabricate a percentage, so it never happens here. Returns
// null when the upstream exposes no usable percentage.
export const resolveWindowUsedPercent = (item) => {
  if (item?.percent == null) return null;
  const p = Number(item.percent);
  if (!Number.isFinite(p)) return null;
  return clampPercent(p);
};

// Tooltip lines for one window: used/remaining amounts (absolute, with unit),
// the explicit remaining percentage derived from `percent`, reset time and
// unit. Nothing is invented beyond 100 - percent.
export const windowTooltipLines = (item, t) => {
  const lines = [];
  const unitText = getDisplayText(item?.unit);
  if (item?.used != null) {
    lines.push(
      `${t('Used: ')}${formatAmount(item.used)}${unitText ? ` ${unitText}` : ''}`,
    );
  }
  const usedPercent = resolveWindowUsedPercent(item);
  if (usedPercent != null) {
    lines.push(`${t('Remaining: ')}${100 - usedPercent}%`);
  }
  if (item?.remaining != null) {
    lines.push(
      `${t('Remaining: ')}${formatAmount(item.remaining)}${unitText ? ` ${unitText}` : ''}`,
    );
  }
  const resetText = formatResetTime(item?.reset);
  if (resetText) {
    lines.push(`${t('Resets at: ')}${resetText}`);
  }
  if (unitText) {
    lines.push(`${t('Unit: ')}${unitText}`);
  }
  return lines;
};

// TTL of the client-side cache for per-key plan usage scans
// (useChannelKeysPlanQuota). Mirrors the backend's 30s per-key TTL.
export const KEYS_PLAN_QUOTA_TTL_MS = 30000;

// Statuses that mean "this key produced no window data": they carry no items
// and must not contribute to any aggregate.
const KEY_STATUS_NO_DATA = new Set(['ok', 'needs_configuration']);

// Earliest RFC3339 reset among the given values (lexicographic comparison is
// correct for same-precision RFC3339 UTC strings as produced by the backend).
// Returns undefined when none is parseable.
const earliestReset = (resets) => {
  let earliest;
  for (const reset of resets) {
    if (!reset) continue;
    const time = new Date(reset).getTime();
    if (Number.isNaN(time)) continue;
    if (earliest === undefined || time < earliest.time) {
      earliest = { time, reset };
    }
  }
  return earliest?.reset;
};

// Aggregate per-key usage results into one window list for the outer
// channels-table cell. Per-key results follow the backend
// ChannelKeysQuotaUsage contract: `keys[].items[]` with the same
// QuotaUsageItem shape used elsewhere in this module.
//
// Rules (never fabricate data):
//   - only keys with status 'ok' contribute; errored and
//     needs_configuration keys are skipped entirely;
//   - windows are grouped by window name; a window is summed only across
//     keys that report it;
//   - used/remaining are summed only from finite numbers;
//   - percent is the sum-derived value sumUsed/(sumUsed+sumRemaining)*100,
//     rounded to 1 decimal and clamped to 0-100, ONLY when both sums exist
//     and the denominator is positive. Per-key `percent` values are never
//     averaged. Without a derivable percent, `percent` stays undefined and
//     the caller renders amounts without a bar;
//   - reset is the earliest reset among contributing keys.
export const aggregateKeyWindows = (perKeyResults) => {
  const keys = Array.isArray(perKeyResults) ? perKeyResults : [];
  const byName = new Map();
  for (const key of keys) {
    if (key?.status !== 'ok') continue;
    const items = Array.isArray(key.items) ? key.items : [];
    for (const item of items) {
      const name = getDisplayText(item?.name);
      if (!name) continue;
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          unit: getDisplayText(item?.unit),
          used: null,
          remaining: null,
          resets: [],
        });
      }
      const agg = byName.get(name);
      if (typeof item.used === 'number' && Number.isFinite(item.used)) {
        agg.used = (agg.used ?? 0) + item.used;
      }
      if (
        typeof item.remaining === 'number' &&
        Number.isFinite(item.remaining)
      ) {
        agg.remaining = (agg.remaining ?? 0) + item.remaining;
      }
      if (item.reset) {
        agg.resets.push(item.reset);
      }
    }
  }
  const windows = [];
  for (const agg of byName.values()) {
    const usedPercent =
      agg.used != null && agg.remaining != null && agg.used + agg.remaining > 0
        ? clampPercent(
            Math.round((agg.used / (agg.used + agg.remaining)) * 1000) / 10,
          )
        : undefined;
    windows.push({
      name: agg.name,
      used: agg.used ?? undefined,
      remaining: agg.remaining ?? undefined,
      percent: usedPercent,
      reset: earliestReset(agg.resets),
      unit: agg.unit || undefined,
    });
  }
  // Stable order: the canonical window order first, then any extras.
  const order = Object.keys(WINDOW_NAME_KEYS);
  windows.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
  return windows;
};

// Per-key tooltip lines for an aggregated window: at most maxKeys lines of
// "Key N: used X / remaining Y", then a "+N more" line.
export const aggregateTooltipKeyLines = (
  perKeyResults,
  windowName,
  t,
  maxKeys = 10,
) => {
  const lines = [];
  let hidden = 0;
  for (const key of Array.isArray(perKeyResults) ? perKeyResults : []) {
    if (key?.status !== 'ok') continue;
    const item = (Array.isArray(key.items) ? key.items : []).find(
      (candidate) => getDisplayText(candidate?.name) === windowName,
    );
    if (!item) continue;
    if (lines.length >= maxKeys) {
      hidden += 1;
      continue;
    }
    const parts = [];
    if (item.used != null) {
      parts.push(`${t('Used: ')}${formatAmount(item.used)}`);
    }
    if (item.remaining != null) {
      parts.push(`${t('Remaining: ')}${formatAmount(item.remaining)}`);
    }
    const resetText = formatResetTime(item?.reset);
    if (resetText) {
      parts.push(`${t('Resets at: ')}${resetText}`);
    }
    lines.push(
      `${t('Key {{index}}', { index: (key.key_index ?? 0) + 1 })}${
        parts.length ? `: ${parts.join(' / ')}` : ''
      }`,
    );
  }
  if (hidden > 0) {
    lines.push(t('{{count}} more keys', { count: hidden }));
  }
  return lines;
};
