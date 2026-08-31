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

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Card,
  Empty,
  Select,
  Space,
  Spin,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  AlertTriangle,
  Download,
  Loader2,
  PlayCircle,
  Video,
} from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { setStatusData } from '../../helpers/data';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import {
  getVideoModelSetting,
  normalizeVideoModelConfig,
  parseImageModelSettings,
  videoModelSupportsMode,
} from '../../helpers/imageModelSettings';

const { Text, Title } = Typography;

const API_ENDPOINTS = {
  VIDEO_SUBMIT: '/pg/videos',
  USER_GROUPS: '/api/user/self/groups',
};

const DEFAULT_CONFIG = {
  model: '',
  group: '',
  prompt: '',
  seconds: '4',
  size: '720x1280',
};

const STATUS_LABELS = {
  queued: '排队中',
  in_progress: '生成中',
  completed: '已完成',
  failed: '失败',
  unknown: '未知',
};

const selectOptions = (items) =>
  items.map((value) => ({ label: value, value }));

const extractErrorMessage = (error, fallback) =>
  error?.response?.data?.error?.message ||
  error?.response?.data?.message ||
  error?.message ||
  fallback;

const normalizeTaskStatus = (status) => {
  const value = String(status || '').toLowerCase();
  if (['completed', 'succeeded', 'success'].includes(value)) return 'completed';
  if (['failed', 'failure', 'cancelled', 'canceled'].includes(value)) {
    return 'failed';
  }
  if (['processing', 'in_progress', 'running'].includes(value)) {
    return 'in_progress';
  }
  if (['queued', 'pending', 'submitted', 'not_start'].includes(value)) {
    return 'queued';
  }
  return 'unknown';
};

const normalizeTaskResponse = (payload) => {
  const data =
    payload?.data && payload?.code === 'success' ? payload.data : payload;
  const status = normalizeTaskStatus(data?.status);
  const taskId = data?.id || data?.task_id;
  return {
    id: taskId,
    task_id: taskId,
    model: data?.model || data?.properties?.origin_model_name || '',
    status,
    progress:
      typeof data?.progress === 'number'
        ? `${data.progress}%`
        : data?.progress || '',
    error:
      data?.error || (data?.fail_reason ? { message: data.fail_reason } : null),
    raw: data,
  };
};

const getContentUrl = (taskId) => `/v1/videos/${taskId}/content`;

const VideoStudio = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [groups, setGroups] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [task, setTask] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoSrc, setVideoSrc] = useState('');
  const [lastError, setLastError] = useState('');
  const [modelSettingsValue, setModelSettingsValue] = useState(
    statusState?.status?.image_model_settings,
  );

  const modelSettings = useMemo(
    () =>
      parseImageModelSettings(
        modelSettingsValue ?? statusState?.status?.image_model_settings,
      ),
    [modelSettingsValue, statusState?.status?.image_model_settings],
  );

  const videoModelSettings = useMemo(
    () =>
      modelSettings.filter((setting) =>
        videoModelSupportsMode(setting, 'text_to_video'),
      ),
    [modelSettings],
  );

  const currentModelSetting = useMemo(
    () => getVideoModelSetting(videoModelSettings, config.model),
    [videoModelSettings, config.model],
  );

  const videoConfig = useMemo(
    () => normalizeVideoModelConfig(currentModelSetting?.video),
    [currentModelSetting],
  );

  const groupOptions = useMemo(() => {
    if (groups.length === 0) return [{ value: '', label: t('用户默认分组') }];
    return groups.map((group) => ({
      value: group.value,
      label: group.desc ? `${group.label} (${group.desc})` : group.label,
    }));
  }, [groups, t]);

  const modelOptions = useMemo(
    () =>
      videoModelSettings.map((setting) => ({
        value: setting.model,
        label: setting.label
          ? `${setting.label} (${setting.model})`
          : setting.model,
      })),
    [videoModelSettings],
  );

  useEffect(() => {
    const loadData = async () => {
      setLoadingModels(true);
      try {
        const [groupsRes, statusRes] = await Promise.all([
          API.get(API_ENDPOINTS.USER_GROUPS),
          API.get('/api/status'),
        ]);

        const groupData =
          groupsRes.data?.success && groupsRes.data?.data
            ? groupsRes.data.data
            : {};
        setGroups(
          Object.entries(groupData).map(([value, info]) => ({
            label: value,
            value,
            ratio: info?.ratio || 1,
            desc: info?.desc || value,
          })),
        );

        if (statusRes.data?.success && statusRes.data?.data) {
          const nextStatus = statusRes.data.data;
          setModelSettingsValue(nextStatus.image_model_settings);
          statusDispatch({ type: 'set', payload: nextStatus });
          setStatusData(nextStatus);
        }
      } catch (error) {
        showError(extractErrorMessage(error, t('加载模型与分组失败')));
      } finally {
        setLoadingModels(false);
      }
    };

    loadData();
  }, [statusDispatch, t]);

  useEffect(() => {
    if (videoModelSettings.length === 0) return;
    if (!videoModelSettings.some((setting) => setting.model === config.model)) {
      setConfig((current) => ({
        ...current,
        model: videoModelSettings[0].model,
      }));
    }
  }, [config.model, videoModelSettings]);

  useEffect(() => {
    if (!currentModelSetting) return;
    setConfig((current) => ({
      ...current,
      seconds: videoConfig.durations.includes(current.seconds)
        ? current.seconds
        : videoConfig.default_seconds,
      size: videoConfig.sizes.includes(current.size)
        ? current.size
        : videoConfig.default_size,
    }));
  }, [currentModelSetting, videoConfig]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((group) => group.value === config.group)) {
      setConfig((current) => ({ ...current, group: groups[0]?.value || '' }));
    }
  }, [config.group, groups]);

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const ensureContentReady = async (taskId) => {
    const response = await fetch(getContentUrl(taskId), {
      credentials: 'include',
      headers: { Range: 'bytes=0-0' },
    });
    if (response.ok) {
      if (response.body?.cancel) response.body.cancel();
      return true;
    }

    let message = '';
    try {
      const data = await response.json();
      message = data?.error?.message || data?.message || '';
    } catch {
      message = response.statusText;
    }
    if (
      message.toLowerCase().includes('not completed') ||
      message.toLowerCase().includes('not_start')
    ) {
      return false;
    }
    throw new Error(message || t('视频内容暂不可用'));
  };

  const fetchTask = async (taskId) => {
    const res = await API.get(`/pg/videos/${taskId}`, {
      skipErrorHandler: true,
    });
    return normalizeTaskResponse(res.data);
  };

  useEffect(() => {
    if (!task?.id || videoReady || task.status === 'failed') return undefined;

    let cancelled = false;
    let timer = null;

    const poll = async () => {
      setPolling(true);
      try {
        const nextTask = await fetchTask(task.id);
        if (cancelled) return;
        setTask(nextTask);

        if (nextTask.status === 'completed') {
          const ready = await ensureContentReady(nextTask.id);
          if (cancelled) return;
          if (ready) {
            setVideoReady(true);
            setVideoSrc(`${getContentUrl(nextTask.id)}?t=${Date.now()}`);
            setLastError('');
            return;
          }
        }

        if (nextTask.status === 'failed') {
          setLastError(nextTask.error?.message || t('视频生成失败'));
          return;
        }

        timer = setTimeout(poll, 5000);
      } catch (error) {
        if (cancelled) return;
        setLastError(extractErrorMessage(error, t('查询视频任务失败')));
        timer = setTimeout(poll, 8000);
      } finally {
        if (!cancelled) setPolling(false);
      }
    };

    timer = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [task?.id, task?.status, videoReady, t]);

  const handleGenerate = async () => {
    if (!currentModelSetting) {
      showError(t('当前模型没有视频配置'));
      return;
    }
    if (!videoModelSupportsMode(currentModelSetting, 'text_to_video')) {
      showError(t('当前模型不支持文生视频'));
      return;
    }
    if (!config.prompt.trim()) {
      showError(t('请输入提示词'));
      return;
    }

    setSubmitting(true);
    setLastError('');
    setTask(null);
    setVideoReady(false);
    setVideoSrc('');

    try {
      const payload = {
        model: config.model,
        prompt: config.prompt,
        seconds: config.seconds,
        size: config.size,
      };
      if (config.group) payload.group = config.group;
      const res = await API.post(API_ENDPOINTS.VIDEO_SUBMIT, payload, {
        skipErrorHandler: true,
      });
      const nextTask = normalizeTaskResponse(res.data);
      if (!nextTask.id) throw new Error(t('接口未返回任务 ID'));
      setTask(nextTask);
      showSuccess(t('视频任务已提交'));
    } catch (error) {
      const message = extractErrorMessage(error, t('视频生成请求失败'));
      setLastError(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadVideo = () => {
    if (!task?.id || !videoReady) return;
    const link = document.createElement('a');
    link.href = getContentUrl(task.id);
    link.download = `${task.id}.mp4`;
    link.click();
    showSuccess(t('已开始下载'));
  };

  const statusLabel = task ? STATUS_LABELS[task.status] || task.status : '';
  const busy = submitting || polling;

  return (
    <div className='mt-[60px] px-2'>
      <div className='mb-4 flex flex-col gap-1'>
        <Title heading={3} style={{ margin: 0 }}>
          {t('视频')}
        </Title>
        <Text type='tertiary'>{t('通过异步任务生成视频并在完成后播放。')}</Text>
      </div>

      <div
        className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-[360px_1fr]'}`}
      >
        <Card bordered title={t('生成参数')}>
          <Spin spinning={loadingModels}>
            <div className='flex flex-col gap-4'>
              {videoModelSettings.length === 0 && (
                <Banner
                  closeIcon={null}
                  description={t('管理员尚未配置支持文生视频的模型。')}
                  icon={<AlertTriangle size={16} />}
                  type='warning'
                />
              )}

              <div className='flex flex-col gap-2'>
                <Text strong>{t('模型')}</Text>
                <Select
                  disabled={busy || videoModelSettings.length === 0}
                  onChange={(value) => updateConfig('model', value)}
                  optionList={modelOptions}
                  value={config.model}
                />
              </div>

              <div className='flex flex-col gap-2'>
                <Text strong>{t('分组')}</Text>
                <Select
                  disabled={busy}
                  onChange={(value) => updateConfig('group', value)}
                  optionList={groupOptions}
                  value={config.group}
                />
              </div>

              <div className='flex flex-col gap-2'>
                <Text strong>{t('提示词')}</Text>
                <TextArea
                  autosize={{ minRows: 6, maxRows: 12 }}
                  disabled={busy}
                  onChange={(value) => updateConfig('prompt', value)}
                  placeholder={t('描述你想生成的视频内容')}
                  value={config.prompt}
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('时长')}</Text>
                  <Select
                    disabled={busy}
                    onChange={(value) => updateConfig('seconds', value)}
                    optionList={selectOptions(videoConfig.durations).map(
                      (item) => ({
                        ...item,
                        label: `${item.label}s`,
                      }),
                    )}
                    value={config.seconds}
                  />
                </div>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('尺寸')}</Text>
                  <Select
                    disabled={busy}
                    onChange={(value) => updateConfig('size', value)}
                    optionList={selectOptions(videoConfig.sizes)}
                    value={config.size}
                  />
                </div>
              </div>

              <Button
                block
                disabled={busy || videoModelSettings.length === 0}
                icon={
                  submitting ? (
                    <Loader2 className='animate-spin' size={16} />
                  ) : (
                    <Video size={16} />
                  )
                }
                onClick={handleGenerate}
                theme='solid'
                type='primary'
              >
                {submitting ? t('提交中') : t('生成视频')}
              </Button>
            </div>
          </Spin>
        </Card>

        <Card bordered title={t('视频结果')}>
          <div className='flex min-h-[520px] flex-col gap-4'>
            {task && (
              <div className='flex flex-wrap items-center gap-3'>
                <Tag color={task.status === 'failed' ? 'red' : 'blue'}>
                  {t(statusLabel)}
                </Tag>
                {task.progress && <Text type='tertiary'>{task.progress}</Text>}
                <Text copyable={{ content: task.id }} type='tertiary'>
                  {task.id}
                </Text>
                {polling && <Loader2 className='animate-spin' size={16} />}
              </div>
            )}

            {lastError && (
              <Banner closeIcon={null} description={lastError} type='danger' />
            )}

            {videoReady && videoSrc ? (
              <>
                <video
                  className='w-full rounded border border-solid border-[var(--semi-color-border)] bg-black'
                  controls
                  src={videoSrc}
                  style={{ maxHeight: '70vh' }}
                />
                <Space wrap>
                  <Button icon={<Download size={16} />} onClick={downloadVideo}>
                    {t('下载视频')}
                  </Button>
                </Space>
              </>
            ) : task ? (
              <div className='flex flex-1 items-center justify-center rounded border border-dashed border-[var(--semi-color-border)] p-8'>
                <Empty
                  description={
                    task.status === 'failed'
                      ? t('视频生成失败')
                      : t('视频生成中，请稍候')
                  }
                  image={<PlayCircle size={56} />}
                />
              </div>
            ) : (
              <div className='flex flex-1 items-center justify-center rounded border border-dashed border-[var(--semi-color-border)] p-8'>
                <Empty
                  description={t('生成后的视频会显示在这里')}
                  image={<Video size={56} />}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default VideoStudio;
