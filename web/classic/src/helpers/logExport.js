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
import { downloadTextAsFile, timestamp2string } from './utils';

/**
 * 日志导出。
 *
 * 后端 GET /api/log/export 与 /api/log/self/export 以 NDJSON 流式返回，
 * 最后一行是 { success, message, data: { count } } 的包装对象。
 * 这里把它解析成行数组，再按控制台表格同样的列拼成 CSV 下发。
 */

const parseNdjson = (raw) =>
  String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

const escapeCsv = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  const text = String(value).replace(/"/g, '""');
  return /[",\n]/.test(text) ? '"' + text + '"' : text;
};

export const exportLogsToCsv = async ({ isAdminUser, params, t }) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
      return;
    }
    query.set(key, value);
  });
  const base = isAdminUser ? '/api/log/export' : '/api/log/self/export';
  const res = await API.get(base + '?' + query.toString(), {
    responseType: 'text',
  });
  const rows = parseNdjson(res.data);
  const logRows = rows.filter((row) => row && row.created_at !== undefined);
  if (logRows.length === 0) {
    return 0;
  }
  const header = [
    t('时间'),
    t('类型'),
    t('用户名'),
    t('令牌名称'),
    t('分组'),
    t('模型'),
    t('渠道'),
    t('消耗额度'),
    t('输入 Token'),
    t('输出 Token'),
    t('耗时（秒）'),
    t('请求 ID'),
  ];
  const lines = [header.map(escapeCsv).join(',')];
  logRows.forEach((row) => {
    lines.push(
      [
        timestamp2string(row.created_at),
        row.type,
        row.username,
        row.token_name,
        row.group,
        row.model_name,
        row.channel,
        row.quota,
        row.prompt_tokens,
        row.completion_tokens,
        row.use_time,
        row.request_id,
      ]
        .map(escapeCsv)
        .join(','),
    );
  });
  const stamp = timestamp2string(Date.now() / 1000).replace(/[^0-9]/g, '');
  downloadTextAsFile('\ufeff' + lines.join('\n'), 'logs-' + stamp + '.csv');
  return logRows.length;
};
