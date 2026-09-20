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

const TASK_PLUGIN_ENABLED_OPTION_KEY = 'TaskPluginEnabled';

export const useTaskPluginsData = () => {
  const { t } = useTranslation();

  // 插件列表
  const [plugins, setPlugins] = useState([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);
  const [pluginsRefreshing, setPluginsRefreshing] = useState(false);
  const pluginsLoadingRef = useRef(false);

  // 全局开关
  const [enabled, setEnabled] = useState(true);
  const [enabledLoading, setEnabledLoading] = useState(false);

  // 详情抽屉
  const [detailPluginKey, setDetailPluginKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [versions, setVersions] = useState([]);
  const detailRequestRef = useRef(0);

  // 上传对话框
  const [uploadKey, setUploadKey] = useState(null); // null=新建，字符串=覆盖已有 key
  const [uploadVisible, setUploadVisible] = useState(false);

  const loadPlugins = useCallback(
    async (silent = false) => {
      if (pluginsLoadingRef.current) return;
      pluginsLoadingRef.current = true;
      if (silent) {
        setPluginsRefreshing(true);
      } else {
        setPluginsLoading(true);
      }
      try {
        const res = await API.get('/api/plugin/task', {
          skipErrorHandler: silent,
        });
        const { success, message, data } = res.data;
        if (success) {
          setPlugins(Array.isArray(data) ? data : []);
        } else if (!silent) {
          showError(message || t('加载任务插件失败'));
        }
      } catch (_) {
        if (!silent) showError(t('加载任务插件失败'));
      } finally {
        pluginsLoadingRef.current = false;
        setPluginsLoading(false);
        setPluginsRefreshing(false);
      }
    },
    [t],
  );

  const loadEnabled = useCallback(async () => {
    try {
      const res = await API.get('/api/option/', { skipErrorHandler: true });
      const option = res.data?.data?.find(
        (item) => item.key === TASK_PLUGIN_ENABLED_OPTION_KEY,
      );
      // 未配置时视为启用（后端默认 true）
      setEnabled(option ? option.value === 'true' : true);
    } catch (_) {
      setEnabled(true);
    }
  }, []);

  const setGlobalEnabled = useCallback(
    async (next) => {
      setEnabledLoading(true);
      try {
        const res = await API.put('/api/option/', {
          key: TASK_PLUGIN_ENABLED_OPTION_KEY,
          value: next ? 'true' : 'false',
        });
        if (res.data?.success) {
          setEnabled(next);
          showSuccess(t('任务插件设置已更新'));
          return true;
        }
        showError(res.data?.message || t('设置更新失败'));
        return false;
      } catch (_) {
        // 全局拦截器已提示
        return false;
      } finally {
        setEnabledLoading(false);
      }
    },
    [t],
  );

  // 启停插件；被占用时返回 { blocked: true, channels, inFlightCount }
  const setPluginStatus = useCallback(
    async (key, nextEnabled, { cascade = false, force = false } = {}) => {
      const params = {};
      if (cascade) params.cascade = 'true';
      if (force) params.force = 'true';
      const res = await API.post(
        `/api/plugin/task/${key}/status`,
        { enabled: nextEnabled },
        { params },
      );
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(t('插件状态已更新'));
        loadPlugins(true);
        return { blocked: false };
      }
      if (data?.channels || data?.in_flight_count) {
        return {
          blocked: true,
          channels: data.channels || [],
          inFlightCount: data.in_flight_count || 0,
        };
      }
      showError(message || t('操作失败'));
      return { blocked: false };
    },
    [loadPlugins, t],
  );

  // 删除指定版本（factory 版本不可删）
  const deleteVersion = useCallback(
    async (key, version, force = false) => {
      const params = force ? { force: 'true' } : undefined;
      const res = await API.delete(
        `/api/plugin/task/${key}/versions/${encodeURIComponent(version)}`,
        { params },
      );
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(t('插件版本已删除'));
        loadPlugins(true);
        if (detailPluginKey === key) closeDetail();
        return { blocked: false };
      }
      if (data?.channels || data?.in_flight_count) {
        return {
          blocked: true,
          channels: data.channels || [],
          inFlightCount: data.in_flight_count || 0,
        };
      }
      showError(message || t('删除失败'));
      return { blocked: false };
    },
    [loadPlugins, t, detailPluginKey],
  );

  const activateVersion = useCallback(
    async (key, version) => {
      const res = await API.post(`/api/plugin/task/${key}/activate`, {
        version,
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('插件版本已启用'));
        loadPlugins(true);
        if (detailPluginKey === key) {
          openDetail(key);
        }
      } else {
        showError(message || t('操作失败'));
      }
    },
    [loadPlugins, t, detailPluginKey],
  );

  // 上传（新建或新版本）
  const uploadPlugin = useCallback(
    async ({ source, remark = '', enabledFlag, sourceSha256, force = false }) => {
      const body = { source, remark };
      if (typeof enabledFlag === 'boolean') body.enabled = enabledFlag;
      if (sourceSha256) body.sourceSha256 = sourceSha256;
      if (force) body.force = true;
      const res = await API.post('/api/plugin/task', body);
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(t('插件上传成功'));
        loadPlugins(true);
        if (data?.meta?.key && detailPluginKey === data.meta.key) {
          openDetail(data.meta.key);
        }
        return { success: true, meta: data?.meta || null };
      }
      return { success: false, message: message || t('上传失败') };
    },
    [loadPlugins, t, detailPluginKey],
  );

  const openDetail = useCallback(async (key) => {
    const request = ++detailRequestRef.current;
    setDetailPluginKey(key);
    setDetail(null);
    setVersions([]);
    setDetailLoading(true);
    try {
      const [detailRes, versionsRes] = await Promise.all([
        API.get(`/api/plugin/task/${key}`),
        API.get(`/api/plugin/task/${key}/versions`),
      ]);
      if (request !== detailRequestRef.current) return;
      if (detailRes.data?.success) {
        setDetail(detailRes.data.data);
      }
      if (versionsRes.data?.success) {
        setVersions(
          Array.isArray(versionsRes.data.data) ? versionsRes.data.data : [],
        );
      }
    } catch (_) {
      // 全局拦截器已提示
    } finally {
      if (request === detailRequestRef.current) {
        setDetailLoading(false);
      }
    }
  }, []);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailPluginKey(null);
    setDetail(null);
    setVersions([]);
    setDetailLoading(false);
  }, []);

  // 沙箱 dryrun
  const dryRun = useCallback(
    async (key, hook, member, args) => {
      const body = { hook, args };
      if (member) body.member = member;
      const res = await API.post(`/api/plugin/task/${key}/dryrun`, body);
      return res.data;
    },
    [],
  );

  // 市场来源
  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await API.get('/api/plugin/task/marketplace/sources', {
        skipErrorHandler: true,
      });
      const { success, data } = res.data;
      if (success) {
        setSources(Array.isArray(data) ? data : []);
      }
    } catch (_) {
      setSources([]);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const saveSources = useCallback(
    async (nextSources) => {
      const res = await API.put(
        '/api/plugin/task/marketplace/sources',
        nextSources,
      );
      const { success, message, data } = res.data;
      if (success) {
        setSources(Array.isArray(data) ? data : nextSources);
        showSuccess(t('市场来源已更新'));
        return true;
      }
      showError(message || t('保存失败'));
      return false;
    },
    [t],
  );

  // marketplace 安装：抓取源 -> sha256 -> 上传
  const installMarketplacePlugin = useCallback(
    async ({ plugin, version, sourceText, sourceSha256 }) => {
      return uploadPlugin({
        source: sourceText,
        remark: t('来自市场：{{name}}', { name: plugin.name }),
        enabledFlag: true,
        sourceSha256,
      });
    },
    [uploadPlugin, t],
  );

  const openUpload = useCallback((key = null) => {
    setUploadKey(key);
    setUploadVisible(true);
  }, []);

  const closeUpload = useCallback(() => {
    setUploadVisible(false);
    setUploadKey(null);
  }, []);

  useEffect(() => {
    loadPlugins();
    loadEnabled();
    loadSources();
  }, [loadPlugins, loadEnabled, loadSources]);

  return {
    // 列表
    plugins,
    pluginsLoading,
    pluginsRefreshing,
    loadPlugins,
    // 全局开关
    enabled,
    enabledLoading,
    setGlobalEnabled,
    // 插件操作
    setPluginStatus,
    deleteVersion,
    activateVersion,
    uploadPlugin,
    dryRun,
    // 详情
    detailPluginKey,
    detail,
    detailLoading,
    versions,
    openDetail,
    closeDetail,
    // 上传
    uploadVisible,
    uploadKey,
    openUpload,
    closeUpload,
    // 市场来源
    sources,
    sourcesLoading,
    loadSources,
    saveSources,
    installMarketplacePlugin,
    t,
  };
};
