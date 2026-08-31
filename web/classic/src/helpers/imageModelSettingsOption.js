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

import { API } from './api';
import {
  normalizeImageModelSetting,
  parseImageModelSettings,
} from './imageModelSettings';

export const IMAGE_MODEL_SETTINGS_OPTION_KEY = 'ImageModelSettings';

export const stringifyImageModelSettings = (settings) =>
  JSON.stringify(settings, null, 2);

export const loadImageModelSettingsOption = async () => {
  const res = await API.get('/api/option/');
  const option = res.data?.data?.find(
    (item) => item.key === IMAGE_MODEL_SETTINGS_OPTION_KEY,
  );
  return parseImageModelSettings(option?.value);
};

export const saveImageModelSettingsOption = async (settings) => {
  const normalized = settings
    .map(normalizeImageModelSetting)
    .filter((item) => item.model);
  const value = stringifyImageModelSettings(normalized);
  const res = await API.put('/api/option/', {
    key: IMAGE_MODEL_SETTINGS_OPTION_KEY,
    value,
  });

  if (!res.data?.success) {
    throw new Error(res.data?.message || '保存失败');
  }

  return { settings: normalized, value };
};

export const buildImageModelSettingsMap = (settings = []) =>
  settings.reduce((map, setting) => {
    if (setting?.model) map[setting.model] = setting;
    return map;
  }, {});
