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

export const IMAGE_MODEL_MODE_OPTIONS = [
  { value: 'generations', label: '文生图' },
  { value: 'edits', label: '图片编辑' },
];

export const VIDEO_MODEL_MODE_OPTIONS = [
  { value: 'text_to_video', label: '文生视频' },
];

export const DEFAULT_VIDEO_MODEL_CONFIG = {
  default_seconds: '4',
  durations: ['4'],
  default_size: '720x1280',
  sizes: ['720x1280', '1280x720'],
};

export const DEFAULT_IMAGE_MODEL_SETTINGS = [
  {
    model: 'gpt-image-2',
    label: 'GPT Image 2',
    modes: ['generations', 'edits'],
    max_n: 10,
  },
];

const normalizeStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

const normalizeOptionList = (value, fallback) => {
  const normalized = normalizeStringArray(value)
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

export const normalizeVideoModelConfig = (video) => {
  const durations = normalizeOptionList(
    video?.durations,
    DEFAULT_VIDEO_MODEL_CONFIG.durations,
  );
  const sizes = normalizeOptionList(
    video?.sizes,
    DEFAULT_VIDEO_MODEL_CONFIG.sizes,
  );
  const defaultSeconds =
    typeof video?.default_seconds === 'string' && video.default_seconds.trim()
      ? video.default_seconds.trim()
      : durations[0];
  const defaultSize =
    typeof video?.default_size === 'string' && video.default_size.trim()
      ? video.default_size.trim()
      : sizes[0];

  return {
    default_seconds: durations.includes(defaultSeconds)
      ? defaultSeconds
      : durations[0],
    durations,
    default_size: sizes.includes(defaultSize) ? defaultSize : sizes[0],
    sizes,
  };
};

export const normalizeImageModelSetting = (setting) => {
  const modes = normalizeStringArray(setting?.modes).filter((mode) =>
    IMAGE_MODEL_MODE_OPTIONS.some((item) => item.value === mode),
  );
  const videoModes = normalizeStringArray(setting?.video_modes).filter((mode) =>
    VIDEO_MODEL_MODE_OPTIONS.some((item) => item.value === mode),
  );
  const normalized = {
    model: typeof setting?.model === 'string' ? setting.model.trim() : '',
    label: typeof setting?.label === 'string' ? setting.label.trim() : '',
    modes,
    max_n: Math.min(Math.max(Number(setting?.max_n) || 1, 1), 12),
  };

  if (videoModes.length > 0 || setting?.video) {
    normalized.video_modes = videoModes;
    normalized.video = normalizeVideoModelConfig(setting?.video);
  }

  return normalized;
};

export const parseImageModelSettings = (raw) => {
  if (Array.isArray(raw)) {
    return raw.map(normalizeImageModelSetting).filter((item) => item.model);
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_IMAGE_MODEL_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_IMAGE_MODEL_SETTINGS;
    return parsed.map(normalizeImageModelSetting).filter((item) => item.model);
  } catch {
    return DEFAULT_IMAGE_MODEL_SETTINGS;
  }
};

export const getImageModelSetting = (settings, model) =>
  settings.find((item) => item.model === model);

export const imageModelSupportsMode = (setting, mode) =>
  Array.isArray(setting?.modes) && setting.modes.includes(mode);

export const getVideoModelSetting = (settings, model) =>
  settings.find((item) => item.model === model);

export const videoModelSupportsMode = (setting, mode) =>
  Array.isArray(setting?.video_modes) && setting.video_modes.includes(mode);
