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
 * 渠道类型 → Lobe 图标名（按类型编号映射，语言无关），
 * 与上游 `getChannelTypeIcon` 保持一致。
 */
const TYPE_TO_ICON = {
  1: 'OpenAI',
  6: 'OpenAI',
  7: 'OpenAI',
  8: 'OpenAI',
  58: 'NewAPI',
  59: 'Sub2API',
  60: 'NewAPI',
  3: 'Azure',
  14: 'Claude',
  24: 'Gemini',
  11: 'Google',
  41: 'Gemini',
  33: 'Aws',
  39: 'Cloudflare',
  15: 'Baidu',
  46: 'Baidu',
  16: 'Zhipu',
  26: 'Zhipu',
  17: 'Qwen',
  18: 'Spark',
  23: 'Hunyuan',
  19: 'Ai360',
  25: 'Moonshot',
  31: 'Yi',
  35: 'Minimax',
  45: 'Volcengine',
  4: 'Ollama',
  27: 'Perplexity',
  34: 'Cohere',
  42: 'Mistral',
  43: 'DeepSeek',
  48: 'XAI',
  49: 'Coze',
  40: 'SiliconCloud',
  44: 'OpenAI',
  20: 'OpenRouter',
  2: 'Midjourney',
  5: 'Midjourney',
  50: 'Kling',
  51: 'Jimeng',
  52: 'Vidu',
  36: 'Suno',
  55: 'OpenAI',
  54: 'Doubao',
  56: 'Replicate',
  37: 'Dify',
  38: 'Jina',
};

export const getChannelTypeIcon = (type) =>
  TYPE_TO_ICON[type] || 'OpenAI';

/**
 * 解析插件 logo 的渲染方式。
 *
 * 优先级：显式 `icon`（LobeHub 图标名，或 `text` / `text:<label>` 文生头像
 * 约定）→ 首个声明渠道类型的图标 → 由插件名派生的文生头像，
 * 保证无 logo 的插件也有稳定的品牌化标识。
 */
export const resolvePluginIcon = ({ icon, channelTypes, key, name }) => {
  const trimmedIcon = (icon || '').trim();
  if (trimmedIcon) {
    if (trimmedIcon === 'text' || trimmedIcon.startsWith('text:')) {
      const explicit = trimmedIcon.startsWith('text:')
        ? trimmedIcon.slice(5).trim()
        : '';
      return {
        kind: 'text',
        label: explicit ? explicit.slice(0, 4) : deriveTextLabel(key, name),
        colorSeed: key,
      };
    }
    return { kind: 'lobe', name: trimmedIcon };
  }
  if (channelTypes != null && channelTypes.length > 0) {
    return {
      kind: 'lobe',
      name: `${getChannelTypeIcon(channelTypes[0])}.Color`,
    };
  }
  return {
    kind: 'text',
    label: deriveTextLabel(key, name),
    colorSeed: key,
  };
};

const deriveTextLabel = (key, name) => {
  const source = (name || '').trim() || (key || '').trim();
  return [...source].slice(0, 2).join('').toUpperCase();
};

/**
 * 确定性配色：同一插件 key 恒渲染同一颜色。
 */
const TEXT_AVATAR_PALETTE = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100',
  'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100',
  'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100',
];

export const textAvatarClass = (colorSeed) => {
  let hash = 0;
  for (let i = 0; i < colorSeed.length; i++) {
    hash = (hash * 31 + colorSeed.charCodeAt(i)) | 0;
  }
  return TEXT_AVATAR_PALETTE[Math.abs(hash) % TEXT_AVATAR_PALETTE.length];
};
