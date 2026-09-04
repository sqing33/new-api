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

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

// 与后端 5 分钟缓存一致的前端刷新间隔
export const RANKINGS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const RANKINGS_PERIODS = ['today', 'week', 'month', 'year'];

const isValidPeriod = (value) => RANKINGS_PERIODS.includes(value);

export const useRankingsData = () => {
  const { t } = useTranslation();
  const [period, setPeriodState] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('period');
    return isValidPeriod(fromUrl) ? fromUrl : 'week';
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await API.get('/api/rankings', {
          params: { period },
          skipErrorHandler: silent,
        });
        const { success, message, data: payload } = res.data;
        if (success) {
          setData(payload);
          setError(null);
        } else if (!silent) {
          setError(message || t('加载排行榜数据失败'));
          showError(message || t('加载排行榜数据失败'));
        }
      } catch (e) {
        if (!silent) {
          setError(e?.message || t('加载排行榜数据失败'));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, t],
  );

  const setPeriod = (next) => {
    if (!isValidPeriod(next) || next === period) return;
    setPeriodState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('period', next);
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), RANKINGS_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return {
    period,
    setPeriod,
    data,
    loading,
    refreshing,
    error,
    refresh: () => load(),
    t,
  };
};
