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

import { useContext } from 'react';
import { StatusContext } from '../../context/Status';

// 后端 /api/status 下发的默认值，与 setting/auto_refresh_setting 保持一致。
const DEFAULT_ENABLED = true;
const DEFAULT_INTERVAL_SECONDS = 5;

/**
 * 读取管理页自动刷新配置。
 *
 * 配置是全局的（root 管理员在 /setting 里设置），经 /api/status 下发，
 * 由 StatusContext 缓存。/api/status 是应用启动时拉一次，所以管理员改完
 * 配置后用户需要刷新页面才生效——这与其他全局配置（如 SidebarModules）一致。
 *
 * @returns {{enabled: boolean, intervalMs: number}}
 */
export function useAutoRefreshSetting() {
  const [statusState] = useContext(StatusContext);
  const status = statusState?.status || {};

  // 后端没下发时按「默认开启」处理，避免配置尚未加载时误关自动刷新。
  const enabled = status.auto_refresh_enabled !== false;
  const intervalSeconds =
    Number(status.auto_refresh_interval_seconds) || DEFAULT_INTERVAL_SECONDS;

  return {
    enabled,
    intervalMs: intervalSeconds * 1000,
  };
}

export default useAutoRefreshSetting;
