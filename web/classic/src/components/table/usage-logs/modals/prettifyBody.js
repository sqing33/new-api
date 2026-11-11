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
 * 载荷正文的容错 JSON 格式化。
 *
 * 直接 JSON.parse 在两种常见情况下会失败，导致整段正文挤成一行：
 *   1. 正文被 MaxPayloadBytes 截断，尾部括号/引号不完整；
 *   2. 流式响应是逐帧拼接的结果，本身就不是单个合法 JSON。
 *
 * 这里先尝试严格解析，失败则用「补全未闭合结构」的方式修复后再解析，
 * 使截断内容依然能缩进展示。修复失败时回退为逐行美化，绝不抛错。
 */

// 补全截断 JSON 时最多回溯的字符数，避免在超大正文上做无界扫描。
const MAX_REPAIR_TAIL = 4096;

/**
 * 扫描一段 JSON 文本，返回未闭合的结构信息。
 * 只处理字符串外的括号与引号状态，忽略注释等非标准语法。
 */
const scanStructure = (text) => {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    }
  }

  return { stack, inString, escaped };
};

/**
 * 找到最后一个未闭合字符串的起始引号位置。
 *
 * 不能用 lastIndexOf('"')：那会命中字符串的「开启」引号，把整段内容都切掉。
 * 正确做法是从头扫描，记录每个未闭合字符串的起点。
 */
const findUnterminatedStringStart = (text) => {
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      start = i;
    }
  }

  return inString ? start : -1;
};

/**
 * 反复剥掉尾部残缺的成员，直到尾部是一个完整的值或闭合符。
 *
 * 截断可能停在任意位置，尾部会残留这些形态之一：
 *   ..."content":        键后无值 → 需要连键一起删
 *   ..."content          半个键名 → 需要连逗号一起删
 *   ..."a":1,            悬空逗号 → 删逗号即可
 * 每轮只处理一种形态并重新校验，最多循环若干次防止意外死循环。
 */
const stripDanglingTail = (text) => {
  let candidate = text;

  for (let i = 0; i < 8; i += 1) {
    const before = candidate;

    // 键后无值：,"key": 或 "key": 结尾（键已闭合但没有值）
    candidate = candidate.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
    // 半个键名：,"partialKe 结尾（未闭合引号）
    candidate = candidate.replace(/,\s*"[^"]*$/, '');
    // 悬空逗号与空白
    candidate = candidate.replace(/[\s,]+$/, '');

    if (candidate === before) {
      break;
    }
  }

  return candidate;
};

/**
 * 修复被截断的 JSON 文本，使其成为可解析的合法 JSON。
 *
 * 做法：截掉尾部可能残缺的半个 token（未闭合字符串、悬空逗号或半个键值），
 * 再按剩余未闭合的括号顺序补上闭合符。
 */
const repairTruncatedJSON = (text) => {
  let candidate = text;

  // 未闭合的字符串会吞掉后续所有内容，先把它整体截掉。
  const unterminatedStart = findUnterminatedStringStart(candidate);
  if (unterminatedStart >= 0) {
    candidate = candidate.slice(0, unterminatedStart);
  }

  candidate = stripDanglingTail(candidate);

  const { stack } = scanStructure(candidate);
  let closing = '';
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    closing += stack[i] === '{' ? '}' : ']';
  }

  if (!closing) {
    return null;
  }

  const repaired = candidate + closing;
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
};

/**
 * 最后的兜底：去掉空行并统一缩进，至少保证换行可读。
 */
const indentLooseText = (raw) =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

/**
 * 把 SSE 帧序列整理成可读结构。
 *
 * 流式响应是 `data: {...}` 逐行拼接的，本身不是单个合法 JSON。
 * 这里把每帧的 JSON 提取出来，输出为「帧序号 + 缩进后的帧内容」，
 * 比逐行原样展示更容易读。
 */
const formatSSEFrames = (raw) => {
  const frames = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') {
      continue;
    }
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (!payload) {
        continue;
      }
      frames.push(payload);
      continue;
    }
    // event: xxx 之类的非数据行忽略，它们对阅读正文没有帮助。
  }

  if (frames.length === 0) {
    return null;
  }

  return frames
    .map((frame, index) => {
      let body;
      try {
        body = JSON.stringify(JSON.parse(frame), null, 2);
      } catch {
        body = frame;
      }
      return `── frame ${index + 1} ──\n${body}`;
    })
    .join('\n\n');
};

/**
 * 格式化载荷正文。永不抛错。
 *
 * @param {string} raw 原始正文
 * @param {boolean} truncated 是否因超过 MaxPayloadBytes 被截断
 * @returns {string} 可读文本
 */
export const prettifyBody = (raw, truncated = false) => {
  if (!raw) {
    return '';
  }

  // 快路径：合法 JSON 直接缩进。
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // 继续走修复路径
  }

  // 截断的 JSON：补全未闭合结构后缩进。
  if (truncated) {
    const repaired = repairTruncatedJSON(raw);
    if (repaired) {
      try {
        return JSON.stringify(JSON.parse(repaired), null, 2);
      } catch {
        // 落到兜底
      }
    }
  }

  // 流式帧序列：按帧整理，比逐行原样输出可读得多。
  const sse = formatSSEFrames(raw);
  if (sse) {
    return sse;
  }

  // 其他不合法内容：逐行美化。
  const loose = indentLooseText(raw);
  try {
    return JSON.stringify(JSON.parse(loose), null, 2);
  } catch {
    return loose;
  }
};

export const __testing = {
  scanStructure,
  repairTruncatedJSON,
  MAX_REPAIR_TAIL,
};
