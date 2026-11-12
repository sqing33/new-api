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
 * 后端把日志正文按「英文源串 + 参数」存进 other.content_parts，content 列保留
 * 英文原文给导出与非浏览器调用方。这里把 content_parts 翻译成当前语言，
 * 没有结构化正文的历史行返回空串，由调用方回落到 content。
 */
export function renderLogContentParts(other, translate) {
  const parts = other && other.content_parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return '';
  }
  const text = parts
    .map((part) => {
      if (!part) return '';
      if (typeof part === 'string') return translate ? translate(part) : part;
      const key = part.key || '';
      if (!translate) return key;
      return translate(key, part.params);
    })
    .filter(Boolean)
    .join(', ');
  return text;
}

export function getLogOther(otherStr) {
  if (otherStr === undefined || otherStr === null || otherStr === '') {
    return {};
  }
  if (typeof otherStr === 'object') {
    return otherStr;
  }
  try {
    return JSON.parse(otherStr);
  } catch (e) {
    console.error(`Failed to parse record.other: "${otherStr}".`, e);
    return null;
  }
}
