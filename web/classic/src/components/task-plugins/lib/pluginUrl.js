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

// 单个插件源文件上限（与后端 maxTaskPluginSourceBytes 一致）
export const MAX_PLUGIN_SOURCE_BYTES = 1024 * 1024;

export const pluginSourceByteLength = (source) =>
  new TextEncoder().encode(source).length;

export const isPluginSourceTooLarge = (source) =>
  pluginSourceByteLength(source) > MAX_PLUGIN_SOURCE_BYTES;

// 把代码托管页面 URL 重写为原始文件 URL（GitHub / gist），其余 URL 原样尝试
export const normalizePluginSourceUrl = (input) => {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  parsed.hash = '';
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'github.com' || host === 'www.github.com') {
    const isSourceView = segments[2] === 'blob' || segments[2] === 'raw';
    if (isSourceView && segments.length > 4) {
      const rest = segments.slice(3).join('/');
      return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/${rest}`;
    }
    return parsed.toString();
  }

  if (host === 'gist.github.com' && segments.length > 0) {
    const path = segments.join('/');
    const suffix = segments.includes('raw') ? path : `${path}/raw`;
    return `https://gist.githubusercontent.com/${suffix}${parsed.search}`;
  }

  return parsed.toString();
};

export class PluginSourceFetchError extends Error {
  constructor(reason, status) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

// 浏览器侧抓取插件源：网关不发起外呼，无服务端 SSRF 面
export const fetchPluginSourceText = async (url, fetchImpl = fetch) => {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (_) {
    throw new PluginSourceFetchError('unreachable');
  }
  if (!response.ok) {
    throw new PluginSourceFetchError('not_found', response.status);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PLUGIN_SOURCE_BYTES) {
    throw new PluginSourceFetchError('too_large');
  }
  const text = await response.text();
  if (pluginSourceByteLength(text) > MAX_PLUGIN_SOURCE_BYTES) {
    throw new PluginSourceFetchError('too_large');
  }
  return text;
};

// 源文件 SHA-256（hex）。非安全上下文（无 WebCrypto）时返回 null，
// 此时跳过客户端预检，服务端上传时会再次校验
export const computeSourceSha256 = async (source) => {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
