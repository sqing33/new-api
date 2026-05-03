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

import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Empty,
  Form,
  Modal,
  Space,
  Spin,
  Table,
  Tabs,
  TabPane,
  Tag,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import {
  IconDelete,
  IconEdit,
  IconImage,
  IconPlus,
} from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { StatusContext } from '../../context/Status';
import CardPro from '../../components/common/ui/CardPro';
import {
  DEFAULT_IMAGE_MODEL_SETTINGS,
  IMAGE_MODEL_MODE_OPTIONS,
  VIDEO_MODEL_MODE_OPTIONS,
  normalizeImageModelSetting,
  normalizeVideoModelConfig,
  parseImageModelSettings,
} from '../../helpers/imageModelSettings';

const { Text } = Typography;

const OPTION_KEY = 'ImageModelSettings';
const PROMPT_PRESETS_OPTION_KEY = 'ImagePromptPresets';

const settingsToJson = (settings) => JSON.stringify(settings, null, 2);
const splitCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizePromptPreset = (preset = {}) => ({
  id:
    preset.id ||
    `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: String(preset.name || '').trim(),
  image: String(preset.image || ''),
  prompt: String(preset.prompt || '').trim(),
});

const parsePromptPresets = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePromptPreset)
      .filter((item) => item.name || item.prompt || item.image);
  } catch {
    return [];
  }
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const ImageSetting = () => {
  const { t } = useTranslation();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('models');
  const [settings, setSettings] = useState(DEFAULT_IMAGE_MODEL_SETTINGS);
  const [promptPresets, setPromptPresets] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingSetting, setEditingSetting] = useState(null);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [editingPresetIndex, setEditingPresetIndex] = useState(null);
  const [editingPreset, setEditingPreset] = useState(null);
  const [presetFileList, setPresetFileList] = useState([]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/option/');
      const option = res.data?.data?.find((item) => item.key === OPTION_KEY);
      const presetOption = res.data?.data?.find(
        (item) => item.key === PROMPT_PRESETS_OPTION_KEY,
      );
      setSettings(parseImageModelSettings(option?.value));
      setPromptPresets(parsePromptPresets(presetOption?.value));
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const savePromptPresets = async (nextPresets) => {
    setLoading(true);
    try {
      const normalized = nextPresets.map(normalizePromptPreset);
      const res = await API.put('/api/option/', {
        key: PROMPT_PRESETS_OPTION_KEY,
        value: settingsToJson(normalized),
      });
      if (res.data?.success) {
        setPromptPresets(normalized);
        showSuccess(t('保存成功'));
        return true;
      }
      showError(res.data?.message || t('保存失败'));
      return false;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSettings = async (nextSettings) => {
    setLoading(true);
    try {
      const normalized = nextSettings.map(normalizeImageModelSetting);
      const value = settingsToJson(normalized);
      const res = await API.put('/api/option/', {
        key: OPTION_KEY,
        value,
      });
      if (res.data?.success) {
        setSettings(normalized);
        statusDispatch({
          type: 'set',
          payload: {
            ...statusState.status,
            image_model_settings: value,
          },
        });
        showSuccess(t('保存成功'));
        return true;
      }
      showError(res.data?.message || t('保存失败'));
      return false;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingSetting(
      normalizeImageModelSetting({
        model: '',
        modes: ['generations'],
        max_n: 4,
      }),
    );
    setEditingIndex(null);
    setModalVisible(true);
  };

  const openEditModal = (record, index) => {
    setEditingSetting(normalizeImageModelSetting(record));
    setEditingIndex(index);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingIndex(null);
    setEditingSetting(null);
  };

  const upsertSetting = async () => {
    const nextSetting = normalizeImageModelSetting(editingSetting);
    if (!nextSetting.model) {
      showError(t('请输入模型名称'));
      return;
    }
    if (
      nextSetting.modes.length === 0 &&
      (nextSetting.video_modes || []).length === 0
    ) {
      showError(t('请选择支持模式'));
      return;
    }

    const isDuplicate = settings.some(
      (item, index) =>
        item.model === nextSetting.model && index !== editingIndex,
    );
    if (isDuplicate) {
      showError(t('模型名称已存在'));
      return;
    }

    const nextSettings =
      editingIndex === null
        ? [...settings, nextSetting]
        : settings.map((item, index) =>
            index === editingIndex ? nextSetting : item,
          );

    const saved = await saveSettings(nextSettings);
    if (saved) closeModal();
  };

  const deleteSetting = (index) => {
    const nextSettings = settings.filter((_, itemIndex) => itemIndex !== index);
    Modal.confirm({
      title: t('确认删除'),
      content: t('删除后会立即保存创作设置。'),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: () => saveSettings(nextSettings),
    });
  };

  const updateEditingSetting = (patch) => {
    setEditingSetting((current) =>
      normalizeImageModelSetting({ ...current, ...patch }),
    );
  };

  const updateEditingVideoConfig = (patch) => {
    setEditingSetting((current) => {
      const currentVideo = normalizeVideoModelConfig(current?.video);
      return normalizeImageModelSetting({
        ...current,
        video: { ...currentVideo, ...patch },
      });
    });
  };

  const openAddPresetModal = () => {
    setEditingPreset({
      id: '',
      name: '',
      image: '',
      prompt: '',
    });
    setEditingPresetIndex(null);
    setPresetFileList([]);
    setPresetModalVisible(true);
  };

  const openEditPresetModal = (preset, index) => {
    setEditingPreset(normalizePromptPreset(preset));
    setEditingPresetIndex(index);
    setPresetFileList([]);
    setPresetModalVisible(true);
  };

  const closePresetModal = () => {
    setPresetModalVisible(false);
    setEditingPresetIndex(null);
    setEditingPreset(null);
    setPresetFileList([]);
  };

  const updateEditingPreset = (patch) => {
    setEditingPreset((current) => ({
      ...(current || {}),
      ...patch,
    }));
  };

  const handlePresetImageChange = async ({ fileList = [] }) => {
    const nextFileList = fileList.filter((item) => item.fileInstance).slice(-1);
    setPresetFileList(nextFileList);
    if (nextFileList.length === 0) {
      updateEditingPreset({ image: '' });
      return;
    }
    try {
      const file = nextFileList[0].fileInstance;
      const dataUrl = await fileToDataUrl(file);
      updateEditingPreset({ image: dataUrl });
    } catch (error) {
      showError(error);
    }
  };

  const upsertPromptPreset = async () => {
    const nextPreset = normalizePromptPreset(editingPreset);
    if (!nextPreset.name) {
      showError(t('请输入预设名称'));
      return;
    }
    if (!nextPreset.image) {
      showError(t('请上传预设图片'));
      return;
    }
    if (!nextPreset.prompt) {
      showError(t('请输入提示词内容'));
      return;
    }

    const nextPresets =
      editingPresetIndex === null
        ? [...promptPresets, nextPreset]
        : promptPresets.map((item, index) =>
            index === editingPresetIndex ? nextPreset : item,
          );

    const saved = await savePromptPresets(nextPresets);
    if (saved) closePresetModal();
  };

  const deletePromptPreset = (index) => {
    const nextPresets = promptPresets.filter(
      (_, itemIndex) => itemIndex !== index,
    );
    Modal.confirm({
      title: t('确认删除'),
      content: t('删除后会立即保存预设提示词。'),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: () => savePromptPresets(nextPresets),
    });
  };

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model',
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: t('图片模式'),
      dataIndex: 'modes',
      render: (modes = []) => (
        <Space wrap>
          {modes.length === 0 && <Text type='tertiary'>{t('未启用')}</Text>}
          {modes.map((mode) => (
            <Tag key={mode}>{mode === 'edits' ? t('图生图') : t('文生图')}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('视频模式'),
      dataIndex: 'video_modes',
      render: (modes = []) => (
        <Space wrap>
          {modes.length === 0 && <Text type='tertiary'>{t('未启用')}</Text>}
          {modes.map((mode) => (
            <Tag key={mode}>
              {mode === 'text_to_video' ? t('文生视频') : mode}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('视频参数'),
      dataIndex: 'video',
      render: (video) => {
        if (!video) return <Text type='tertiary'>{t('未配置')}</Text>;
        return (
          <Text type='tertiary'>
            {t('默认')} {video.default_seconds}s / {video.default_size}
          </Text>
        );
      },
    },
    {
      title: t('图片最大数量'),
      dataIndex: 'max_n',
    },
    {
      title: t('操作'),
      render: (_, record, index) => (
        <Space>
          <Button
            icon={<IconEdit />}
            onClick={() => openEditModal(record, index)}
            size='small'
            type='primary'
          >
            {t('编辑')}
          </Button>
          <Button
            icon={<IconDelete />}
            onClick={() => deleteSetting(index)}
            size='small'
            type='danger'
          >
            {t('删除')}
          </Button>
        </Space>
      ),
    },
  ];

  const renderTabsArea = () => (
    <Tabs
      activeKey={activeTab}
      className='mb-2'
      collapsible
      onChange={setActiveTab}
      type='card'
    >
      <TabPane itemKey='models' tab={t('创作模型')} />
      <TabPane itemKey='presets' tab={t('预设提示词')} />
    </Tabs>
  );

  const renderActionsArea = () => {
    if (activeTab === 'presets') {
      return (
        <div className='flex gap-2 w-full md:w-auto'>
          <Button
            className='w-full md:w-auto'
            icon={<IconPlus />}
            onClick={openAddPresetModal}
            size='small'
            type='primary'
          >
            {t('添加预设提示词')}
          </Button>
        </div>
      );
    }

    return (
      <Space wrap>
        <Button
          icon={<IconPlus />}
          onClick={openAddModal}
          size='small'
          type='primary'
        >
          {t('添加创作模型')}
        </Button>
      </Space>
    );
  };

  const renderPromptPresets = () => {
    if (promptPresets.length === 0) {
      return (
        <div className='py-10'>
          <Empty
            image={<IconImage size='extra-large' />}
            title={t('暂无预设提示词')}
            description={t(
              '添加预设提示词后，会以图片和提示词卡片展示在这里。',
            )}
          >
            <Button
              icon={<IconPlus />}
              onClick={openAddPresetModal}
              type='primary'
            >
              {t('添加预设提示词')}
            </Button>
          </Empty>
        </div>
      );
    }

    return (
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {promptPresets.map((preset, index) => (
          <div
            key={preset.id || index}
            className='flex min-h-0 flex-col overflow-hidden rounded-lg border'
            style={{ borderColor: 'var(--semi-color-border)' }}
          >
            <div className='aspect-video bg-semi-color-fill-0'>
              {preset.image ? (
                <img
                  alt={preset.name}
                  className='h-full w-full object-cover'
                  src={preset.image}
                />
              ) : (
                <div className='flex h-full items-center justify-center text-semi-color-text-2'>
                  <IconImage size='extra-large' />
                </div>
              )}
            </div>
            <div className='flex flex-1 flex-col gap-3 p-4'>
              <div className='flex flex-col gap-1'>
                <Text strong ellipsis={{ showTooltip: true }}>
                  {preset.name || t('未命名预设')}
                </Text>
                <Text
                  className='min-h-[44px]'
                  ellipsis={{ rows: 2, showTooltip: true }}
                  size='small'
                  type='tertiary'
                >
                  {preset.prompt}
                </Text>
              </div>
              <div className='mt-auto flex gap-2'>
                <Button
                  block
                  icon={<IconEdit />}
                  onClick={() => openEditPresetModal(preset, index)}
                  size='small'
                  type='primary'
                >
                  {t('编辑')}
                </Button>
                <Button
                  block
                  icon={<IconDelete />}
                  onClick={() => deletePromptPreset(index)}
                  size='small'
                  type='danger'
                >
                  {t('删除')}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className='mt-[60px] px-2'>
      <Spin spinning={loading}>
        <CardPro
          type='type3'
          tabsArea={renderTabsArea()}
          actionsArea={renderActionsArea()}
          t={t}
        >
          {activeTab === 'models' ? (
            <Table
              columns={columns}
              dataSource={settings}
              pagination={false}
              rowKey='model'
            />
          ) : (
            renderPromptPresets()
          )}
        </CardPro>
      </Spin>

      <Modal
        title={editingIndex === null ? t('添加创作模型') : t('编辑创作模型')}
        visible={modalVisible}
        onCancel={closeModal}
        onOk={upsertSetting}
        width={640}
      >
        {editingSetting && (
          <Form>
            <Form.Input
              field='model'
              label={t('模型名称')}
              onChange={(value) => updateEditingSetting({ model: value })}
              placeholder='gpt-image-2'
              value={editingSetting.model}
            />
            <div className='mb-4 flex flex-col gap-2'>
              <Text strong>{t('图片支持模式')}</Text>
              <Checkbox.Group
                onChange={(value) => updateEditingSetting({ modes: value })}
                value={editingSetting.modes || []}
              >
                <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                  {IMAGE_MODEL_MODE_OPTIONS.map((item) => (
                    <Checkbox key={item.value} value={item.value}>
                      {t(item.label)}
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>
            <div className='mb-4 flex flex-col gap-2'>
              <Text strong>{t('视频支持模式')}</Text>
              <Checkbox.Group
                onChange={(value) =>
                  updateEditingSetting({ video_modes: value })
                }
                value={editingSetting.video_modes || []}
              >
                <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                  {VIDEO_MODEL_MODE_OPTIONS.map((item) => (
                    <Checkbox key={item.value} value={item.value}>
                      {t(item.label)}
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>
            {editingSetting.video_modes?.includes('text_to_video') && (
              <>
                <Form.Input
                  field='video_durations'
                  label={t('视频时长选项')}
                  onChange={(value) =>
                    updateEditingVideoConfig({ durations: splitCsv(value) })
                  }
                  placeholder='4,8'
                  value={(editingSetting.video?.durations || []).join(', ')}
                />
                <Form.Select
                  field='video_default_seconds'
                  label={t('默认视频时长')}
                  onChange={(value) =>
                    updateEditingVideoConfig({ default_seconds: value })
                  }
                  optionList={(editingSetting.video?.durations || []).map(
                    (value) => ({ label: `${value}s`, value }),
                  )}
                  value={editingSetting.video?.default_seconds}
                />
                <Form.Input
                  field='video_sizes'
                  label={t('视频尺寸选项')}
                  onChange={(value) =>
                    updateEditingVideoConfig({ sizes: splitCsv(value) })
                  }
                  placeholder='720x1280,1280x720'
                  value={(editingSetting.video?.sizes || []).join(', ')}
                />
                <Form.Select
                  field='video_default_size'
                  label={t('默认视频尺寸')}
                  onChange={(value) =>
                    updateEditingVideoConfig({ default_size: value })
                  }
                  optionList={(editingSetting.video?.sizes || []).map(
                    (value) => ({
                      label: value,
                      value,
                    }),
                  )}
                  value={editingSetting.video?.default_size}
                />
              </>
            )}
          </Form>
        )}
      </Modal>

      <Modal
        title={
          editingPresetIndex === null
            ? t('添加预设提示词')
            : t('编辑预设提示词')
        }
        visible={presetModalVisible}
        onCancel={closePresetModal}
        onOk={upsertPromptPreset}
        width={820}
      >
        {editingPreset && (
          <div className='grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]'>
            <div className='flex flex-col gap-3'>
              <Text strong>{t('预设图片')}</Text>
              {editingPreset.image ? (
                <div
                  className='w-full overflow-hidden rounded-lg border bg-semi-color-fill-0'
                  style={{ borderColor: 'var(--semi-color-border)' }}
                >
                  <img
                    alt={editingPreset.name || t('预设图片')}
                    className='block h-auto max-h-[420px] w-full object-contain'
                    src={editingPreset.image}
                  />
                </div>
              ) : (
                <div
                  className='flex min-h-[180px] w-full items-center justify-center rounded-lg border bg-semi-color-fill-0 text-semi-color-text-2'
                  style={{ borderColor: 'var(--semi-color-border)' }}
                >
                  <div className='flex h-full items-center justify-center text-semi-color-text-2'>
                    <IconImage size='extra-large' />
                  </div>
                </div>
              )}
              <Upload
                accept='image/png,image/jpeg,image/jpg,image/webp'
                beforeUpload={() => false}
                fileList={presetFileList}
                limit={1}
                onChange={handlePresetImageChange}
                uploadTrigger='custom'
              >
                <Button block icon={<IconImage />} theme='outline'>
                  {editingPreset.image ? t('重新上传') : t('上传图片')}
                </Button>
              </Upload>
            </div>

            <Form>
              <Form.Input
                field='preset_name'
                label={t('预设名称')}
                onChange={(value) => updateEditingPreset({ name: value })}
                placeholder={t('例如：商品图爆款封面')}
                value={editingPreset.name}
              />
              <Form.TextArea
                autosize={{ minRows: 8, maxRows: 14 }}
                field='preset_prompt'
                label={t('提示词内容')}
                onChange={(value) => updateEditingPreset({ prompt: value })}
                placeholder={t('输入预设提示词')}
                value={editingPreset.prompt}
              />
            </Form>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ImageSetting;
