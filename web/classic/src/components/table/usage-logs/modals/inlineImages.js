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
 * 从载荷正文里提取内联图片（data URL），供界面上渲染缩略图。
 *
 * 后端默认会在截断前把内联二进制替换成占位符（见 pkg/relaycapture/
 * binary_strip.go），所以正常情况下这里返回空数组、正文里只有
 * `[binary omitted: image/png, 120.0 KB]` 这类短占位符。
 *
 * 只有当管理员显式打开「采集多模态与二进制内容」时，base64 才会留存在正文里。
 * 那种情况下，把几 MB 的 base64 当纯文本铺在弹窗里既卡又没法看，因此这里把它
 * 抽出来交给 <img> 渲染，正文里只留占位符。
 */

// MAX_PREVIEW_IMAGES 限制单个载荷最多渲染的图片数，避免一次塞进几十张大图。
const MAX_PREVIEW_IMAGES = 6;

// MAX_INLINE_IMAGE_BYTES 是单张图片的渲染上限。超过它只显示尺寸，不生成
// data URL 给 <img>，防止一张超大图把浏览器卡死。
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

const DATA_URL_PATTERN = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)/g;

/**
 * 把正文里的内联图片抽出来。
 *
 * @param {string} raw 原始正文
 * @returns {{ text: string, images: Array<{mime: string, src: string, bytes: number}> }}
 *   text 是替换过占位符的正文；images 是可渲染的图片列表。
 */
export const extractInlineImages = (raw) => {
  if (!raw || !raw.includes('data:image/')) {
    return { text: raw || '', images: [] };
  }

  const images = [];
  const text = raw.replace(DATA_URL_PATTERN, (match, mime, base64) => {
    // base64 字节数换算成原始字节数（4 个 base64 字符 = 3 字节）。
    const bytes = Math.floor((base64.length * 3) / 4);
    if (images.length < MAX_PREVIEW_IMAGES && bytes <= MAX_INLINE_IMAGE_BYTES) {
      images.push({ mime, src: `data:${mime};base64,${base64}`, bytes });
    }
    return `[${mime}, ${formatBytes(bytes)}]`;
  });

  return { text, images };
};

/**
 * 把字节数格式化成便于阅读的单位。
 */
export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

export const __testing = {
  DATA_URL_PATTERN,
  MAX_PREVIEW_IMAGES,
  MAX_INLINE_IMAGE_BYTES,
};
