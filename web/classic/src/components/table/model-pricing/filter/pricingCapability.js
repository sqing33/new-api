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

// 定价页「能力」筛选的取值。
export const PRICING_CAPABILITY_ALL = 'all';
export const PRICING_CAPABILITY_IMAGE = 'image';
export const PRICING_CAPABILITY_CHAT = 'chat';
export const PRICING_CAPABILITY_TTS = 'tts';
export const PRICING_CAPABILITY_ASR = 'asr';

// modelMatchesCapability 判断模型是否命中指定能力。
//
// 生图能力来自站点级 image_model_settings 配置；语音能力由后端在 /api/pricing
// 的 supports_tts / supports_asr 字段直接给出，因此优先读模型自身字段，
// 回退到 image_model_settings，避免旧数据缺字段时筛选结果为空。
export const modelMatchesCapability = (
  model,
  capability,
  imageModelSettingsMap = {},
) => {
  if (capability === PRICING_CAPABILITY_ALL) return true;

  const setting = imageModelSettingsMap?.[model?.model_name];

  switch (capability) {
    case PRICING_CAPABILITY_IMAGE:
      return Array.isArray(setting?.modes) && setting.modes.length > 0;
    case PRICING_CAPABILITY_TTS:
      return (
        model?.supports_tts === true ||
        (Array.isArray(setting?.tts_modes) && setting.tts_modes.length > 0)
      );
    case PRICING_CAPABILITY_ASR:
      return (
        model?.supports_asr === true ||
        (Array.isArray(setting?.asr_modes) && setting.asr_modes.length > 0)
      );
    case PRICING_CAPABILITY_CHAT:
      // 对话能力是兜底项：未配置任何专属能力的模型都算对话模型。
      return (
        !modelMatchesCapability(model, PRICING_CAPABILITY_IMAGE, imageModelSettingsMap) &&
        !modelMatchesCapability(model, PRICING_CAPABILITY_TTS, imageModelSettingsMap) &&
        !modelMatchesCapability(model, PRICING_CAPABILITY_ASR, imageModelSettingsMap)
      );
    default:
      return true;
  }
};
