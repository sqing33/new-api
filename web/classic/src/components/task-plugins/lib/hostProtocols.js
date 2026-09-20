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
 * 各宿主协议提供的端点，与 `pkg/jsplugin/routing.go` 的 hostProtocols 保持一致。
 * 该表在 apiVersion: 1 下冻结，因此客户端直接映射而不请求接口：
 * 插件 `meta.protocols` 声明只携带协议名，网关据此推导这些路径。
 */
export const HOST_PROTOCOL_ENDPOINTS = {
  openai_responses: [
    { method: 'POST', path: '/v1/responses', modeBearing: true },
    { method: 'GET', path: '/v1/responses/{response_id}' },
  ],
  openai_video: [
    { method: 'POST', path: '/v1/videos', modeBearing: true },
    { method: 'GET', path: '/v1/videos/{task_id}' },
    { method: 'GET', path: '/v1/videos/{task_id}/content' },
  ],
};
