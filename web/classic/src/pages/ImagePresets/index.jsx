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
  Empty,
  Input,
  Modal,
  Select,
  Spin,
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
import CardPro from '../../components/common/ui/CardPro';
import {
  API,
  isAdmin,
  processModelsData,
  showError,
  showSuccess,
} from '../../helpers';
import {
  buildImageModelSettingsMap,
  loadImageModelSettingsOption,
} from '../../helpers/imageModelSettingsOption';

const { Text } = Typography;

const PROMPT_PRESETS_OPTION_KEY = 'ImagePromptPresets';
const CHAT_COMPLETIONS_ENDPOINT = '/pg/chat/completions';
const USER_MODELS_ENDPOINT = '/api/user/models';
const PRESET_ANALYSIS_SYSTEM_PROMPT =
  '你是图像生成提示词架构师，负责把参考图提炼成可复用的生图预设。不要只复述当前图片内容，而要判断它的可复用风格、版式、构图、视觉语言和适用场景。输出必须是严格 JSON，不要 Markdown，不要解释。';
const PRESET_ANALYSIS_USER_PROMPT = [
  '请分析这张参考图，生成适合保存为“预设提示词”的 JSON：{"name":"不超过16个中文字符","prompt":"一整段中文通用生图提示词"}。',
  'prompt 必须是一整段中文，可直接用于之后的图生图/文生图；写法要像“将我上传的图片改造成……”或“根据我上传的图片生成……”。',
  '要保留未来用户上传图片的主体辨识度、人物/商品/动物/场景结构和主色调，不要锁死当前参考图里的具体人物、动物、品牌、地点、颜色、元素主题或原有文案。',
  '重点提炼可复用的风格模板：画面类型、版式结构、主体位置、构图、光影、色彩倾向、材质质感、标注/信息框、细节展示、三视图、物品介绍、文字层级和设计语言。',
  '只返回 JSON，不要输出 Markdown。',
].join('\n');

const settingsToJson = (settings) => JSON.stringify(settings, null, 2);

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
    } catch {}
  }
  return null;
};

const ImagePresets = () => {
  const { t } = useTranslation();
  const canManage = isAdmin();
  const [loading, setLoading] = useState(false);
  const [promptPresets, setPromptPresets] = useState([]);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [editingPresetIndex, setEditingPresetIndex] = useState(null);
  const [editingPreset, setEditingPreset] = useState(null);
  const [presetFileList, setPresetFileList] = useState([]);
  const [supportedModels, setSupportedModels] = useState([]);
  const [imageModelSettings, setImageModelSettings] = useState([]);
  const [analysisModel, setAnalysisModel] = useState('');
  const [analyzingPreset, setAnalyzingPreset] = useState(false);

  const analysisModelOptions = useMemo(() => {
    const qingyingMap = buildImageModelSettingsMap(imageModelSettings);
    return supportedModels.filter((option) => {
      const setting = qingyingMap[option.value];
      return (
        !setting ||
        ((setting.modes || []).length === 0 &&
          (setting.video_modes || []).length === 0)
      );
    });
  }, [imageModelSettings, supportedModels]);

  useEffect(() => {
    if (
      analysisModel &&
      analysisModelOptions.some((option) => option.value === analysisModel)
    ) {
      return;
    }
    setAnalysisModel(analysisModelOptions[0]?.value || '');
  }, [analysisModel, analysisModelOptions]);

  const loadPromptPresets = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/option/');
      const presetOption = res.data?.data?.find(
        (item) => item.key === PROMPT_PRESETS_OPTION_KEY,
      );
      setPromptPresets(parsePromptPresets(presetOption?.value));
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const loadModelOptions = async () => {
    try {
      const [modelRes, settings] = await Promise.all([
        API.get(USER_MODELS_ENDPOINT),
        loadImageModelSettingsOption(),
      ]);
      const { success, data, message } = modelRes.data || {};
      if (!success) {
        showError(t(message || '加载模型失败'));
        return;
      }
      const { modelOptions } = processModelsData(
        Array.isArray(data) ? data : [],
        '',
      );
      setSupportedModels(modelOptions);
      setImageModelSettings(settings);
    } catch {
      showError(t('加载模型失败'));
    }
  };

  useEffect(() => {
    loadPromptPresets();
    loadModelOptions();
  }, []);

  const savePromptPresets = async (nextPresets) => {
    if (!canManage) return false;
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

  const openAddPresetModal = () => {
    if (!canManage) return;
    setEditingPreset({ id: '', name: '', image: '', prompt: '' });
    setEditingPresetIndex(null);
    setPresetFileList([]);
    setPresetModalVisible(true);
  };

  const openPresetModal = (preset, index) => {
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
    if (!canManage) return;
    setEditingPreset((current) => ({ ...(current || {}), ...patch }));
  };

  const handlePresetImageChange = async ({ fileList = [] }) => {
    if (!canManage) return;
    const nextFileList = fileList.filter((item) => item.fileInstance).slice(-1);
    setPresetFileList(nextFileList);
    if (nextFileList.length === 0) {
      updateEditingPreset({ image: '' });
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(nextFileList[0].fileInstance);
      updateEditingPreset({ image: dataUrl });
    } catch (error) {
      showError(error);
    }
  };

  const analyzePresetImage = async () => {
    if (!canManage) return;
    if (!editingPreset?.image) return showError(t('请先上传预设图片'));
    if (!analysisModel) return showError(t('请选择分析模型'));

    setAnalyzingPreset(true);
    try {
      const res = await API.post(
        CHAT_COMPLETIONS_ENDPOINT,
        {
          model: analysisModel,
          stream: false,
          temperature: 0.2,
          messages: [
            { role: 'system', content: PRESET_ANALYSIS_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: PRESET_ANALYSIS_USER_PROMPT },
                { type: 'image_url', image_url: { url: editingPreset.image } },
              ],
            },
          ],
        },
        { skipErrorHandler: true },
      );
      const parsed = extractJsonObject(
        res.data?.choices?.[0]?.message?.content || '',
      );
      const name = String(parsed?.name || '').trim();
      const prompt = String(parsed?.prompt || '').trim();
      if (!name && !prompt) throw new Error(t('模型未返回可用的分析结果'));
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
    if (!canManage) return closePresetModal();
    const nextPreset = normalizePromptPreset(editingPreset);
    if (!nextPreset.name) return showError(t('请输入预设名称'));
    if (!nextPreset.image) return showError(t('请上传预设图片'));
    if (!nextPreset.prompt) return showError(t('请输入提示词内容'));

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
    if (!canManage) return;
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

  const renderActionsArea = () =>
    canManage ? (
      <Button
        className='w-full md:w-auto'
        icon={<IconPlus />}
        onClick={openAddPresetModal}
        size='small'
        type='primary'
      >
        {t('添加预设提示词')}
      </Button>
    ) : null;

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
            {canManage && (
              <Button
                icon={<IconPlus />}
                onClick={openAddPresetModal}
                type='primary'
              >
                {t('添加预设提示词')}
              </Button>
            )}
          </Empty>
        </div>
      );
    }

    return (
      <div
        className='grid content-start gap-4'
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
      >
        {promptPresets.map((preset, index) => (
          <Card
            bordered
            bodyStyle={{ padding: 12 }}
            className='overflow-hidden'
            key={preset.id || index}
          >
            <button
              className='mb-3 flex w-full items-center justify-center overflow-hidden rounded border-0 p-0'
              onClick={() => openPresetModal(preset, index)}
              style={{
                aspectRatio: '1 / 1',
                background: 'var(--semi-color-fill-0)',
                cursor: 'pointer',
              }}
              type='button'
            >
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
            </button>

            <div className='mb-3 flex flex-col gap-1'>
              <Text strong ellipsis={{ showTooltip: true }}>
                {preset.name || t('未命名预设')}
              </Text>
              <Text
                ellipsis={{ rows: 2, showTooltip: true }}
                size='small'
                type='tertiary'
              >
                {preset.prompt}
              </Text>
            </div>

            {canManage && (
              <div className='grid grid-cols-2 gap-2'>
                <Button
                  icon={<IconEdit />}
                  onClick={() => openPresetModal(preset, index)}
                  theme='outline'
                >
                  {t('编辑')}
                </Button>
                <Button
                  icon={<IconDelete />}
                  onClick={() => deletePromptPreset(index)}
                  theme='outline'
                  type='danger'
                >
                  {t('删除')}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className='mt-[60px] px-2'>
      <CardPro type='type3' actionsArea={renderActionsArea()} t={t}>
        <Spin spinning={loading}>{renderPromptPresets()}</Spin>
      </CardPro>

      <Modal
        title={
          canManage
            ? editingPresetIndex === null
              ? t('添加预设提示词')
              : t('编辑预设提示词')
            : t('预设提示词')
        }
        visible={presetModalVisible}
        onCancel={closePresetModal}
        onOk={upsertPromptPreset}
        okText={canManage ? t('确定') : t('关闭')}
        cancelText={t('取消')}
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
                  <IconImage size='extra-large' />
                </div>
              )}
              {canManage && (
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
              )}
            </div>

            <div className='flex flex-col'>
              {canManage && (
                <div className='mb-4 flex flex-col gap-2'>
                  <Text strong>{t('分析模型')}</Text>
                  <div className='flex flex-col gap-2 md:flex-row'>
                    <Select
                      className='min-w-0 flex-1'
                      disabled={analyzingPreset}
                      filter
                      onChange={setAnalysisModel}
                      optionList={analysisModelOptions}
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
              )}
              <div className='mb-4 flex flex-col gap-2'>
                <Text strong>{t('预设名称')}</Text>
                {canManage ? (
                  <Input
                    onChange={(value) => updateEditingPreset({ name: value })}
                    placeholder={t('例如：商品图爆款封面')}
                    value={editingPreset.name}
                  />
                ) : (
                  <Text>{editingPreset.name || t('未命名预设')}</Text>
                )}
              </div>
              <div className='flex flex-col gap-2'>
                <Text strong>{t('提示词内容')}</Text>
                {canManage ? (
                  <TextArea
                    autosize={{ minRows: 8, maxRows: 14 }}
                    onChange={(value) => updateEditingPreset({ prompt: value })}
                    placeholder={t('输入预设提示词')}
                    value={editingPreset.prompt}
                  />
                ) : (
                  <TextArea
                    autosize={{ minRows: 8, maxRows: 14 }}
                    readonly
                    value={editingPreset.prompt}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ImagePresets;
