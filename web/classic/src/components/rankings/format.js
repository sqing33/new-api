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

// token 数压缩为 K/M/B 单位;轴刻度回调可能传入字符串形式的数字,这里统一兜底
export const formatTokens = (value) => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || Number.isNaN(numeric)) return '-';
  const units = ['', 'K', 'M', 'B', 'T'];
  if (numeric < 1000) return `${numeric}`;
  const index = Math.min(
    Math.floor(Math.log10(Math.abs(numeric)) / 3),
    units.length - 1,
  );
  const scaled = numeric / 1000 ** index;
  return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${units[index]}`;
};

// 0..1 占比 -> 百分比文本
export const formatShare = (share) => {
  if (typeof share !== 'number' || Number.isNaN(share)) return '-';
  const pct = share * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

// 厂商固定配色（与上游保持一致），未匹配的厂商走 fallback 调色板
export const VENDOR_COLOURS = {
  OpenAI: '#10a37f',
  Anthropic: '#d97757',
  Google: '#4285f4',
  DeepSeek: '#7c5cff',
  Alibaba: '#ff9900',
  xAI: '#1f2937',
  Meta: '#1877f2',
  Moonshot: '#ec4899',
  Zhipu: '#06b6d4',
  Mistral: '#ff7000',
  ByteDance: '#3b82f6',
  Tencent: '#22c55e',
  MiniMax: '#a855f7',
  Cohere: '#fb923c',
  Baidu: '#ef4444',
  Others: '#94a3b8',
};

const FALLBACK_PALETTE = [
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#8b5cf6',
  '#0ea5e9',
  '#f43f5e',
  '#84cc16',
  '#06b6d4',
  '#e879f9',
  '#f97316',
  '#22c55e',
  '#64748b',
];

export const buildVendorColorMap = (vendorNames) => {
  const map = {};
  let fallbackIndex = 0;
  for (const name of vendorNames) {
    if (!name || map[name]) continue;
    if (VENDOR_COLOURS[name]) {
      map[name] = VENDOR_COLOURS[name];
    } else {
      map[name] = FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
      fallbackIndex += 1;
    }
  }
  return map;
};
