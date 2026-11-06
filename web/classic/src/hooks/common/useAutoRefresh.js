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

import { useEffect, useRef } from 'react';

/**
 * 静默自动刷新：定时调用 onRefresh，失败不打扰用户，页面不可见时暂停。
 *
 * 与排行榜页（hooks/rankings/useRankingsData.js）的做法一致，区别是把
 * 「定时 + 静默 + 可见性暂停 + 防重入」收敛成共享 hook，供四个页面复用。
 *
 * onRefresh 必须是 useCallback 包裹的稳定引用，否则依赖数组每次渲染都变，
 * 定时器会被反复重建（等于每次渲染都重新计时）。
 *
 * @param {boolean} enabled 是否开启
 * @param {number} intervalMs 间隔（毫秒）
 * @param {(silent: boolean) => void | Promise<any>} onRefresh 刷新回调
 * @param {(error: any) => void} onError 出错时的回调（默认不打扰用户）
 */
export const useAutoRefresh = ({
  enabled,
  intervalMs,
  onRefresh,
  onError,
}) => {
  // 上一次请求是否还在进行中。慢请求会叠加，靠它保证同一时刻至多一个。
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || !intervalMs || intervalMs <= 0) {
      return undefined;
    }

    const tick = async () => {
      // 页面在后台时不刷新：用户不在看时每几秒打一次数据库是纯浪费。
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        await onRefresh(true);
      } catch (error) {
        // 静默模式下不弹 toast，只把错误交给调用方记录
        onError?.(error);
      } finally {
        inFlight.current = false;
      }
    };

    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, onRefresh, onError]);
};

export default useAutoRefresh;
