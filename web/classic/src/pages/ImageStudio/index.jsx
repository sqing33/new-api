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

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Banner,
  Empty,
  InputNumber,
  Select,
  Spin,
  Tabs,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  AlertTriangle,
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';

const { Text, Title } = Typography;

const API_ENDPOINTS = {
  IMAGE_GENERATIONS: '/pg/images/generations',
  IMAGE_EDITS: '/pg/images/edits',
  USER_MODELS: '/api/user/models',
  USER_GROUPS: '/api/user/self/groups',
};

const DEFAULT_CONFIG = {
  model: 'gpt-image-1',
  group: '',
  prompt: '',
  n: 1,
  size: '1024x1024',
  quality: 'auto',
  style: 'vivid',
  response_format: 'b64_json',
};

const IMAGE_SIZE_OPTIONS = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
  '512x512',
  '256x256',
];

const IMAGE_QUALITY_OPTIONS = [
  'auto',
  'standard',
  'hd',
  'low',
  'medium',
  'high',
];

const IMAGE_STYLE_OPTIONS = ['vivid', 'natural'];

const imageModelHints = [
  'image',
  'dall',
  'gpt-image',
  'imagen',
  'flux',
  'wan',
  'jimeng',
  'midjourney',
];

const selectOptions = (items) => items.map((value) => ({ label: value, value }));

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
  const [mode, setMode] = useState('generate');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [models, setModels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [maskFile, setMaskFile] = useState(null);
  const [results, setResults] = useState([]);
  const [lastError, setLastError] = useState('');
  const [imageErrors, setImageErrors] = useState({});
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const isDalle3Model = config.model.toLowerCase().includes('dall-e-3');
  const isGptImageModel = config.model.toLowerCase().includes('gpt-image');
  const supportsStyle = isDalle3Model;

  const filteredModels = useMemo(() => {
    const imageModels = models.filter((model) =>
      imageModelHints.some((hint) => model.toLowerCase().includes(hint)),
    );
    return imageModels.length > 0 ? imageModels : models;
  }, [models]);

  const groupOptions = useMemo(() => {
    if (groups.length === 0) {
      return [{ value: '', label: t('用户默认分组') }];
    }

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
        const [modelsRes, groupsRes] = await Promise.all([
          API.get(API_ENDPOINTS.USER_MODELS),
          API.get(API_ENDPOINTS.USER_GROUPS),
        ]);

        const nextModels =
          modelsRes.data?.success && Array.isArray(modelsRes.data?.data)
            ? modelsRes.data.data
            : [];

        const groupData =
          groupsRes.data?.success && groupsRes.data?.data
            ? groupsRes.data.data
            : {};
        const nextGroups = Object.entries(groupData).map(([value, info]) => ({
          label: value,
          value,
          ratio: info?.ratio || 1,
          desc: info?.desc || value,
        }));

        setModels(nextModels);
        setGroups(nextGroups);
      } catch (error) {
        showError(extractErrorMessage(error, t('加载模型与分组失败')));
      } finally {
        setLoadingModels(false);
      }
    };

    loadData();
  }, [t]);

  useEffect(() => {
    if (filteredModels.length === 0) return;
    if (!filteredModels.includes(config.model)) {
      setConfig((current) => ({ ...current, model: filteredModels[0] }));
    }
  }, [filteredModels, config.model]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((group) => group.value === config.group)) {
      setConfig((current) => ({ ...current, group: groups[0].value }));
    }
  }, [groups, config.group]);

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const buildRequestConfig = () => {
    const requestConfig = { ...config };

    if (isDalle3Model) {
      requestConfig.n = 1;
    }

    if (!supportsStyle) {
      delete requestConfig.style;
    }

    return requestConfig;
  };

  const buildFormData = () => {
    const requestConfig = buildRequestConfig();
    const formData = new FormData();
    formData.append('model', requestConfig.model);
    if (requestConfig.group) formData.append('group', requestConfig.group);
    formData.append('prompt', requestConfig.prompt);
    formData.append('n', String(requestConfig.n));
    formData.append('size', requestConfig.size);
    if (requestConfig.quality) formData.append('quality', requestConfig.quality);
    if (requestConfig.style) formData.append('style', requestConfig.style);
    formData.append('response_format', requestConfig.response_format);
    formData.append('image', imageFile);
    if (maskFile) formData.append('mask', maskFile);
    return formData;
  };

  const buildGenerationPayload = () => {
    const payload = buildRequestConfig();
    if (!payload.group) {
      delete payload.group;
    }
    return payload;
  };

  const handleGenerate = async () => {
    if (!config.prompt.trim()) {
      showError(t('请输入提示词'));
      return;
    }

    if (mode === 'edit' && !imageFile) {
      showError(t('请先上传原图'));
      return;
    }

    setGenerating(true);
    setLastError('');
    try {
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
      setResults(data);
      setImageErrors({});
      if (data.length === 0) {
        const message = t('接口未返回图片');
        setLastError(message);
        showError(message);
      } else if (data.length < buildRequestConfig().n) {
        setLastError(
          t('上游返回的图片数量少于请求数量，可能是当前模型或渠道不支持多图返回。'),
        );
      }
    } catch (error) {
      const message = extractErrorMessage(error, t('生图请求失败'));
      setLastError(message);
      showError(message);
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

  const renderFileInput = (label, file, setFile, required = false) => (
    <div className='flex flex-col gap-2'>
      <Text strong>{label}</Text>
      <input
        accept='image/png,image/jpeg,image/webp'
        className='semi-input-default'
        onChange={(event) => setFile(event.target.files?.[0] || null)}
        required={required}
        type='file'
      />
      {file && (
        <Text type='tertiary' size='small'>
          {file.name}
        </Text>
      )}
    </div>
  );

  return (
    <div className='mt-[60px] px-2'>
      <div className='mb-4 flex flex-col gap-1'>
        <Title heading={3} style={{ margin: 0 }}>
          {t('生图')}
        </Title>
        <Text type='tertiary'>
          {t('使用当前账号余额与分组，通过可用模型生成或编辑图片。')}
        </Text>
      </div>

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
                <Tabs.TabPane itemKey='generate' tab={t('文生图')} />
                <Tabs.TabPane itemKey='edit' tab={t('图片编辑')} />
              </Tabs>

              {mode === 'edit' && (
                <div className='flex flex-col gap-3'>
                  {renderFileInput(t('原图'), imageFile, setImageFile, true)}
                  {renderFileInput(t('遮罩（可选）'), maskFile, setMaskFile)}
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

              <Banner
                closeIcon={null}
                description={
                  isDalle3Model
                    ? t('当前模型只支持一次返回 1 张图片，数量参数会自动按 1 发送。')
                    : isGptImageModel
                      ? t('GPT Image 支持数量、尺寸、质量等参数；风格参数仅适用于 DALL·E 3，已自动隐藏。')
                      : t('不同上游渠道对数量、质量、风格的支持不完全一致，实际以渠道返回为准。')
                }
                icon={<AlertTriangle size={16} />}
                type='info'
              />

              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('尺寸')}</Text>
                  <Select
                    disabled={generating}
                    optionList={selectOptions(IMAGE_SIZE_OPTIONS)}
                    onChange={(value) => updateConfig('size', value)}
                    value={config.size}
                  />
                </div>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('数量')}</Text>
                  <InputNumber
                    disabled={generating}
                    max={10}
                    min={1}
                    onChange={(value) =>
                      updateConfig(
                        'n',
                        isDalle3Model ? 1 : Number(value) || 1,
                      )
                    }
                    value={isDalle3Model ? 1 : config.n}
                  />
                </div>
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Text strong>{t('质量')}</Text>
                  <Select
                    disabled={generating}
                    optionList={selectOptions(IMAGE_QUALITY_OPTIONS)}
                    onChange={(value) => updateConfig('quality', value)}
                    value={config.quality}
                  />
                </div>
                {supportsStyle && (
                  <div className='flex flex-col gap-2'>
                    <Text strong>{t('风格')}</Text>
                    <Select
                      disabled={generating}
                      optionList={selectOptions(IMAGE_STYLE_OPTIONS)}
                      onChange={(value) => updateConfig('style', value)}
                      value={config.style}
                    />
                  </div>
                )}
              </div>

              <div className='flex flex-col gap-2'>
                <Text strong>{t('返回格式')}</Text>
                <Select
                  disabled={generating}
                  optionList={selectOptions(['b64_json', 'url'])}
                  onChange={(value) => updateConfig('response_format', value)}
                  value={config.response_format}
                />
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
                {generating ? t('生成中') : t('生成')}
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
