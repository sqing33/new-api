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
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import {
  IconDelete,
  IconEdit,
  IconImage,
  IconPlus,
} from '@douyinfe/semi-icons';
import { API, processModelsData, showError, showSuccess } from '../../helpers';
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
const CHAT_COMPLETIONS_ENDPOINT = '/pg/chat/completions';
const USER_MODELS_ENDPOINT = '/api/user/models';
const PRESET_ANALYSIS_SYSTEM_PROMPT =
  '你是图像生成提示词架构师，负责把参考图提炼成可复用的生图预设。不要只复述当前图片内容，而要判断它的可复用风格、版式、构图、视觉语言和适用场景。输出必须是严格 JSON，不要 Markdown，不要解释。';
const PRESET_ANALYSIS_USER_PROMPT = [
  '请分析这张参考图，生成适合保存为“预设提示词”的 JSON：{"name":"不超过16个中文字符","prompt":"一整段中文通用生图提示词"}。',
  'prompt 必须是一整段中文，可直接用于之后的图生图/文生图；写法要像“将我上传的图片改造成……”或“根据我上传的图片生成……”。',
  '要保留未来用户上传图片的主体辨识度、人物/商品/动物/场景结构和主色调，不要锁死当前参考图里的具体人物、动物、品牌、地点、颜色、元素主题或文案。',
  '重点提炼可复用的风格模板：画面类型、版式结构、主体位置、构图、光影、色彩倾向、材质质感、标注/信息框/细节展示/三视图/物品介绍等页面模块、整体氛围和负面约束。',
  '如果参考图是手绘标注 plog，就输出真实照片加白色手绘涂鸦标注的通用模板；如果是角色概念设定稿，就输出手游/RPG 角色设定板模板；如果是人物档案卡，就输出全身写真加资料栏、物品介绍、表情展示的人设卡模板；其他图片也按其自身风格自动归纳，不强行套用固定主题。',
  '只返回 JSON，不要输出 Markdown。',
].join('\n');

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

const extractJsonObject = (content) => {
  if (!content) return null;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const candidates = [raw];
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

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
  const [analysisModels, setAnalysisModels] = useState([]);
  const [analysisModel, setAnalysisModel] = useState('');
  const [analyzingPreset, setAnalyzingPreset] = useState(false);

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

  const loadAnalysisModels = async () => {
    try {
      const res = await API.get(USER_MODELS_ENDPOINT);
      const { success, data, message } = res.data || {};
      if (!success) {
        showError(t(message || '加载模型失败'));
        return;
      }
      const { modelOptions, selectedModel } = processModelsData(
        Array.isArray(data) ? data : [],
        analysisModel,
      );
      setAnalysisModels(modelOptions);
      if (selectedModel && selectedModel !== analysisModel) {
        setAnalysisModel(selectedModel);
      }
    } catch {
      showError(t('加载模型失败'));
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

  useEffect(() => {
    loadAnalysisModels();
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

  const analyzePresetImage = async () => {
    if (!editingPreset?.image) {
      showError(t('请先上传预设图片'));
      return;
    }
    if (!analysisModel) {
      showError(t('请选择分析模型'));
      return;
    }

    setAnalyzingPreset(true);
    try {
      const res = await API.post(
        CHAT_COMPLETIONS_ENDPOINT,
        {
          model: analysisModel,
          stream: false,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: PRESET_ANALYSIS_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: PRESET_ANALYSIS_USER_PROMPT,
                },
                {
                  type: 'image_url',
                  image_url: { url: editingPreset.image },
                },
              ],
            },
          ],
        },
        { skipErrorHandler: true },
      );
      const content = res.data?.choices?.[0]?.message?.content || '';
      const parsed = extractJsonObject(content);
      const name = String(parsed?.name || '').trim();
      const prompt = String(parsed?.prompt || '').trim();
      if (!name && !prompt) {
        throw new Error(t('模型未返回可用的分析结果'));
      }
      updateEditingPreset({
        ...(name ? { name } : {}),
        ...(prompt ? { prompt } : {}),
      });
      showSuccess(t('图片分析完成'));
    } catch (error) {
      showError(
        error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          error?.message ||
          t('图片分析失败'),
      );
    } finally {
      setAnalyzingPreset(false);
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

            <div className='flex flex-col'>
              <div className='mb-4 flex flex-col gap-2'>
                <Text strong>{t('分析模型')}</Text>
                <div className='flex flex-col gap-2 md:flex-row'>
                  <Select
                    className='min-w-0 flex-1'
                    disabled={analyzingPreset}
                    filter
                    onChange={setAnalysisModel}
                    optionList={analysisModels}
                    placeholder={t('请选择分析模型')}
                    value={analysisModel}
                  />
                  <Button
                    className='md:w-auto'
                    disabled={!editingPreset.image || !analysisModel}
                    loading={analyzingPreset}
                    onClick={analyzePresetImage}
                    type='primary'
                  >
                    {t('分析图片')}
                  </Button>
                </div>
              </div>
              <div className='mb-4 flex flex-col gap-2'>
                <Text strong>{t('预设名称')}</Text>
                <Input
                  onChange={(value) => updateEditingPreset({ name: value })}
                  placeholder={t('例如：商品图爆款封面')}
                  value={editingPreset.name}
                />
              </div>
              <div className='flex flex-col gap-2'>
                <Text strong>{t('提示词内容')}</Text>
                <TextArea
                  autosize={{ minRows: 8, maxRows: 14 }}
                  onChange={(value) => updateEditingPreset({ prompt: value })}
                  placeholder={t('输入预设提示词')}
                  value={editingPreset.prompt}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ImageSetting;
