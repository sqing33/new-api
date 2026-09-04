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

/**
 * 插件/市场文案可能是裸字符串（旧版市场索引）或 BCP-47 映射表
 * （网关 API 恒为映射表形态）。
 *
 * 回退顺序：精确 tag → 主语言子标签 → en → 按序首个 key → ''
 */
export const resolveLocalizedText = (value, language) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return '';

  const texts = new Map();
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string' || text.trim() === '') continue;
    const locale = key.trim().replaceAll('_', '-').toLowerCase();
    if (!locale) continue;
    texts.set(locale, text);
  }
  if (texts.size === 0) return '';

  for (const candidate of localeFallbackKeys(language)) {
    const hit = texts.get(candidate);
    if (hit !== undefined) return hit;
  }

  const firstKey = [...texts.keys()].sort((left, right) =>
    left.localeCompare(right),
  )[0];
  return firstKey ? (texts.get(firstKey) ?? '') : '';
};

const localeFallbackKeys = (language) => {
  const normalized = (language || '')
    .trim()
    .replaceAll('_', '-')
    .toLowerCase();
  const keys = [];
  const add = (tag) => {
    if (tag && !keys.includes(tag)) keys.push(tag);
  };

  add(normalized);
  if (normalized.includes('-')) {
    add(normalized.slice(0, normalized.indexOf('-')));
  }
  add('en');
  return keys;
};
