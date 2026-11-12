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

import i18n from '../i18n/i18n';

/**
 * 后端返回的控制台消息已经从「已翻译文本」改为「英文源文本 + 参数」：
 * message 仍是英文原文（给非浏览器调用方），message_key / message_params
 * 才是控制台应该渲染的内容。classic 的文案以中文源串为 key，这里用一张
 * 独立映射表承接后端英文源串，避免污染主语言包。
 */
const SERVER_MESSAGES = {
  // 通用
  'Invalid parameters': { 'zh-CN': '无效的参数', 'zh-TW': '無效的參數' },
  'Invalid input {{error}}': {
    'zh-CN': '输入不合法：{{error}}',
    'zh-TW': '輸入不合法：{{error}}',
  },
  'Unauthorized, insufficient privileges': {
    'zh-CN': '权限不足',
    'zh-TW': '權限不足',
  },
  'Please try again later.': { 'zh-CN': '请稍后重试', 'zh-TW': '請稍後重試' },
  'Feature is not enabled': { 'zh-CN': '功能未启用', 'zh-TW': '功能未啟用' },
  'Rate limit exceeded, please try again later': {
    'zh-CN': '请求次数过多，请稍后重试',
    'zh-TW': '請求次數過多，請稍後重試',
  },

  // 用户与认证
  'User has been banned': { 'zh-CN': '用户已被封禁', 'zh-TW': '使用者已被封禁' },
  'Email address is already in use': {
    'zh-CN': '邮箱地址已被占用',
    'zh-TW': '電子郵件地址已被佔用',
  },
  'Password reset link is invalid or has expired': {
    'zh-CN': '重置链接非法或已过期',
    'zh-TW': '重設連結無效或已過期',
  },
  'Username or password is empty': {
    'zh-CN': '用户名或密码为空',
    'zh-TW': '使用者名稱或密碼為空',
  },
  'Username or password is incorrect': {
    'zh-CN': '用户名或密码错误',
    'zh-TW': '使用者名稱或密碼錯誤',
  },
  'No permission to update users of same or higher permission level': {
    'zh-CN': '无权修改同级或更高级别的用户',
    'zh-TW': '無權修改同級或更高層級的使用者',
  },
  'Current sign-in method does not support this action': {
    'zh-CN': '当前登录方式不支持该操作',
    'zh-TW': '目前登入方式不支援該操作',
  },

  // 渠道
  'Channel does not exist': { 'zh-CN': '渠道不存在', 'zh-TW': '渠道不存在' },
  'Failed to fetch channels. Please try again later': {
    'zh-CN': '获取渠道列表失败，请稍后重试',
    'zh-TW': '取得渠道列表失敗，請稍後重試',
  },
  'This channel is not in multi-key mode': {
    'zh-CN': '该渠道不是多密钥模式',
    'zh-TW': '該渠道不是多金鑰模式',
  },
  'No key index specified to enable': {
    'zh-CN': '未指定要启用的密钥索引',
    'zh-TW': '未指定要啟用的金鑰索引',
  },
  'Key index out of range': {
    'zh-CN': '密钥索引超出范围',
    'zh-TW': '金鑰索引超出範圍',
  },
  'Key enabled': { 'zh-CN': '密钥已启用', 'zh-TW': '金鑰已啟用' },
  'Enabled {{count}} keys': {
    'zh-CN': '已启用 {{count}} 个密钥',
    'zh-TW': '已啟用 {{count}} 個金鑰',
  },
  'Channel is not enabled': { 'zh-CN': '渠道未启用', 'zh-TW': '渠道未啟用' },
  'Failed to test channel': {
    'zh-CN': '测试渠道失败',
    'zh-TW': '測試渠道失敗',
  },

  // 令牌
  'Group {{Group}} is unavailable or unauthorized': {
    'zh-CN': '分组 {{Group}} 不可用或无权访问',
    'zh-TW': '分組 {{Group}} 不可用或無權存取',
  },
  'Auto group {{Group}} is unavailable or unauthorized': {
    'zh-CN': 'Auto 分组 {{Group}} 不可用或无权访问',
    'zh-TW': 'Auto 分組 {{Group}} 不可用或無權存取',
  },
  'A token can select at most {{Max}} Auto groups': {
    'zh-CN': '每个令牌最多可选择 {{Max}} 个 Auto 分组',
    'zh-TW': '每個權杖最多可選擇 {{Max}} 個 Auto 分組',
  },
  'Auto group {{Group}} is duplicated': {
    'zh-CN': 'Auto 分组 {{Group}} 重复',
    'zh-TW': 'Auto 分組 {{Group}} 重複',
  },
  'Token group name cannot be empty': {
    'zh-CN': '令牌分组名不能为空',
    'zh-TW': '權杖分組名不能為空',
  },

  // 日志与计费
  'Failed to query logs': {
    'zh-CN': '查询日志失败',
    'zh-TW': '查詢日誌失敗',
  },
  'The time range cannot exceed {{days}} days': {
    'zh-CN': '时间范围不能超过 {{days}} 天',
    'zh-TW': '時間範圍不能超過 {{days}} 天',
  },
  'Log export is disabled': {
    'zh-CN': '日志导出未启用',
    'zh-TW': '日誌匯出未啟用',
  },
  'Failed to search top-up records': {
    'zh-CN': '搜索充值记录失败',
    'zh-TW': '搜尋儲值記錄失敗',
  },
  'Invalid top-up amount': {
    'zh-CN': '充值金额不合法',
    'zh-TW': '儲值金額不合法',
  },

  // 设置
  'Invalid settings': { 'zh-CN': '设置不合法', 'zh-TW': '設定不合法' },
  'Failed to save settings': {
    'zh-CN': '保存设置失败',
    'zh-TW': '儲存設定失敗',
  },

  // 任务插件
  'A channel test task is already running or queued. Cannot start this manual task':
    {
      'zh-CN': '已有渠道测试任务在运行或排队中，无法启动本次手动任务',
      'zh-TW': '已有渠道測試任務在執行或排隊中，無法啟動本次手動任務',
    },
};

const HTML_ERROR_DOCUMENT = /^\s*(?:<!doctype|<html[\s>])/i;

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const interpolate = (text, params) => {
  if (!text || !isRecord(params)) {
    return text;
  }
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
};

const currentLanguage = () => i18n.language || 'zh-CN';

const translateServerKey = (key, params) => {
  if (!key) {
    return undefined;
  }
  const language = currentLanguage();
  const localized = SERVER_MESSAGES[key];
  const text =
    (localized && (localized[language] || localized[language.split('-')[0]])) ||
    undefined;
  if (text) {
    return interpolate(text, params);
  }
  // 没有收录的英文源串直接原样展示：它通常来自上游厂商，翻译反而失真。
  return interpolate(key, params);
};

/**
 * 解析一段后端响应里的控制台消息。
 * 优先用 message_key + message_params，退回 message 原文。
 */
export const resolveServerMessage = (payload) => {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (typeof payload.message_key === 'string' && payload.message_key) {
    return translateServerKey(payload.message_key, payload.message_params);
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    if (HTML_ERROR_DOCUMENT.test(payload.message)) {
      return undefined;
    }
    return payload.message;
  }
  return undefined;
};

/**
 * 把 axios 错误转换成可展示文案：优先后端 message_key，其次 error.message，
 * 最后是可选的兜底文案。
 */
export const resolveServerErrorMessage = (error, fallback) => {
  const responseData = error && error.response && error.response.data;
  const fromResponse = resolveServerMessage(responseData);
  if (fromResponse) {
    return fromResponse;
  }
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export default translateServerKey;

/**
 * 把一段后端返回的纯文本（例如 showError(res.data.message) 的入参）按同一张
 * 映射表翻译。命中不了就原样返回，保证上游厂商原文不会被吞掉。
 * 响应体里常见的「(request id: xxx)」后缀会在匹配前剥离、匹配后补回。
 */
export const translateServerText = (text) => {
  if (typeof text !== 'string' || !text.trim()) {
    return text;
  }
  const requestIdMatch = text.match(/\s*\(request id: [^)]+\)\s*$/);
  const suffix = requestIdMatch ? requestIdMatch[0] : '';
  const body = requestIdMatch ? text.slice(0, text.length - suffix.length) : text;
  const translated = translateServerKey(body.trim(), undefined);
  if (!translated || translated === body.trim()) {
    return text;
  }
  return translated + suffix;
};
