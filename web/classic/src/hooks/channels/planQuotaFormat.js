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
  ok: 'Healthy',
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

export const statusTagText = (usage, t) => {
  const status = getDisplayText(usage?.status);
  return t(STATUS_TAG_KEYS[status] || status || 'Healthy');
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
