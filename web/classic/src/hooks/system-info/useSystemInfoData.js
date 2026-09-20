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
import { API, showError, showSuccess } from '../../helpers';

export const INSTANCE_POLL_INTERVAL_MS = 30000;
export const TASK_ACTIVE_POLL_INTERVAL_MS = 8000;
const TASK_LIMIT = 20;

// 后端系统任务类型 -> 展示文案（未知类型回退为原始标识）
export const TASK_TYPE_LABELS = {
  log_cleanup: '日志清理',
  channel_test: '批量渠道测试',
  model_update: '批量上游模型更新',
  midjourney_poll: '绘图任务轮询',
  async_task_poll: '异步任务轮询',
};

const isActiveTaskStatus = (status) =>
  status === 'pending' || status === 'running';

export const useSystemInfoData = () => {
  const { t } = useTranslation();

  // 实例
  const [instances, setInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [instancesRefreshing, setInstancesRefreshing] = useState(false);
  const [deletingNodeName, setDeletingNodeName] = useState(null);
  const [deletingAllStale, setDeletingAllStale] = useState(false);
  const instancesLoadingRef = useRef(false);

  // 系统任务
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksRefreshing, setTasksRefreshing] = useState(false);
  const tasksLoadingRef = useRef(false);

  const loadInstances = useCallback(
    async (silent = false) => {
      if (instancesLoadingRef.current) return;
      instancesLoadingRef.current = true;
      if (silent) {
        setInstancesRefreshing(true);
      } else {
        setInstancesLoading(true);
      }
      try {
        const res = await API.get('/api/system-info/instances', {
          skipErrorHandler: silent,
        });
        const { success, message, data } = res.data;
        if (success) {
          setInstances(Array.isArray(data) ? data : []);
        } else if (!silent) {
          showError(message || t('加载实例失败'));
        }
      } catch (_) {
        if (!silent) showError(t('加载实例失败'));
      } finally {
        instancesLoadingRef.current = false;
        setInstancesLoading(false);
        setInstancesRefreshing(false);
      }
    },
    [t],
  );

  const deleteStaleInstance = useCallback(
    async (nodeName) => {
      setDeletingNodeName(nodeName);
      try {
        const res = await API.delete(`/api/system-info/instances/${nodeName}`);
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('已删除失效实例'));
        } else {
          showError(message || t('删除失败'));
        }
      } catch (_) {
        // 全局拦截器已提示
      } finally {
        setDeletingNodeName(null);
        loadInstances(true);
      }
    },
    [loadInstances, t],
  );

  const deleteStaleInstances = useCallback(async () => {
    setDeletingAllStale(true);
    try {
      const res = await API.delete('/api/system-info/stale-instances');
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(
          t('已删除 {{count}} 个失效实例', {
            count: data?.deleted_count ?? 0,
          }),
        );
      } else {
        showError(message || t('删除失败'));
      }
    } catch (_) {
      // 全局拦截器已提示
    } finally {
      setDeletingAllStale(false);
      loadInstances(true);
    }
  }, [loadInstances, t]);

  const loadTasks = useCallback(
    async (silent = false) => {
      if (tasksLoadingRef.current) return;
      tasksLoadingRef.current = true;
      if (silent) {
        setTasksRefreshing(true);
      } else {
        setTasksLoading(true);
      }
      try {
        const res = await API.get('/api/system-task/list', {
          params: { limit: TASK_LIMIT },
          skipErrorHandler: silent,
        });
        const { success, message, data } = res.data;
        if (success) {
          setTasks(Array.isArray(data) ? data : []);
        } else if (!silent) {
          showError(message || t('加载系统任务失败'));
        }
      } catch (_) {
        if (!silent) showError(t('加载系统任务失败'));
      } finally {
        tasksLoadingRef.current = false;
        setTasksLoading(false);
        setTasksRefreshing(false);
      }
    },
    [t],
  );

  const hasActiveTasks = tasks.some((task) => isActiveTaskStatus(task.status));

  useEffect(() => {
    loadInstances();
    const timer = setInterval(() => loadInstances(true), INSTANCE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadInstances]);

  useEffect(() => {
    loadTasks();
    const timer = setInterval(() => {
      if (hasActiveTasks) loadTasks(true);
    }, TASK_ACTIVE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadTasks, hasActiveTasks]);

  return {
    // 实例
    instances,
    instancesLoading,
    instancesRefreshing,
    deletingNodeName,
    deletingAllStale,
    loadInstances,
    deleteStaleInstance,
    deleteStaleInstances,
    // 系统任务
    tasks,
    tasksLoading,
    tasksRefreshing,
    hasActiveTasks,
    loadTasks,
    t,
  };
};
