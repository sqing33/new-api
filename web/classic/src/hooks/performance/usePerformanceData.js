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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

export const PERFORMANCE_HOURS_OPTIONS = [
  { value: 24, label: '近 24 小时' },
  { value: 72, label: '近 3 天' },
  { value: 168, label: '近 7 天' },
];

export const usePerformanceData = () => {
  const { t } = useTranslation();
  const [hours, setHours] = useState(24);
  const [summary, setSummary] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);

  // 模型详情抽屉
  const [sheetModel, setSheetModel] = useState(null);
  const [sheetDetail, setSheetDetail] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const sheetRequestRef = useRef(0);

  const loadSummary = useCallback(
    async (silent = false) => {
      if (silent) {
        setSummaryRefreshing(true);
      } else {
        setSummaryLoading(true);
      }
      try {
        const res = await API.get('/api/perf-metrics/summary', {
          params: { hours },
          skipErrorHandler: silent,
        });
        const { success, message, data } = res.data;
        if (success) {
          setSummary(Array.isArray(data?.models) ? data.models : []);
        } else if (!silent) {
          showError(message || t('加载性能指标失败'));
        }
      } catch (_) {
        if (!silent) showError(t('加载性能指标失败'));
      } finally {
        setSummaryLoading(false);
        setSummaryRefreshing(false);
      }
    },
    [hours, t],
  );

  const openModelDetail = useCallback(async (modelName) => {
    const request = ++sheetRequestRef.current;
    setSheetModel(modelName);
    setSheetDetail(null);
    setSheetLoading(true);
    try {
      const res = await API.get('/api/perf-metrics', {
        params: { model: modelName, hours },
      });
      const { success, message, data } = res.data;
      if (request !== sheetRequestRef.current) return;
      if (success) {
        setSheetDetail(data);
      } else {
        showError(message || t('加载模型性能详情失败'));
      }
    } catch (_) {
      if (request === sheetRequestRef.current) {
        showError(t('加载模型性能详情失败'));
      }
    } finally {
      if (request === sheetRequestRef.current) {
        setSheetLoading(false);
      }
    }
  }, [hours, t]);

  const closeModelDetail = useCallback(() => {
    sheetRequestRef.current += 1;
    setSheetModel(null);
    setSheetDetail(null);
    setSheetLoading(false);
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  return {
    hours,
    setHours,
    summary,
    summaryLoading,
    summaryRefreshing,
    refresh: () => loadSummary(),
    sheetModel,
    sheetDetail,
    sheetLoading,
    openModelDetail,
    closeModelDetail,
    t,
  };
};
