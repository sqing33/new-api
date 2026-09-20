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

export const formatLatency = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

export const formatThroughput = (tps) => {
  if (!Number.isFinite(tps) || tps <= 0) return '—';
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}K t/s`;
  return `${tps.toFixed(tps < 10 ? 2 : 1)} t/s`;
};

export const formatUptimePct = (pct) => {
  if (!Number.isFinite(pct)) return '—';
  return `${pct.toFixed(2)}%`;
};

// 成功率分级（与上游保持一致）：100 优秀 / >=90 良好 / >=70 警告 / 其余告急
export const getSuccessRateLevel = (rate) => {
  if (!Number.isFinite(rate)) return 'unknown';
  if (rate >= 100) return 'excellent';
  if (rate >= 90) return 'good';
  if (rate >= 70) return 'warning';
  return 'critical';
};

export const SUCCESS_RATE_COLORS = {
  excellent: 'var(--semi-color-success)',
  good: 'var(--semi-color-success)',
  warning: 'var(--semi-color-warning)',
  critical: 'var(--semi-color-danger)',
  unknown: 'var(--semi-color-text-2)',
};

export const getSuccessRateColor = (rate) =>
  SUCCESS_RATE_COLORS[getSuccessRateLevel(rate)];
