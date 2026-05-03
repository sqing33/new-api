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
  Select,
  Spin,
  Tabs,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
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
  const [results, setResults] = useState([]);
  const [lastError, setLastError] = useState('');
  const [imageErrors, setImageErrors] = useState({});
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
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

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

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

    setGenerating(true);
    setGeneratedCount(0);
    setLastError('');
    setResults([]);
    setImageErrors({});

    try {
      for (let index = 0; index < total; index += 1) {
        try {
          const result = await requestOneImage();
          setResults((current) => [...current, result]);
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
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = (result, index) => {
    const href = resultSource(result);
    if (!href) return;

    const link = document.createElement('a');
    link.href = href;
    link.download = `image-studio-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess(t('已开始下载'));
  };

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
          gridTemplateColumns: isMobile ? '1fr' : '420px minmax(0, 1fr)',
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
                  <Tabs.TabPane itemKey='edit' tab={t('图片编辑')} />
                )}
              </Tabs>

              {mode === 'edit' && (
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('参考图')}</Text>
                  <input
                    accept='image/png,image/jpeg,image/webp'
                    className='semi-input-default'
                    multiple
                    onChange={(event) =>
                      setImageFiles(Array.from(event.target.files || []))
                    }
                    type='file'
                  />
                  {imageFiles.length > 0 && (
                    <Text type='tertiary' size='small'>
                      {imageFiles.map((file) => file.name).join(', ')}
                    </Text>
                  )}
                </div>
              )}

              <div className='grid grid-cols-1 gap-3'>
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
          {results.length === 0 ? (
            <div className='flex min-h-[420px] items-center justify-center'>
              <Empty
                description={t('生成的图片会显示在这里')}
                image={<ImageIcon size={44} color='var(--semi-color-text-2)' />}
                title={t('暂无图片')}
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
              {results.map((result, index) => {
                const source = resultSource(result);
                const imageFailed = imageErrors[index];

                return (
                  <Card
                    bordered
                    bodyStyle={{ padding: 12 }}
                    className='overflow-hidden'
                    key={`${source}-${index}`}
                  >
                    <div
                      className='mb-3 flex items-center justify-center overflow-hidden rounded'
                      style={{
                        aspectRatio: '1 / 1',
                        background: 'var(--semi-color-fill-0)',
                      }}
                    >
                      {source && !imageFailed ? (
                        <img
                          alt={result.revised_prompt || config.prompt}
                          className='h-full w-full object-cover'
                          onError={() => {
                            setImageErrors((current) => ({
                              ...current,
                              [index]: true,
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
                    </div>

                    {result.revised_prompt && (
                      <Text
                        className='mb-3 block'
                        ellipsis={{ showTooltip: true, rows: 3 }}
                        size='small'
                        type='tertiary'
                      >
                        {result.revised_prompt}
                      </Text>
                    )}

                    <Button
                      block
                      disabled={!source}
                      icon={<Download size={16} />}
                      onClick={() => handleDownload(result, index)}
                      theme='outline'
                    >
                      {t('下载')}
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ImageStudio;
