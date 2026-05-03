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
  Banner,
  Button,
  Card,
  Form,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconDelete,
  IconEdit,
  IconPlus,
  IconSaveStroked,
} from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { StatusContext } from '../../context/Status';
import {
  DEFAULT_IMAGE_MODEL_SETTINGS,
  IMAGE_MODEL_MODE_OPTIONS,
  VIDEO_MODEL_MODE_OPTIONS,
  normalizeImageModelSetting,
  normalizeVideoModelConfig,
  parseImageModelSettings,
} from '../../helpers/imageModelSettings';

const { Text, Title } = Typography;

const OPTION_KEY = 'ImageModelSettings';

const settingsToJson = (settings) => JSON.stringify(settings, null, 2);
const splitCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const ImageSetting = () => {
  const { t } = useTranslation();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_IMAGE_MODEL_SETTINGS);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingSetting, setEditingSetting] = useState(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/option/');
      const option = res.data?.data?.find((item) => item.key === OPTION_KEY);
      setSettings(parseImageModelSettings(option?.value));
    } catch (error) {
      showError(error);
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
        label: '',
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

  const resetTemplates = () => {
    setSettings(DEFAULT_IMAGE_MODEL_SETTINGS.map(normalizeImageModelSetting));
  };

  const saveVisualSettings = async () => {
    await saveSettings(settings);
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

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model',
      render: (text, record) => (
        <div className='flex flex-col'>
          <Text strong>{text}</Text>
          {record.label && <Text type='tertiary'>{record.label}</Text>}
        </div>
      ),
    },
    {
      title: t('图片模式'),
      dataIndex: 'modes',
      render: (modes = []) => (
        <Space wrap>
          {modes.length === 0 && <Text type='tertiary'>{t('未启用')}</Text>}
          {modes.map((mode) => (
            <Tag key={mode}>
              {mode === 'edits' ? t('图片编辑') : t('文生图')}
            </Tag>
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

  return (
    <div className='mt-[60px] px-2'>
      <div className='mb-4 flex flex-col gap-1'>
        <Title heading={3} style={{ margin: 0 }}>
          {t('创作设置')}
        </Title>
        <Text type='tertiary'>
          {t('配置内置图片和视频创作页可使用的模型与能力。')}
        </Text>
      </div>

      <Spin spinning={loading}>
        <Card bordered>
          <Space vertical style={{ width: '100%' }}>
            <Banner
              closeIcon={null}
              description={t(
                '图片比例与分辨率由生图页固定映射；视频页使用这里配置的时长与尺寸选项。',
              )}
              type='info'
            />

            <Space wrap>
              <Button icon={<IconPlus />} onClick={openAddModal} type='primary'>
                {t('添加创作模型')}
              </Button>
              <Button onClick={resetTemplates}>{t('恢复内置模板')}</Button>
              <Button
                icon={<IconSaveStroked />}
                onClick={saveVisualSettings}
                theme='solid'
                type='primary'
              >
                {t('保存创作设置')}
              </Button>
            </Space>
            <Table
              columns={columns}
              dataSource={settings}
              pagination={false}
              rowKey='model'
            />
          </Space>
        </Card>
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
            <Form.Input
              field='label'
              label={t('显示名称')}
              onChange={(value) => updateEditingSetting({ label: value })}
              placeholder='GPT Image 2'
              value={editingSetting.label}
            />
            <Form.Select
              field='modes'
              label={t('图片支持模式')}
              multiple
              onChange={(value) => updateEditingSetting({ modes: value })}
              optionList={IMAGE_MODEL_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: t(item.label),
              }))}
              value={editingSetting.modes}
            />
            <Form.InputNumber
              field='max_n'
              label={t('图片最大数量')}
              min={1}
              max={12}
              onChange={(value) =>
                updateEditingSetting({ max_n: Number(value) || 1 })
              }
              value={editingSetting.max_n}
            />
            <Form.Select
              field='video_modes'
              label={t('视频支持模式')}
              multiple
              onChange={(value) => updateEditingSetting({ video_modes: value })}
              optionList={VIDEO_MODEL_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: t(item.label),
              }))}
              value={editingSetting.video_modes || []}
            />
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
    </div>
  );
};

export default ImageSetting;
