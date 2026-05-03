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
  InputNumber,
  Modal,
  Select,
  Spin,
  Tabs,
  TextArea,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  History,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { setStatusData } from '../../helpers/data';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import {
  getImageModelSetting,
  imageModelSupportsMode,
  parseImageModelSettings,
} from '../../helpers/imageModelSettings';
import {
  addImageHistoryRecord,
  clearImageHistory,
  deleteImageHistoryRecord,
  listImageHistory,
} from '../../helpers/imageHistory';

const { Text } = Typography;

const API_ENDPOINTS = {
  IMAGE_GENERATIONS: '/pg/images/generations',
  IMAGE_EDITS: '/pg/images/edits',
  USER_GROUPS: '/api/user/self/groups',
};

const RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
const FIXED_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
const RESOLUTIONS = ['auto', 'standard', '2k', '4k'];

const RESOLUTION_LABELS = {
  auto: '自动',
  standard: '标准',
  '2k': '2K',
  '4k': '4K',
};

const SIZE_MAP = {
  standard: {
    '1:1': '1024x1024',
    '2:3': '1024x1536',
    '3:2': '1536x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '9:16': '1008x1792',
    '16:9': '1792x1008',
  },
  '2k': {
    '1:1': '2048x2048',
    '2:3': '1344x2016',
    '3:2': '2016x1344',
    '3:4': '1536x2048',
    '4:3': '2048x1536',
    '9:16': '1152x2048',
    '16:9': '2048x1152',
  },
  '4k': {
    '1:1': '2880x2880',
    '2:3': '2336x3504',
    '3:2': '3504x2336',
    '3:4': '2448x3264',
    '4:3': '3264x2448',
    '9:16': '2160x3840',
    '16:9': '3840x2160',
  },
};

const DEFAULT_CONFIG = {
  model: '',
  group: '',
  prompt: '',
  count: 1,
  ratio: '1:1',
  resolution: 'standard',
};

const selectOptions = (items, labels = {}) =>
  items.map((value) => ({ label: labels[value] || value, value }));

const getImageSize = (ratio, resolution) => {
  if (ratio === 'auto' || resolution === 'auto') return '';
  return SIZE_MAP[resolution]?.[ratio] || '';
};

const getAvailableRatios = (resolution) =>
  resolution === 'auto' ? RATIOS : FIXED_RATIOS;

const getRatioPreviewStyle = (ratio) => {
  if (ratio === 'auto') {
    return {
      width: 18,
      height: 18,
    };
  }

  const [width, height] = ratio.split(':').map(Number);
  const maxWidth = 18;
  const maxHeight = 18;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(6, width * scale),
    height: Math.max(6, height * scale),
  };
};

const normalizeRatioForResolution = (ratio, resolution) => {
  const available = getAvailableRatios(resolution);
  return available.includes(ratio) ? ratio : available[0];
};

const resultSource = (result) => {
  if (result?.url) return result.url;
  if (result?.b64_json) return `data:image/png;base64,${result.b64_json}`;
  return '';
};

const extractErrorMessage = (error, fallback) =>
  error?.response?.data?.error?.message ||
  error?.response?.data?.error ||
  error?.response?.data?.message ||
  error?.response?.statusText ||
  error?.message ||
  fallback;

const ImageStudio = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [mode, setMode] = useState('generate');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [groups, setGroups] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [imageFileList, setImageFileList] = useState([]);
  const [results, setResults] = useState([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [lastError, setLastError] = useState('');
  const [imageErrors, setImageErrors] = useState({});
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [resultTab, setResultTab] = useState('current');
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyImageErrors, setHistoryImageErrors] = useState({});
  const [imageModelSettingsValue, setImageModelSettingsValue] = useState(
    statusState?.status?.image_model_settings,
  );

  const imageModelSettings = useMemo(
    () =>
      parseImageModelSettings(
        imageModelSettingsValue ?? statusState?.status?.image_model_settings,
      ),
    [imageModelSettingsValue, statusState?.status?.image_model_settings],
  );

  const filteredModels = useMemo(
    () => [
      ...new Set(
        imageModelSettings
          .filter(
            (setting) =>
              Array.isArray(setting.modes) && setting.modes.length > 0,
          )
          .map((setting) => setting.model),
      ),
    ],
    [imageModelSettings],
  );

  const currentModelSetting = useMemo(
    () => getImageModelSetting(imageModelSettings, config.model),
    [imageModelSettings, config.model],
  );

  const currentModeKey = mode === 'edit' ? 'edits' : 'generations';
  const selectedSize = getImageSize(config.ratio, config.resolution);
  const maxCount = currentModelSetting?.max_n || 1;

  const groupOptions = useMemo(() => {
    if (groups.length === 0) return [{ value: '', label: t('用户默认分组') }];

    return groups.map((group) => ({
      value: group.value,
      label: group.desc
        ? `${group.label} (${group.desc})`
        : group.label || group.value,
    }));
  }, [groups, t]);

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
          setImageModelSettingsValue(nextStatus.image_model_settings);
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
    if (filteredModels.length === 0) return;
    if (!filteredModels.includes(config.model)) {
      setConfig((current) => ({ ...current, model: filteredModels[0] }));
    }
  }, [filteredModels, config.model]);

  useEffect(() => {
    if (!currentModelSetting) return;

    if (!imageModelSupportsMode(currentModelSetting, currentModeKey)) {
      const nextMode = imageModelSupportsMode(
        currentModelSetting,
        'generations',
      )
        ? 'generate'
        : 'edit';
      setMode(nextMode);
    }

    setConfig((current) => ({
      ...current,
      count: Math.min(Math.max(Number(current.count) || 1, 1), maxCount),
      ratio: normalizeRatioForResolution(current.ratio, current.resolution),
    }));
  }, [currentModelSetting, currentModeKey, maxCount]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((group) => group.value === config.group)) {
      setConfig((current) => ({ ...current, group: groups[0].value }));
    }
  }, [groups, config.group]);

  useEffect(() => {
    if (results.length === 0) {
      setCurrentResultIndex(0);
      return;
    }
    if (currentResultIndex > results.length - 1) {
      setCurrentResultIndex(results.length - 1);
    }
  }, [results.length, currentResultIndex]);

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const handleReferenceUploadChange = ({ fileList = [] }) => {
    const nextFileList = fileList.filter((item) => item.fileInstance);
    setImageFileList(nextFileList);
    setImageFiles(nextFileList.map((item) => item.fileInstance));
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistoryRecords(await listImageHistory());
    } catch (error) {
      showError(extractErrorMessage(error, t('加载历史记录失败')));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const updateResolution = (resolution) => {
    setConfig((current) => ({
      ...current,
      resolution,
      ratio: normalizeRatioForResolution(current.ratio, resolution),
    }));
  };

  const pickerButtonStyle = (active, disabled = false) => ({
    alignItems: 'center',
    background: active ? 'var(--semi-color-primary)' : 'var(--semi-color-bg-2)',
    border: `1px solid ${
      active ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'
    }`,
    borderRadius: 8,
    color: active ? 'var(--semi-color-white)' : 'var(--semi-color-text-1)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    flexDirection: 'column',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    gap: 5,
    justifyContent: 'center',
    minHeight: 56,
    opacity: disabled ? 0.6 : 1,
    padding: '8px 4px',
    transition: 'all 120ms ease',
  });

  const renderRatioPicker = () => (
    <div className='flex flex-col gap-2'>
      <Text strong>{t('比例')}</Text>
      <div
        role='radiogroup'
        aria-label={t('图片比例')}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {getAvailableRatios(config.resolution).map((ratio) => {
          const active = ratio === config.ratio;
          return (
            <button
              aria-checked={active}
              disabled={generating}
              key={ratio}
              onClick={() => updateConfig('ratio', ratio)}
              role='radio'
              style={pickerButtonStyle(active, generating)}
              type='button'
            >
              <span
                style={{
                  ...getRatioPreviewStyle(ratio),
                  border: '1.7px solid currentColor',
                  borderRadius: 3,
                  display: 'block',
                }}
              />
              <span>{ratio === 'auto' ? t('自动') : ratio}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderResolutionPicker = () => (
    <div className='flex flex-col gap-2'>
      <Text strong>{t('分辨率')}</Text>
      <div
        role='radiogroup'
        aria-label={t('分辨率档位')}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {RESOLUTIONS.map((resolution) => {
          const active = resolution === config.resolution;
          return (
            <button
              aria-checked={active}
              disabled={generating}
              key={resolution}
              onClick={() => updateResolution(resolution)}
              role='radio'
              style={{
                ...pickerButtonStyle(active, generating),
                fontSize: 13,
                fontWeight: 700,
                minHeight: 42,
              }}
              type='button'
            >
              {t(RESOLUTION_LABELS[resolution])}
            </button>
          );
        })}
      </div>
    </div>
  );

  const buildGenerationPayload = () => {
    const payload = {
      model: config.model,
      prompt: config.prompt,
      n: 1,
      response_format: 'b64_json',
    };
    if (config.group) payload.group = config.group;
    if (selectedSize) payload.size = selectedSize;
    return payload;
  };

  const buildFormData = () => {
    const formData = new FormData();
    formData.append('model', config.model);
    if (config.group) formData.append('group', config.group);
    formData.append('prompt', config.prompt);
    formData.append('n', '1');
    formData.append('response_format', 'b64_json');
    if (selectedSize) formData.append('size', selectedSize);
    imageFiles.forEach((file) => formData.append('image[]', file));
    return formData;
  };

  const requestOneImage = async () => {
    const res =
      mode === 'edit'
        ? await API.post(API_ENDPOINTS.IMAGE_EDITS, buildFormData(), {
            skipErrorHandler: true,
          })
        : await API.post(
            API_ENDPOINTS.IMAGE_GENERATIONS,
            buildGenerationPayload(),
            {
              skipErrorHandler: true,
            },
          );
    const data = Array.isArray(res.data?.data) ? res.data.data : [];
    if (data.length === 0) throw new Error(t('接口未返回图片'));
    return data[0];
  };

  const saveImageHistory = async (result) => {
    const source = resultSource(result);
    if (!source) return;

    await addImageHistoryRecord({
      mode,
      model: config.model,
      group: config.group,
      prompt: config.prompt,
      ratio: config.ratio,
      resolution: config.resolution,
      size: selectedSize,
      image: source,
      revised_prompt: result.revised_prompt || '',
    });
  };

  const handleGenerate = async () => {
    if (!currentModelSetting) {
      showError(t('当前模型没有生图配置'));
      return;
    }
    if (!imageModelSupportsMode(currentModelSetting, currentModeKey)) {
      showError(t('当前模型不支持该生图模式'));
      return;
    }
    if (!config.prompt.trim()) {
      showError(t('请输入提示词'));
      return;
    }
    if (mode === 'edit' && imageFiles.length === 0) {
      showError(t('请先上传参考图'));
      return;
    }

    const total = Math.min(Math.max(Number(config.count) || 1, 1), maxCount);
    const failures = [];
    let historySaveFailed = false;

    setGenerating(true);
    setGeneratedCount(0);
    setLastError('');
    setResults([]);
    setCurrentResultIndex(0);
    setImageErrors({});

    try {
      for (let index = 0; index < total; index += 1) {
        try {
          const result = await requestOneImage();
          setResults((current) => [...current, result]);
          try {
            await saveImageHistory(result);
          } catch {
            historySaveFailed = true;
          }
        } catch (error) {
          failures.push(extractErrorMessage(error, t('生图请求失败')));
        } finally {
          setGeneratedCount(index + 1);
        }
      }

      if (failures.length === total) {
        const message = failures[0] || t('生图请求失败');
        setLastError(message);
        showError(message);
      } else if (failures.length > 0) {
        setLastError(
          t('部分图片生成失败：') + [...new Set(failures)].join('；'),
        );
      }

      if (historySaveFailed) {
        showError(t('历史记录保存失败'));
      }
      await loadHistory();
    } finally {
      setGenerating(false);
    }
  };

  const downloadSource = (href, filename) => {
    if (!href) return;

    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess(t('已开始下载'));
  };

  const handleDownload = (result, index) => {
    downloadSource(resultSource(result), `image-studio-${index + 1}.png`);
  };

  const handleHistoryDownload = (record) => {
    downloadSource(record.image, `image-studio-history-${record.id}.png`);
  };

  const formatHistoryTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  };

  const previewHistoryRecord = (record) => {
    Modal.info({
      title: t('查看历史图片'),
      width: 720,
      content: (
        <div className='flex flex-col gap-3'>
          <div
            className='flex items-center justify-center overflow-hidden rounded'
            style={{
              background: 'var(--semi-color-fill-0)',
              maxHeight: 520,
            }}
          >
            <img
              alt={record.revised_prompt || record.prompt}
              className='max-h-[520px] max-w-full object-contain'
              src={record.image}
            />
          </div>
          <Text ellipsis={{ showTooltip: true, rows: 4 }} type='tertiary'>
            {record.revised_prompt || record.prompt}
          </Text>
        </div>
      ),
      okText: t('关闭'),
    });
  };

  const removeHistoryRecord = (record) => {
    Modal.confirm({
      title: t('确认删除'),
      content: t('确定要删除这条历史记录吗？'),
      okText: t('删除'),
      onOk: async () => {
        try {
          await deleteImageHistoryRecord(record.id);
          setHistoryImageErrors((current) => {
            const next = { ...current };
            delete next[record.id];
            return next;
          });
          await loadHistory();
          showSuccess(t('删除成功'));
        } catch (error) {
          showError(extractErrorMessage(error, t('删除失败')));
        }
      },
    });
  };

  const removeAllHistory = () => {
    Modal.confirm({
      title: t('确认清空历史记录'),
      content: t('清空后无法恢复，确定要删除全部生图历史记录吗？'),
      okText: t('清空'),
      onOk: async () => {
        try {
          await clearImageHistory();
          setHistoryImageErrors({});
          await loadHistory();
          showSuccess(t('已清空'));
        } catch (error) {
          showError(extractErrorMessage(error, t('清空历史记录失败')));
        }
      },
    });
  };

  const showPreviousResult = () => {
    setCurrentResultIndex((current) =>
      current === 0 ? results.length - 1 : current - 1,
    );
  };

  const showNextResult = () => {
    setCurrentResultIndex((current) =>
      current === results.length - 1 ? 0 : current + 1,
    );
  };

  const renderCurrentResults = () => {
    if (results.length === 0) {
      return (
        <div className='flex min-h-[420px] items-center justify-center'>
          <Empty
            description={t('生成的图片会显示在这里')}
            image={<ImageIcon size={44} color='var(--semi-color-text-2)' />}
            title={t('暂无图片')}
          />
        </div>
      );
    }

    const result = results[currentResultIndex] || results[0];
    const source = resultSource(result);
    const imageFailed = imageErrors[currentResultIndex];
    const hasMultipleResults = results.length > 1;

    return (
      <div className='flex flex-col gap-3'>
        <div
          className='relative flex items-center justify-center overflow-hidden rounded'
          style={{
            background: 'var(--semi-color-fill-0)',
            height: isMobile ? 380 : 'calc(100vh - 250px)',
            minHeight: 340,
          }}
        >
          {source && !imageFailed ? (
            <img
              alt={result.revised_prompt || config.prompt}
              className='max-h-full max-w-full object-contain'
              onError={() => {
                setImageErrors((current) => ({
                  ...current,
                  [currentResultIndex]: true,
                }));
                showError(t('图片加载失败'));
              }}
              src={source}
            />
          ) : (
            <Text type='tertiary'>
              {source ? t('图片加载失败') : t('不支持的图片数据')}
            </Text>
          )}

          {hasMultipleResults && (
            <>
              <Button
                aria-label='previous image'
                className='absolute left-3 top-1/2 -translate-y-1/2'
                icon={<ChevronLeft size={22} />}
                onClick={showPreviousResult}
                style={{ borderRadius: 999 }}
                theme='solid'
                type='tertiary'
              />
              <Button
                aria-label='next image'
                className='absolute right-3 top-1/2 -translate-y-1/2'
                icon={<ChevronRight size={22} />}
                onClick={showNextResult}
                style={{ borderRadius: 999 }}
                theme='solid'
                type='tertiary'
              />
            </>
          )}
        </div>

        <div className='flex items-center justify-between gap-3'>
          <Text type='tertiary'>
            {currentResultIndex + 1}/{results.length}
          </Text>
          <Button
            disabled={!source}
            icon={<Download size={16} />}
            onClick={() => handleDownload(result, currentResultIndex)}
            theme='outline'
          >
            {t('下载')}
          </Button>
        </div>

        {result.revised_prompt && (
          <Text
            ellipsis={{ showTooltip: true, rows: 3 }}
            size='small'
            type='tertiary'
          >
            {result.revised_prompt}
          </Text>
        )}

      </div>
    );
  };

  const renderHistoryRecords = () => (
    <Spin spinning={historyLoading}>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <Text type='tertiary'>
          {t('仅保存在当前浏览器，最多保留 50 条')}
        </Text>
        <Button
          disabled={historyRecords.length === 0}
          icon={<Trash2 size={15} />}
          onClick={removeAllHistory}
          theme='outline'
          type='danger'
        >
          {t('清空')}
        </Button>
      </div>

      {historyRecords.length === 0 ? (
        <div className='flex min-h-[380px] items-center justify-center'>
          <Empty
            description={t('生成成功后会自动保存到这里')}
            image={<History size={44} color='var(--semi-color-text-2)' />}
            title={t('暂无历史记录')}
          />
        </div>
      ) : (
        <div
          className='grid gap-4'
          style={{
            gridTemplateColumns: isMobile
              ? '1fr'
              : 'repeat(auto-fill, minmax(220px, 1fr))',
          }}
        >
          {historyRecords.map((record) => {
            const imageFailed = historyImageErrors[record.id];
            return (
              <Card
                bordered
                bodyStyle={{ padding: 12 }}
                className='overflow-hidden'
                key={record.id}
              >
                <button
                  className='mb-3 flex w-full items-center justify-center overflow-hidden rounded border-0 p-0'
                  onClick={() => previewHistoryRecord(record)}
                  style={{
                    aspectRatio: '1 / 1',
                    background: 'var(--semi-color-fill-0)',
                    cursor: 'pointer',
                  }}
                  type='button'
                >
                  {record.image && !imageFailed ? (
                    <img
                      alt={record.revised_prompt || record.prompt}
                      className='h-full w-full object-cover'
                      onError={() =>
                        setHistoryImageErrors((current) => ({
                          ...current,
                          [record.id]: true,
                        }))
                      }
                      src={record.image}
                    />
                  ) : (
                    <Text type='tertiary'>{t('图片加载失败')}</Text>
                  )}
                </button>

                <div className='mb-3 flex flex-col gap-1'>
                  <Text ellipsis={{ showTooltip: true }} strong>
                    {record.model || t('未知模型')}
                  </Text>
                  <Text size='small' type='tertiary'>
                    {record.mode === 'edit' ? t('图生图') : t('文生图')} ·{' '}
                    {record.size || t('自动')}
                  </Text>
                  <Text
                    className='flex items-center gap-1'
                    size='small'
                    type='tertiary'
                  >
                    <Clock3 size={13} />
                    {formatHistoryTime(record.created_at)}
                  </Text>
                  <Text
                    ellipsis={{ showTooltip: true, rows: 2 }}
                    size='small'
                    type='tertiary'
                  >
                    {record.revised_prompt || record.prompt}
                  </Text>
                </div>

                <div className='grid grid-cols-3 gap-2'>
                  <Button
                    icon={<Eye size={15} />}
                    onClick={() => previewHistoryRecord(record)}
                    theme='outline'
                  >
                    {t('查看')}
                  </Button>
                  <Button
                    disabled={!record.image}
                    icon={<Download size={15} />}
                    onClick={() => handleHistoryDownload(record)}
                    theme='outline'
                  >
                    {t('下载')}
                  </Button>
                  <Button
                    icon={<Trash2 size={15} />}
                    onClick={() => removeHistoryRecord(record)}
                    theme='outline'
                    type='danger'
                  >
                    {t('删除')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Spin>
  );

  return (
    <div className='mt-[60px] px-2'>
      {lastError && (
        <Banner
          className='mb-4'
          closeIcon={null}
          description={lastError}
          type='error'
        />
      )}

      <div
        className='grid gap-4'
        style={{
          gridTemplateColumns: isMobile ? '1fr' : '340px minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <Card
          bordered
          title={
            <div className='flex items-center gap-2'>
              <WandSparkles size={16} />
              <span>{t('创建')}</span>
            </div>
          }
        >
          <Spin spinning={loadingModels}>
            <div className='flex flex-col gap-4'>
              <Tabs
                activeKey={mode}
                onChange={(key) => setMode(key)}
                type='button'
              >
                {imageModelSupportsMode(currentModelSetting, 'generations') && (
                  <Tabs.TabPane itemKey='generate' tab={t('文生图')} />
                )}
                {imageModelSupportsMode(currentModelSetting, 'edits') && (
                  <Tabs.TabPane itemKey='edit' tab={t('图生图')} />
                )}
              </Tabs>

              {mode === 'edit' && (
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('参考图')}</Text>
                  <Upload
                    accept='image/png,image/jpeg,image/webp'
                    beforeUpload={() => false}
                    fileList={imageFileList}
                    multiple
                    onChange={handleReferenceUploadChange}
                    uploadTrigger='custom'
                  >
                    <Button
                      disabled={generating}
                      icon={<UploadCloud size={16} />}
                      theme='outline'
                    >
                      {t('上传参考图')}
                    </Button>
                  </Upload>
                  {imageFiles.length > 0 && (
                    <Text type='tertiary' size='small'>
                      {imageFiles.map((file) => file.name).join(', ')}
                    </Text>
                  )}
                </div>
              )}

              <div
                className='grid gap-3'
                style={{
                  gridTemplateColumns: isMobile
                    ? '1fr'
                    : 'minmax(0, 1fr) minmax(0, 1fr)',
                }}
              >
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('模型')}</Text>
                  <Select
                    disabled={generating || filteredModels.length === 0}
                    filter
                    optionList={selectOptions(filteredModels)}
                    onChange={(value) => updateConfig('model', value)}
                    placeholder={t('请选择模型')}
                    value={config.model}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <Text strong>{t('分组')}</Text>
                  <Select
                    disabled={generating}
                    optionList={groupOptions}
                    onChange={(value) => updateConfig('group', value)}
                    value={config.group}
                  />
                </div>
              </div>

              <div className='flex flex-col gap-2'>
                <Text strong>{t('提示词')}</Text>
                <TextArea
                  autosize={{ minRows: 5, maxRows: 10 }}
                  disabled={generating}
                  onChange={(value) => updateConfig('prompt', value)}
                  placeholder={t('描述你想生成的图片')}
                  value={config.prompt}
                />
              </div>

              {renderRatioPicker()}
              {renderResolutionPicker()}

              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('数量')}</Text>
                  <InputNumber
                    disabled={generating}
                    max={maxCount}
                    min={1}
                    onChange={(value) =>
                      updateConfig('count', Number(value) || 1)
                    }
                    value={Math.min(config.count, maxCount)}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <Text strong>{t('尺寸')}</Text>
                  <div className='semi-input-default flex items-center'>
                    <Text type={selectedSize ? 'primary' : 'tertiary'}>
                      {selectedSize || t('自动')}
                    </Text>
                  </div>
                </div>
              </div>

              <Button
                block
                disabled={generating || filteredModels.length === 0}
                icon={
                  generating ? (
                    <Loader2 className='animate-spin' size={16} />
                  ) : (
                    <Sparkles size={16} />
                  )
                }
                onClick={handleGenerate}
                theme='solid'
                type='primary'
              >
                {generating
                  ? t('生成中') + ` ${generatedCount}/${config.count}`
                  : t('生成')}
              </Button>
            </div>
          </Spin>
        </Card>

        <Card bordered bodyStyle={{ minHeight: 480 }}>
          <Tabs activeKey={resultTab} onChange={setResultTab} type='button'>
            <Tabs.TabPane itemKey='current' tab={t('当前结果')} />
            <Tabs.TabPane
              itemKey='history'
              tab={`${t('历史记录')} (${historyRecords.length})`}
            />
          </Tabs>

          <div className='mt-4'>
            {resultTab === 'history'
              ? renderHistoryRecords()
              : renderCurrentResults()}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ImageStudio;
