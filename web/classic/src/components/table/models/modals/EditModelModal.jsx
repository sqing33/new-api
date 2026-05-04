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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSONEditor from '../../../common/ui/JSONEditor';
import {
  SideSheet,
  Form,
  Button,
  Space,
  Spin,
  Typography,
  Card,
  Tag,
  Avatar,
  Col,
  Row,
  Checkbox,
} from '@douyinfe/semi-ui';
import { Save, X, FileText } from 'lucide-react';
import {
  API,
  getLobeHubIcon,
  showError,
  showSuccess,
} from '../../../../helpers';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import {
  IMAGE_MODEL_MODE_OPTIONS,
  normalizeImageModelSetting,
  normalizeVideoModelConfig,
} from '../../../../helpers/imageModelSettings';

const { Text, Title } = Typography;

// Example endpoint template for quick fill
const ENDPOINT_TEMPLATE = {
  openai: { path: '/v1/chat/completions', method: 'POST' },
  'openai-response': { path: '/v1/responses', method: 'POST' },
  'openai-response-compact': { path: '/v1/responses/compact', method: 'POST' },
  anthropic: { path: '/v1/messages', method: 'POST' },
  gemini: { path: '/v1beta/models/{model}:generateContent', method: 'POST' },
  'jina-rerank': { path: '/v1/rerank', method: 'POST' },
  'image-generation': { path: '/v1/images/generations', method: 'POST' },
};

const nameRuleOptions = [
  { label: '精确名称匹配', value: 0 },
  { label: '前缀名称匹配', value: 1 },
  { label: '包含名称匹配', value: 2 },
  { label: '后缀名称匹配', value: 3 },
];

const MODEL_ICON_PRESETS = [
  'OpenAI.Color',
  'Claude.Color',
  'Gemini.Color',
  'DeepSeek.Color',
  'Qwen.Color',
  'Doubao.Color',
  'Zhipu.Color',
  'Moonshot.Color',
  'Minimax.Color',
  'Wenxin.Color',
  'Spark.Color',
  'XAI.Color',
  'OpenRouter.Color',
  'SiliconCloud.Color',
  'Mistral.Color',
  'Perplexity.Color',
  'Cohere.Color',
  'Jina.Color',
  'Cloudflare.Color',
  'Ollama.Color',
  'Replicate.Color',
  'Midjourney.Color',
  'Kling.Color',
  'Jimeng.Color',
  'Suno.Color',
  'Hunyuan.Color',
];

const modelIconOptions = MODEL_ICON_PRESETS.map((value) => ({
  label: (
    <div className='flex items-center gap-2'>
      <span className='inline-flex h-5 w-5 items-center justify-center'>
        {getLobeHubIcon(value, 18)}
      </span>
      <span>{value}</span>
    </div>
  ),
  value,
}));

const splitCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const DEFAULT_QINGYING_IMAGE_MODES = ['generations', 'edits'];

const qingyingSettingToFormValues = (setting) => {
  const normalized = setting ? normalizeImageModelSetting(setting) : null;
  const video = normalizeVideoModelConfig(normalized?.video);

  return {
    qingying_image_enabled: (normalized?.modes || []).length > 0,
    qingying_image_modes:
      (normalized?.modes || []).length > 0
        ? normalized.modes
        : DEFAULT_QINGYING_IMAGE_MODES,
    qingying_video_enabled: (normalized?.video_modes || []).includes(
      'text_to_video',
    ),
    qingying_video_durations: video.durations.join(', '),
    qingying_video_default_seconds: video.default_seconds,
    qingying_video_sizes: video.sizes.join(', '),
    qingying_video_default_size: video.default_size,
  };
};

const EditModelModal = (props) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const formApiRef = useRef(null);
  const isEdit = props.editingModel && props.editingModel.id !== undefined;
  const placement = useMemo(() => (isEdit ? 'right' : 'left'), [isEdit]);

  // 供应商列表
  const [vendors, setVendors] = useState([]);
  const [imageModelSettings, setImageModelSettings] = useState(
    props.imageModelSettings || [],
  );

  // 预填组（标签、端点）
  const [tagGroups, setTagGroups] = useState([]);
  const [endpointGroups, setEndpointGroups] = useState([]);

  // 获取供应商列表
  const fetchVendors = async () => {
    try {
      const res = await API.get('/api/vendors/?page_size=1000'); // 获取全部供应商
      if (res.data.success) {
        const items = res.data.data.items || res.data.data || [];
        setVendors(Array.isArray(items) ? items : []);
      }
    } catch (error) {
      // ignore
    }
  };

  // 获取预填组（标签、端点）
  const fetchPrefillGroups = async () => {
    try {
      const [tagRes, endpointRes] = await Promise.all([
        API.get('/api/prefill_group?type=tag'),
        API.get('/api/prefill_group?type=endpoint'),
      ]);
      if (tagRes?.data?.success) {
        setTagGroups(tagRes.data.data || []);
      }
      if (endpointRes?.data?.success) {
        setEndpointGroups(endpointRes.data.data || []);
      }
    } catch (error) {
      // ignore
    }
  };

  useEffect(() => {
    if (props.visiable) {
      fetchVendors();
      fetchPrefillGroups();
    }
  }, [props.visiable]);

  const getInitValues = () => ({
    model_name: props.editingModel?.model_name || '',
    description: '',
    icon: '',
    tags: [],
    vendor_id: undefined,
    vendor: '',
    vendor_icon: '',
    endpoints: '',
    name_rule: props.editingModel?.model_name ? 0 : undefined, // 通过未配置模型过来的固定为精确匹配
    status: true,
    sync_official: true,
    ...qingyingSettingToFormValues(null),
  });

  const findQingyingSetting = (modelName, settings = imageModelSettings) =>
    settings.find((setting) => setting.model === modelName);

  const getQingyingFormValues = (modelName, settings = imageModelSettings) =>
    qingyingSettingToFormValues(findQingyingSetting(modelName, settings));

  const handleCancel = () => {
    props.handleClose();
  };

  const loadModel = async (
    settings = imageModelSettings,
    manageLoading = true,
  ) => {
    if (!isEdit || !props.editingModel.id) return;

    if (manageLoading) setLoading(true);
    try {
      const res = await API.get(`/api/models/${props.editingModel.id}`);
      const { success, message, data } = res.data;
      if (success) {
        // 处理tags
        if (data.tags) {
          data.tags = data.tags.split(',').filter(Boolean);
        } else {
          data.tags = [];
        }
        // endpoints 保持原始 JSON 字符串，若为空设为空串
        if (!data.endpoints) {
          data.endpoints = '';
        }
        // 处理status/sync_official，将数字转为布尔值
        data.status = data.status === 1;
        data.sync_official = (data.sync_official ?? 1) === 1;
        if (formApiRef.current) {
          formApiRef.current.setValues({
            ...getInitValues(),
            ...data,
            ...getQingyingFormValues(data.model_name, settings),
          });
        }
      } else {
        showError(message);
      }
    } catch (error) {
      showError(t('加载模型信息失败'));
    } finally {
      if (manageLoading) setLoading(false);
    }
  };

  useEffect(() => {
    if (formApiRef.current) {
      if (!isEdit) {
        formApiRef.current.setValues({
          ...getInitValues(),
          model_name: props.editingModel?.model_name || '',
        });
      }
    }
  }, [props.editingModel?.id, props.editingModel?.model_name]);

  useEffect(() => {
    if (props.visiable) {
      if (isEdit) setLoading(true);
      (async () => {
        try {
          const settings = await props.loadImageModelSettings?.();
          if (Array.isArray(settings)) {
            setImageModelSettings(settings);
          }

          if (isEdit) {
            await loadModel(
              Array.isArray(settings) ? settings : imageModelSettings,
              false,
            );
          } else {
            formApiRef.current?.setValues({
              ...getInitValues(),
              model_name: props.editingModel?.model_name || '',
              status: true,
              sync_official: true,
            });
          }
        } finally {
          setLoading(false);
        }
      })();
    } else {
      formApiRef.current?.reset();
    }
  }, [props.visiable, props.editingModel?.id, props.editingModel?.model_name]);

  useEffect(() => {
    setImageModelSettings(props.imageModelSettings || []);
  }, [props.imageModelSettings]);

  const buildQingyingSettingFromValues = (values, modelName) => {
    const modes = values.qingying_image_enabled
      ? values.qingying_image_modes?.length > 0
        ? values.qingying_image_modes
        : DEFAULT_QINGYING_IMAGE_MODES
      : [];
    const videoModes = values.qingying_video_enabled ? ['text_to_video'] : [];
    const setting = {
      model: modelName,
      modes,
      max_n: 1,
    };

    if (values.qingying_video_enabled) {
      setting.video_modes = videoModes;
      setting.video = normalizeVideoModelConfig({
        durations: splitCsv(values.qingying_video_durations),
        default_seconds: values.qingying_video_default_seconds,
        sizes: splitCsv(values.qingying_video_sizes),
        default_size: values.qingying_video_default_size,
      });
    }

    return normalizeImageModelSetting(setting);
  };

  const syncQingyingSettings = async (values, oldModelName, nextModelName) => {
    const nextSetting = buildQingyingSettingFromValues(values, nextModelName);
    const shouldKeep =
      nextSetting.modes.length > 0 ||
      (nextSetting.video_modes || []).length > 0;
    const nextSettings = imageModelSettings.filter(
      (setting) =>
        setting.model !== oldModelName && setting.model !== nextModelName,
    );

    if (shouldKeep) {
      nextSettings.push(nextSetting);
    }

    const saved = await props.saveImageModelSettings?.(nextSettings);
    if (Array.isArray(saved)) {
      setImageModelSettings(saved);
    }
  };

  const submit = async (values) => {
    setLoading(true);
    try {
      const originalModelName = props.editingModel?.model_name || '';
      const nextModelName = values.model_name;
      const submitData = {
        ...values,
        tags: Array.isArray(values.tags) ? values.tags.join(',') : values.tags,
        endpoints: values.endpoints || '',
        status: values.status === false ? 0 : 1,
        sync_official: values.sync_official === false ? 0 : 1,
      };
      delete submitData.qingying_image_enabled;
      delete submitData.qingying_image_modes;
      delete submitData.qingying_video_enabled;
      delete submitData.qingying_video_durations;
      delete submitData.qingying_video_default_seconds;
      delete submitData.qingying_video_sizes;
      delete submitData.qingying_video_default_size;

      if (isEdit) {
        submitData.id = props.editingModel.id;
        const res = await API.put('/api/models/', submitData);
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('模型更新成功！'));
          try {
            await syncQingyingSettings(
              values,
              originalModelName,
              nextModelName,
            );
          } catch (error) {
            showError(error.message || t('清影模型配置同步失败'));
          }
          props.refresh();
          props.handleClose();
        } else {
          showError(t(message));
        }
      } else {
        const res = await API.post('/api/models/', submitData);
        const { success, message } = res.data;
        if (success) {
          showSuccess(t('模型创建成功！'));
          try {
            await syncQingyingSettings(values, '', nextModelName);
          } catch (error) {
            showError(error.message || t('清影模型配置同步失败'));
          }
          props.refresh();
          props.handleClose();
        } else {
          showError(t(message));
        }
      }
    } catch (error) {
      showError(error.response?.data?.message || t('操作失败'));
    }
    setLoading(false);
    formApiRef.current?.setValues(getInitValues());
  };

  return (
    <SideSheet
      placement={placement}
      title={
        <Space>
          {isEdit ? (
            <Tag color='blue' shape='circle'>
              {t('更新')}
            </Tag>
          ) : (
            <Tag color='green' shape='circle'>
              {t('新建')}
            </Tag>
          )}
          <Title heading={4} className='m-0'>
            {isEdit ? t('更新模型信息') : t('创建新的模型')}
          </Title>
        </Space>
      }
      bodyStyle={{ padding: '0' }}
      visible={props.visiable}
      width={isMobile ? '100%' : 600}
      footer={
        <div className='flex justify-end bg-white'>
          <Space>
            <Button
              theme='solid'
              className='!rounded-lg'
              onClick={() => formApiRef.current?.submitForm()}
              icon={<Save size={16} />}
              loading={loading}
            >
              {t('提交')}
            </Button>
            <Button
              theme='light'
              className='!rounded-lg'
              type='primary'
              onClick={handleCancel}
              icon={<X size={16} />}
            >
              {t('取消')}
            </Button>
          </Space>
        </div>
      }
      closeIcon={null}
      onCancel={() => handleCancel()}
    >
      <div className='edit-model-modal-body'>
        {loading && (
          <div className='edit-model-loading-overlay'>
            <Spin spinning />
          </div>
        )}
        <Form
          key={isEdit ? 'edit' : 'new'}
          initValues={getInitValues()}
          getFormApi={(api) => (formApiRef.current = api)}
          onSubmit={submit}
        >
          {({ values }) => (
            <div className='p-2'>
              {/* 基本信息 */}
              <Card className='!rounded-2xl shadow-sm border-0'>
                <div className='flex items-center mb-2'>
                  <Avatar size='small' color='green' className='mr-2 shadow-md'>
                    <FileText size={16} />
                  </Avatar>
                  <div>
                    <Text className='text-lg font-medium'>{t('基本信息')}</Text>
                    <div className='text-xs text-gray-600'>
                      {t('设置模型的基本信息')}
                    </div>
                  </div>
                </div>
                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Input
                      field='model_name'
                      label={t('模型名称')}
                      placeholder={t('请输入模型名称，如：gpt-4')}
                      rules={[{ required: true, message: t('请输入模型名称') }]}
                      showClear
                    />
                  </Col>

                  <Col span={24}>
                    <Form.Select
                      field='name_rule'
                      label={t('名称匹配类型')}
                      placeholder={t('请选择名称匹配类型')}
                      optionList={nameRuleOptions.map((o) => ({
                        label: t(o.label),
                        value: o.value,
                      }))}
                      rules={[
                        { required: true, message: t('请选择名称匹配类型') },
                      ]}
                      extraText={t(
                        '根据模型名称和匹配规则查找模型元数据，优先级：精确 > 前缀 > 后缀 > 包含',
                      )}
                      style={{ width: '100%' }}
                    />
                  </Col>

                  <Col span={24}>
                    <Form.Select
                      field='vendor_id'
                      label={t('供应商')}
                      placeholder={t('选择模型供应商')}
                      optionList={vendors.map((v) => ({
                        label: v.name,
                        value: v.id,
                      }))}
                      filter
                      showClear
                      onChange={(value) => {
                        const vendorInfo = vendors.find((v) => v.id === value);
                        if (vendorInfo && formApiRef.current) {
                          formApiRef.current.setValue(
                            'vendor',
                            vendorInfo.name,
                          );
                        }
                      }}
                      style={{ width: '100%' }}
                    />
                  </Col>

                  <Col span={24}>
                    <Form.Select
                      field='icon'
                      label={t('模型图标')}
                      placeholder={t('选择预设图标或手动输入')}
                      optionList={modelIconOptions}
                      filter={(inputValue, option) =>
                        String(option.value || '')
                          .toLowerCase()
                          .includes(String(inputValue || '').toLowerCase())
                      }
                      allowCreate
                      showClear
                      renderSelectedItem={(option) => option.value}
                      extraText={t(
                        '可选择常见模型图标，也可输入自定义 LobeHub 图标名后回车',
                      )}
                      style={{ width: '100%' }}
                    />
                  </Col>

                  <Col span={24}>
                    <Card
                      className='!rounded-xl border border-gray-100 bg-gray-50/60'
                      bodyStyle={{ padding: 14 }}
                    >
                      <div className='mb-3'>
                        <Text className='text-base font-medium'>
                          {t('清影能力')}
                        </Text>
                        <div className='text-xs text-gray-600'>
                          {t('控制该模型是否用于清影工作台的图片或视频生成')}
                        </div>
                      </div>
                      <Row gutter={12}>
                        <Col span={24}>
                          <div className='mb-2 flex flex-col gap-3 md:flex-row md:items-center'>
                            <div className='md:w-[140px] md:flex-shrink-0'>
                              <Form.Switch
                                field='qingying_image_enabled'
                                label={t('启用生图')}
                                fieldStyle={{ marginBottom: 0 }}
                                onChange={(checked) => {
                                  if (
                                    checked &&
                                    !formApiRef.current?.getValue(
                                      'qingying_image_modes',
                                    )?.length
                                  ) {
                                    formApiRef.current?.setValue(
                                      'qingying_image_modes',
                                      DEFAULT_QINGYING_IMAGE_MODES,
                                    );
                                  }
                                }}
                              />
                            </div>
                            {values.qingying_image_enabled && (
                              <Checkbox.Group
                                onChange={(value) =>
                                  formApiRef.current?.setValue(
                                    'qingying_image_modes',
                                    value,
                                  )
                                }
                                value={values.qingying_image_modes || []}
                              >
                                <div className='flex flex-wrap gap-x-4 gap-y-2'>
                                  {IMAGE_MODEL_MODE_OPTIONS.map((item) => (
                                    <Checkbox
                                      key={item.value}
                                      value={item.value}
                                    >
                                      {t(item.label)}
                                    </Checkbox>
                                  ))}
                                </div>
                              </Checkbox.Group>
                            )}
                          </div>
                        </Col>
                        <Col span={24}>
                          <Form.Switch
                            field='qingying_video_enabled'
                            label={t('启用生视频')}
                            fieldStyle={{ marginBottom: 0 }}
                          />
                        </Col>
                        {values.qingying_video_enabled && (
                          <>
                            <Col span={12}>
                              <Form.Input
                                field='qingying_video_durations'
                                label={t('视频时长选项')}
                                placeholder='4,8'
                              />
                            </Col>
                            <Col span={12}>
                              <Form.Select
                                field='qingying_video_default_seconds'
                                label={t('默认视频时长')}
                                optionList={splitCsv(
                                  values.qingying_video_durations,
                                ).map((value) => ({
                                  label: `${value}s`,
                                  value,
                                }))}
                                style={{ width: '100%' }}
                              />
                            </Col>
                            <Col span={12}>
                              <Form.Input
                                field='qingying_video_sizes'
                                label={t('视频尺寸选项')}
                                placeholder='720x1280,1280x720'
                              />
                            </Col>
                            <Col span={12}>
                              <Form.Select
                                field='qingying_video_default_size'
                                label={t('默认视频尺寸')}
                                optionList={splitCsv(
                                  values.qingying_video_sizes,
                                ).map((value) => ({
                                  label: value,
                                  value,
                                }))}
                                style={{ width: '100%' }}
                              />
                            </Col>
                          </>
                        )}
                      </Row>
                    </Card>
                  </Col>

                  <Col span={24}>
                    <Form.TextArea
                      field='description'
                      label={t('描述')}
                      placeholder={t('请输入模型描述')}
                      rows={3}
                      showClear
                    />
                  </Col>
                  <Col span={24}>
                    <Form.TagInput
                      field='tags'
                      label={t('标签')}
                      placeholder={t('输入标签或使用","分隔多个标签')}
                      addOnBlur
                      showClear
                      onChange={(newTags) => {
                        if (!formApiRef.current) return;
                        const normalize = (tags) => {
                          if (!Array.isArray(tags)) return [];
                          return [
                            ...new Set(
                              tags.flatMap((tag) =>
                                tag
                                  .split(',')
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              ),
                            ),
                          ];
                        };
                        const normalized = normalize(newTags);
                        formApiRef.current.setValue('tags', normalized);
                      }}
                      style={{ width: '100%' }}
                      {...(tagGroups.length > 0 && {
                        extraText: (
                          <Space wrap>
                            {tagGroups.map((group) => (
                              <Button
                                key={group.id}
                                size='small'
                                type='primary'
                                onClick={() => {
                                  if (formApiRef.current) {
                                    const currentTags =
                                      formApiRef.current.getValue('tags') || [];
                                    const newTags = [
                                      ...currentTags,
                                      ...(group.items || []),
                                    ];
                                    const uniqueTags = [...new Set(newTags)];
                                    formApiRef.current.setValue(
                                      'tags',
                                      uniqueTags,
                                    );
                                  }
                                }}
                              >
                                {group.name}
                              </Button>
                            ))}
                          </Space>
                        ),
                      })}
                    />
                  </Col>
                  <Col span={24}>
                    <JSONEditor
                      field='endpoints'
                      label={t('在模型广场向用户展示的端点')}
                      placeholder={
                        '{\n  "openai": {"path": "/v1/chat/completions", "method": "POST"}\n}'
                      }
                      value={values.endpoints}
                      onChange={(val) =>
                        formApiRef.current?.setValue('endpoints', val)
                      }
                      formApi={formApiRef.current}
                      editorType='object'
                      template={ENDPOINT_TEMPLATE}
                      templateLabel={t('填入模板')}
                      extraText={t('留空则使用默认端点；支持 {path, method}')}
                      extraFooter={
                        endpointGroups.length > 0 && (
                          <Space wrap>
                            {endpointGroups.map((group) => (
                              <Button
                                key={group.id}
                                size='small'
                                type='primary'
                                onClick={() => {
                                  try {
                                    const current =
                                      formApiRef.current?.getValue(
                                        'endpoints',
                                      ) || '';
                                    let base = {};
                                    if (current && current.trim())
                                      base = JSON.parse(current);
                                    const groupObj =
                                      typeof group.items === 'string'
                                        ? JSON.parse(group.items || '{}')
                                        : group.items || {};
                                    const merged = { ...base, ...groupObj };
                                    formApiRef.current?.setValue(
                                      'endpoints',
                                      JSON.stringify(merged, null, 2),
                                    );
                                  } catch (e) {
                                    try {
                                      const groupObj =
                                        typeof group.items === 'string'
                                          ? JSON.parse(group.items || '{}')
                                          : group.items || {};
                                      formApiRef.current?.setValue(
                                        'endpoints',
                                        JSON.stringify(groupObj, null, 2),
                                      );
                                    } catch {}
                                  }
                                }}
                              >
                                {group.name}
                              </Button>
                            ))}
                          </Space>
                        )
                      }
                    />
                  </Col>
                  <Col span={24}>
                    <Form.Switch
                      field='sync_official'
                      label={t('参与官方同步')}
                      initValue
                      extraText={t(
                        '关闭后，此模型将不会被“同步官方”自动覆盖或创建',
                      )}
                      size='large'
                    />
                  </Col>
                  <Col span={24}>
                    <Form.Switch
                      field='status'
                      label={t('状态')}
                      initValue
                      size='large'
                    />
                  </Col>
                </Row>
              </Card>
            </div>
          )}
        </Form>
      </div>
    </SideSheet>
  );
};

export default EditModelModal;
