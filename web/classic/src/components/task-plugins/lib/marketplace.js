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

export const SUPPORTED_INDEX_VERSION = 1;

// 网关目前只运行任务插件；其他 kind 会被过滤
export const SUPPORTED_PLUGIN_KIND = 'task';

// 内置的两个官方索引（项目维护），其余来源标注「第三方，风险自担」
export const DEFAULT_MARKETPLACE_INDEX_URL =
  'https://www.newapi.ai/api/v1/plugins/index.json';
export const GITHUB_MARKETPLACE_INDEX_URL =
  'https://raw.githubusercontent.com/QuantumNous/new-api-plugins/main/index.json';

export const isDefaultMarketplaceSource = (indexUrl) => {
  const normalized = (indexUrl || '').trim();
  return (
    normalized === DEFAULT_MARKETPLACE_INDEX_URL ||
    normalized === GITHUB_MARKETPLACE_INDEX_URL
  );
};

// 把索引中声明的 path 解析为绝对源 URL；必须留在提供索引的同一 origin
export const resolvePluginSourceUrl = (indexUrl, path) => {
  const trimmed = (path || '').trim();
  if (!trimmed) return null;
  let base;
  try {
    base = new URL(indexUrl);
  } catch (_) {
    return null;
  }
  let resolved;
  try {
    resolved = new URL(trimmed, base);
  } catch (_) {
    return null;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }
  if (resolved.origin !== base.origin) return null;
  return resolved.toString();
};

const stringArray = (value) => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item) => typeof item === 'string');
  return items.length > 0 ? items : undefined;
};

const numberArray = (value) => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item) => typeof item === 'number' && Number.isFinite(item),
  );
  return items.length > 0 ? items : undefined;
};

const parseMarketplaceDescription = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const mapped = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === 'string') mapped[locale] = text;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

const parseMarketplacePlugin = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const key = typeof entry.key === 'string' ? entry.key.trim() : '';
  if (!key) return null;

  const versions = [];
  if (Array.isArray(entry.versions)) {
    for (const candidate of entry.versions) {
      if (!candidate || typeof candidate !== 'object') continue;
      const version =
        typeof candidate.version === 'string' ? candidate.version.trim() : '';
      const path = typeof candidate.path === 'string' ? candidate.path.trim() : '';
      if (!version || !path) continue;
      const kind =
        typeof candidate.kind === 'string' ? candidate.kind.trim() : '';
      if (kind && kind !== SUPPORTED_PLUGIN_KIND) continue;
      versions.push({
        version,
        path,
        sha256:
          typeof candidate.sha256 === 'string'
            ? candidate.sha256.trim()
            : undefined,
        minApiVersion: Number.isFinite(Number(candidate.minApiVersion))
          ? Number(candidate.minApiVersion)
          : undefined,
        kind: kind || undefined,
        allowedHosts: stringArray(candidate.allowedHosts),
        auth:
          typeof candidate.auth === 'string' ? candidate.auth : undefined,
      });
    }
  }
  if (versions.length === 0) return null;

  const declaredLatest =
    typeof entry.latest === 'string' ? entry.latest.trim() : '';
  const latest = versions.some((v) => v.version === declaredLatest)
    ? declaredLatest
    : versions[0].version;

  let icon;
  if (typeof entry.icon === 'string') {
    const trimmed = entry.icon.trim();
    if (trimmed && trimmed.length <= 128) icon = trimmed;
  }

  return {
    key,
    name: typeof entry.name === 'string' && entry.name ? entry.name : key,
    icon,
    description: parseMarketplaceDescription(entry.description),
    channelTypes: numberArray(entry.channelTypes),
    models: stringArray(entry.models),
    latest,
    versions,
  };
};

// 校验不受信任的索引 JSON 为展示形态；畸形条目跳过而不整体失败
export const parseMarketplaceIndex = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('index is not an object');
  }
  const indexVersion = Number(payload.indexVersion);
  if (!Number.isFinite(indexVersion)) {
    throw new Error('index is missing indexVersion');
  }
  if (indexVersion > SUPPORTED_INDEX_VERSION) {
    throw new Error(`unsupported indexVersion ${indexVersion}`);
  }
  const plugins = [];
  if (Array.isArray(payload.plugins)) {
    for (const entry of payload.plugins) {
      const plugin = parseMarketplacePlugin(entry);
      if (plugin) plugins.push(plugin);
    }
  }
  return {
    indexVersion,
    name: typeof payload.name === 'string' ? payload.name : '',
    plugins,
  };
};

export const findMarketplaceVersion = (plugin, version) =>
  plugin.versions.find((entry) => entry.version === version);

// 对照网关已安装插件推导安装状态：
// diverged = 已安装版本不在索引列表中（本地上传或来源回滚）
export const deriveInstallState = (plugin, installed) => {
  const match = installed.find((item) => item.meta?.key === plugin.key);
  if (!match) return { status: 'not_installed' };

  const installedVersion = match.meta.version;
  if (installedVersion === plugin.latest) {
    return { status: 'up_to_date', installedVersion };
  }
  const known = plugin.versions.some(
    (entry) => entry.version === installedVersion,
  );
  if (!known) {
    return {
      status: 'diverged',
      installedVersion,
      latestVersion: plugin.latest,
    };
  }
  return {
    status: 'upgradable',
    installedVersion,
    latestVersion: plugin.latest,
  };
};

// factory 插件随系统发布更新；强制安装会形成永久 override，故只读
export const resolveMarketplaceActionPolicy = (installed) => {
  if (installed?.source === 'factory') {
    return { kind: 'system_update' };
  }
  return { kind: 'install' };
};

// 展示在 marketplace 最新版本旁的内置版本
export const marketplaceBuiltInVersion = (installed) => {
  if (!installed) return undefined;
  if (installed.source === 'factory') return installed.meta.version;
  return installed.factory_meta?.version;
};

export const isStaleFactoryOverride = (item) =>
  item.source === 'override_over_factory' &&
  item.factory_meta != null &&
  item.factory_meta.version !== item.meta.version;

// 来源具备完整性校验 = 所有列出版本都带 sha256
export const indexHasIntegrityHashes = (index) =>
  index.plugins.length > 0 &&
  index.plugins.every((plugin) =>
    plugin.versions.every((version) => Boolean(version.sha256)),
  );
