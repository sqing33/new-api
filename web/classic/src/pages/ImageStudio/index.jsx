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
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
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
import { API, copy, showError, showSuccess } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { UserContext } from '../../context/User';
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
  CHAT_COMPLETIONS: '/pg/chat/completions',
  USER_GROUPS: '/api/user/self/groups',
  USER_MODELS: '/api/user/models',
  OPTIONS: '/api/option/',
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

const TEMPLATE_DEFAULTS = {
  productName: '',
  sellingPoints: '',
  audience: '',
  scenario: '',
  campaign: '',
  brandColor: '#1677ff',
  style: '高级商业摄影、干净背景、强转化视觉',
  optimize: false,
  imagine: true,
  count: 4,
  textModel: '',
};

const PRODUCT_TEMPLATE_SLOTS = [
  {
    key: 'main',
    title: '商品主图',
    ratio: '1:1',
    resolution: 'standard',
    usage: '电商平台商品主图，突出商品主体和核心卖点',
  },
  {
    key: 'social',
    title: '社媒封面',
    ratio: '3:4',
    resolution: 'standard',
    usage: '小红书、朋友圈、内容账号封面，吸引点击',
  },
  {
    key: 'poster',
    title: '销售海报',
    ratio: '9:16',
    resolution: 'standard',
    usage: '竖版销售海报，包含短标题、卖点和活动氛围',
  },
  {
    key: 'hero',
    title: '详情页头图',
    ratio: '16:9',
    resolution: 'standard',
    usage: '落地页或商品详情页首屏头图，建立品牌信任',
  },
];

const IMAGE_MODEL_HINTS = [
  'image',
  'dall',
  'gpt-image',
  'imagen',
  'flux',
  'wan',
  'jimeng',
  'midjourney',
];

const PROMPT_PRESETS_OPTION_KEY = 'ImagePromptPresets';
const PROMPT_PRESET_USAGE_PREFIX =
  '这不是原图修复、抠图、高清化或轻微调色任务。请把用户上传的图片或用户输入的主体作为最终画面的核心，不要原样复刻参考图；如果用户上传了主体图，请保留主体身份、外观、颜色、材质和关键结构，并根据预设重新组织画面风格、版式、构图、光影、空间、装饰元素和视觉层次；如果没有主体图，则按用户文字生成主体，但仍只借鉴预设的风格和版式。';
const PROMPT_PRESET_STYLE_PREFIX =
  '下面的预设提示词和最后一张名为 style-reference-preset 的参考图只作为风格/版式模板参考，请只学习其中的画面类型、主体位置、构图、配色倾向、光影、材质质感、标注方式、信息框、细节展示、三视图、物品介绍、文字层级和设计语言；不要复刻预设里的具体商品、人物、动物、角色、Logo、品牌、地点、场景主体、元素主题或原有文案。最终主体必须以用户上传图片或用户文字为准。';

const selectOptions = (items, labels = {}) =>
  items.map((value) => ({ label: labels[value] || value, value }));

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

const isPromptPresetFileItem = (item) =>
  String(item?.uid || '').startsWith('prompt-preset-') ||
  String(item?.name || '').startsWith('style-reference-preset');

const getPresetImageExtension = (mime) => {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
};

const dataUrlToFile = (dataUrl, name) => {
  const match = String(dataUrl || '').match(
    /^data:(image\/[^;]+);base64,(.+)$/,
  );
  if (!match) return null;

  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const safeName = String(name || 'style-reference-preset')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-');
  return new File(
    [bytes],
    `${safeName || 'style-reference-preset'}.${getPresetImageExtension(mime)}`,
    { type: mime },
  );
};

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

const getTemplateSlots = (count) =>
  Array.from(
    { length: Math.min(Math.max(Number(count) || 4, 1), 8) },
    (_, index) => PRODUCT_TEMPLATE_SLOTS[index % PRODUCT_TEMPLATE_SLOTS.length],
  );

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

const ImageStudio = ({ publicMode = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [statusState, statusDispatch] = useContext(StatusContext);
  const [userState] = useContext(UserContext);
  const [mode, setMode] = useState('generate');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [groups, setGroups] = useState([]);
  const [allModels, setAllModels] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [imageFileList, setImageFileList] = useState([]);
  const [productFiles, setProductFiles] = useState([]);
  const [productFileList, setProductFileList] = useState([]);
  const [logoFiles, setLogoFiles] = useState([]);
  const [logoFileList, setLogoFileList] = useState([]);
  const [templateForm, setTemplateForm] = useState(TEMPLATE_DEFAULTS);
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
  const [promptPresets, setPromptPresets] = useState([]);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [presetPrompt, setPresetPrompt] = useState('');
  const [presetName, setPresetName] = useState('');
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

  const selectedSize = getImageSize(config.ratio, config.resolution);
  const maxCount = currentModelSetting?.max_n || 1;
  const textModelOptions = useMemo(() => {
    const imageModelSet = new Set(filteredModels);
    const textModels = allModels.filter((model) => {
      const normalized = String(model || '').toLowerCase();
      return (
        !imageModelSet.has(model) &&
        !IMAGE_MODEL_HINTS.some((hint) => normalized.includes(hint))
      );
    });
    return textModels.length > 0 ? textModels : allModels;
  }, [allModels, filteredModels]);

  const groupOptions = useMemo(() => {
    if (groups.length === 0) return [{ value: '', label: t('用户默认分组') }];

    return groups.map((group) => ({
      value: group.value,
      label: group.desc
        ? `${group.label} (${group.desc})`
        : group.label || group.value,
    }));
  }, [groups, t]);

  const isLoggedIn = Boolean(userState?.user || localStorage.getItem('user'));

  const redirectToLogin = () => {
    navigate('/login?redirect=/image-studio', {
      state: { from: { pathname: '/image-studio' } },
    });
  };

  const requireLoginForAction = () => {
    if (!publicMode || isLoggedIn) return true;
    showError(t('请先登录后再生成图片'));
    redirectToLogin();
    return false;
  };

  useEffect(() => {
    const loadData = async () => {
      setLoadingModels(true);
      try {
        const statusRes = await API.get('/api/status');

        if (statusRes.data?.success && statusRes.data?.data) {
          const nextStatus = statusRes.data.data;
          setImageModelSettingsValue(nextStatus.image_model_settings);
          statusDispatch({ type: 'set', payload: nextStatus });
          setStatusData(nextStatus);
        }

        if (!isLoggedIn) {
          setGroups([]);
          setAllModels([]);
          return;
        }

        const [groupsRes, modelsRes] = await Promise.all([
          API.get(API_ENDPOINTS.USER_GROUPS),
          API.get(API_ENDPOINTS.USER_MODELS),
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

        if (modelsRes.data?.success && Array.isArray(modelsRes.data?.data)) {
          setAllModels(modelsRes.data.data);
        }
      } catch (error) {
        showError(extractErrorMessage(error, t('加载模型与分组失败')));
      } finally {
        setLoadingModels(false);
      }
    };

    loadData();
  }, [isLoggedIn, statusDispatch, t]);

  useEffect(() => {
    if (filteredModels.length === 0) return;
    if (!filteredModels.includes(config.model)) {
      setConfig((current) => ({ ...current, model: filteredModels[0] }));
    }
  }, [filteredModels, config.model]);

  useEffect(() => {
    if (!currentModelSetting) return;

    const currentModeSupported =
      imageModelSupportsMode(currentModelSetting, 'generations') ||
      imageModelSupportsMode(currentModelSetting, 'edits');

    if (!currentModeSupported && mode !== 'generate') {
      setMode('generate');
    }

    setConfig((current) => ({
      ...current,
      count: Math.min(Math.max(Number(current.count) || 1, 1), maxCount),
      ratio: normalizeRatioForResolution(current.ratio, current.resolution),
    }));
  }, [currentModelSetting, maxCount, mode]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((group) => group.value === config.group)) {
      setConfig((current) => ({ ...current, group: groups[0].value }));
    }
  }, [groups, config.group]);

  useEffect(() => {
    if (textModelOptions.length === 0 || templateForm.textModel) return;
    setTemplateForm((current) => ({
      ...current,
      textModel: textModelOptions[0],
    }));
  }, [textModelOptions, templateForm.textModel]);

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

  const updateTemplateForm = (key, value) => {
    setTemplateForm((current) => ({ ...current, [key]: value }));
  };

  const handleReferenceUploadChange = ({ fileList = [] }) => {
    const nextFileList = fileList.filter((item) => item.fileInstance);
    setImageFileList(nextFileList);
    setImageFiles(nextFileList.map((item) => item.fileInstance));
  };

  const handleProductUploadChange = ({ fileList = [] }) => {
    const nextFileList = fileList.filter((item) => item.fileInstance);
    setProductFileList(nextFileList);
    setProductFiles(nextFileList.map((item) => item.fileInstance));
  };

  const handleLogoUploadChange = ({ fileList = [] }) => {
    const nextFileList = fileList.filter((item) => item.fileInstance);
    setLogoFileList(nextFileList);
    setLogoFiles(nextFileList.map((item) => item.fileInstance));
  };

  const getOrderedReferenceFiles = () => [
    ...imageFiles.filter(
      (file) =>
        file && !String(file.name || '').startsWith('style-reference-preset'),
    ),
    ...imageFiles.filter(
      (file) =>
        file && String(file.name || '').startsWith('style-reference-preset'),
    ),
  ];

  const loadPromptPresets = async () => {
    setPresetLoading(true);
    try {
      const res = await API.get(API_ENDPOINTS.OPTIONS);
      const option = res.data?.data?.find(
        (item) => item.key === PROMPT_PRESETS_OPTION_KEY,
      );
      setPromptPresets(parsePromptPresets(option?.value));
    } catch (error) {
      showError(extractErrorMessage(error, t('加载预设提示词失败')));
    } finally {
      setPresetLoading(false);
    }
  };

  const openPromptPresetModal = async () => {
    if (!requireLoginForAction()) return;
    setPresetModalVisible(true);
    await loadPromptPresets();
  };

  const buildPresetPrompt = (preset) =>
    [
      PROMPT_PRESET_USAGE_PREFIX,
      PROMPT_PRESET_STYLE_PREFIX,
      preset.prompt && `预设风格模板：\n${preset.prompt}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const applyPromptPreset = (preset) => {
    const normalized = normalizePromptPreset(preset);
    setPresetPrompt(buildPresetPrompt(normalized));
    setPresetName(normalized.name || '');
    const userFileList = imageFileList.filter(
      (item) => !isPromptPresetFileItem(item),
    );
    const userFiles = imageFiles.filter(
      (file) =>
        file && !String(file.name || '').startsWith('style-reference-preset'),
    );

    if (normalized.image) {
      const presetFile = dataUrlToFile(
        normalized.image,
        'style-reference-preset',
      );
      if (!presetFile) {
        showError(t('该预设图片无效'));
        return;
      }

      const presetFileItem = {
        uid: `prompt-preset-${normalized.id || Date.now()}`,
        name: presetFile.name,
        status: 'success',
        fileInstance: presetFile,
      };
      setImageFileList([...userFileList, presetFileItem]);
      setImageFiles([...userFiles, presetFile]);
    } else {
      setImageFileList(userFileList);
      setImageFiles(userFiles);
    }

    setMode('generate');
    setPresetModalVisible(false);
    showSuccess(t('已应用预设提示词'));
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

  const buildEffectivePrompt = ({
    prompt = config.prompt,
    preset = presetPrompt,
  } = {}) => {
    const userPrompt = String(prompt || '').trim();
    const templatePrompt = String(preset || '').trim();

    if (userPrompt && templatePrompt) {
      return [
        `用户创作需求：\n${userPrompt}`,
        `预设风格模板与参考图说明：\n${templatePrompt}`,
      ].join('\n\n');
    }

    return userPrompt || templatePrompt;
  };

  const buildGenerationPayload = ({
    prompt = buildEffectivePrompt(),
    size = selectedSize,
  } = {}) => {
    const payload = {
      model: config.model,
      prompt,
      n: 1,
      response_format: 'b64_json',
    };
    if (config.group) payload.group = config.group;
    if (size) payload.size = size;
    return payload;
  };

  const buildFormData = ({
    prompt = buildEffectivePrompt(),
    size = selectedSize,
    files = getOrderedReferenceFiles(),
  } = {}) => {
    const formData = new FormData();
    formData.append('model', config.model);
    if (config.group) formData.append('group', config.group);
    formData.append('prompt', prompt);
    formData.append('n', '1');
    formData.append('response_format', 'b64_json');
    if (size) formData.append('size', size);
    files.forEach((file) => formData.append('image', file));
    return formData;
  };

  const requestOneImage = async ({
    prompt = buildEffectivePrompt(),
    size = selectedSize,
    files = getOrderedReferenceFiles(),
    requestMode,
  } = {}) => {
    const effectiveMode =
      requestMode || (files.length > 0 ? 'edit' : 'generate');
    const res =
      effectiveMode === 'edit'
        ? await API.post(
            API_ENDPOINTS.IMAGE_EDITS,
            buildFormData({ prompt, size, files }),
            {
              skipErrorHandler: true,
            },
          )
        : await API.post(
            API_ENDPOINTS.IMAGE_GENERATIONS,
            buildGenerationPayload({ prompt, size }),
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
      mode: result.mode || mode,
      model: config.model,
      group: config.group,
      prompt: result.prompt || buildEffectivePrompt(),
      ratio: result.ratio || config.ratio,
      resolution: result.resolution || config.resolution,
      size: result.size || selectedSize,
      image: source,
      template_slot: result.template_slot || '',
      revised_prompt: result.revised_prompt || '',
    });
  };

  const buildTemplatePrompt = (slot) => {
    const lines = [
      '把这张图片做成商品图，文字语言是中文。',
      `生成一张${slot.title}。`,
      `用途：${slot.usage}。`,
      templateForm.productName && `商品名称：${templateForm.productName}`,
      templateForm.sellingPoints && `核心卖点：${templateForm.sellingPoints}`,
      templateForm.audience && `目标人群：${templateForm.audience}`,
      templateForm.scenario && `使用场景：${templateForm.scenario}`,
      templateForm.campaign && `活动文案：${templateForm.campaign}`,
      templateForm.brandColor && `品牌主色：${templateForm.brandColor}`,
      templateForm.style && `视觉风格：${templateForm.style}`,
      productFiles.length > 0
        ? '严格参考上传的商品图片，保持商品主体、颜色、材质和关键结构一致。'
        : '没有商品参考图时，请根据商品信息创建可信、清晰的商业视觉主体。',
      logoFiles.length > 0
        ? '参考上传的 Logo 或品牌图，保持品牌调性，但不要让 Logo 遮挡商品主体。'
        : '',
      templateForm.imagine
        ? '请自行发挥想象：主动补全商业场景、构图、道具、光影、营销氛围和短标题表达，让图片更像可直接售卖的商品图。'
        : '不要自行扩展未提供的商品功能、品牌承诺或活动信息；只围绕已提供的图片和文字做商业化呈现。',
      '画面应商业化、干净、有转化感；文字只使用短标题和少量大字，避免生成密集小字。',
      '不要出现水印、二维码、乱码、低清晰度、畸变商品、额外品牌标识。',
    ];

    return lines.filter(Boolean).join('\n');
  };

  const extractOptimizedPrompt = (content, fallback) => {
    if (!content) return fallback;
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const raw = fenced || content;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.final_prompt === 'string') return parsed.final_prompt;
      if (typeof parsed.prompt === 'string') return parsed.prompt;
    } catch {
      // Some models return prose; use it directly if it is concise enough.
    }
    return raw.trim() || fallback;
  };

  const optimizeTemplatePrompt = async (slot, basePrompt) => {
    if (!templateForm.optimize) return basePrompt;
    if (!templateForm.textModel) throw new Error(t('请选择提示词优化模型'));

    const res = await API.post(
      API_ENDPOINTS.CHAT_COMPLETIONS,
      {
        model: templateForm.textModel,
        group: config.group,
        stream: false,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              '你是商业生图提示词专家。请把用户输入优化成适合图像生成模型的中文提示词，只返回 JSON，不要解释。',
          },
          {
            role: 'user',
            content:
              '请输出 {"final_prompt":"..."}。要求保留商品一致性、商业构图、品牌色、用途和限制。\n\n' +
              `物料：${slot.title}\n${basePrompt}`,
          },
        ],
      },
      { skipErrorHandler: true },
    );

    const content = res.data?.choices?.[0]?.message?.content || '';
    return extractOptimizedPrompt(content, basePrompt);
  };

  const requestTemplateSlot = async (slot) => {
    const size = getImageSize(slot.ratio, slot.resolution);
    const basePrompt = buildTemplatePrompt(slot);
    const prompt = await optimizeTemplatePrompt(slot, basePrompt);
    const canEdit =
      (productFiles.length > 0 || logoFiles.length > 0) &&
      imageModelSupportsMode(currentModelSetting, 'edits');
    const requestMode = canEdit ? 'edit' : 'generate';
    const result = await requestOneImage({
      prompt,
      size,
      files: [...productFiles, ...logoFiles],
      requestMode,
    });

    return {
      ...result,
      mode: 'template',
      prompt,
      ratio: slot.ratio,
      resolution: slot.resolution,
      size,
      template_slot: slot.title,
      template_key: slot.key,
    };
  };

  const handleGenerate = async () => {
    if (!requireLoginForAction()) return;
    if (!currentModelSetting) {
      showError(t('当前模型没有生图配置'));
      return;
    }
    if (mode === 'template') {
      await handleTemplateGenerate();
      return;
    }
    const effectivePrompt = buildEffectivePrompt();
    if (!effectivePrompt) {
      showError(t('请输入提示词'));
      return;
    }
    const referenceFiles = getOrderedReferenceFiles();
    const requestMode = referenceFiles.length > 0 ? 'edit' : 'generate';
    if (
      requestMode === 'edit' &&
      !imageModelSupportsMode(currentModelSetting, 'edits')
    ) {
      showError(t('当前模型不支持该生图模式'));
      return;
    }
    if (
      requestMode === 'generate' &&
      !imageModelSupportsMode(currentModelSetting, 'generations')
    ) {
      showError(t('该模型需要先上传参考图'));
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
      const tasks = Array.from({ length: total }, async () => {
        try {
          const result = {
            ...(await requestOneImage({
              prompt: effectivePrompt,
              files: referenceFiles,
              requestMode,
            })),
            mode: requestMode,
            prompt: effectivePrompt,
            ratio: config.ratio,
            resolution: config.resolution,
            size: selectedSize,
          };
          setResults((current) => [...current, result]);
          try {
            await saveImageHistory(result);
          } catch {
            historySaveFailed = true;
          }
          return result;
        } catch (error) {
          failures.push(extractErrorMessage(error, t('生图请求失败')));
        } finally {
          setGeneratedCount((current) => current + 1);
        }
        return null;
      });

      await Promise.all(tasks);

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

  const handleRegenerateResult = async (index) => {
    if (!requireLoginForAction()) return;
    const current = results[index];
    if (!current) return;

    setGenerating(true);
    setLastError('');
    try {
      const currentSlot = PRODUCT_TEMPLATE_SLOTS.find(
        (slot) => slot.key === current.template_key,
      );
      const nextResult = currentSlot
        ? await requestTemplateSlot(currentSlot)
        : {
            ...(await requestOneImage({
              prompt: current.prompt || config.prompt,
              size: current.size || selectedSize,
              requestMode: current.mode === 'edit' ? 'edit' : 'generate',
            })),
            mode: current.mode || mode,
            prompt: current.prompt || config.prompt,
            size: current.size || selectedSize,
          };

      setResults((currentResults) =>
        currentResults.map((item, itemIndex) =>
          itemIndex === index ? nextResult : item,
        ),
      );
      await saveImageHistory(nextResult);
      await loadHistory();
      showSuccess(t('重新生成成功'));
    } catch (error) {
      const message = extractErrorMessage(error, t('生图请求失败'));
      setLastError(message);
      showError(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleTemplateGenerate = async () => {
    if (!requireLoginForAction()) return;
    const canGenerate = imageModelSupportsMode(
      currentModelSetting,
      'generations',
    );
    const canEdit = imageModelSupportsMode(currentModelSetting, 'edits');
    if (!canGenerate && !canEdit) {
      showError(t('当前模型不支持模板工作流'));
      return;
    }
    if (
      !canGenerate &&
      canEdit &&
      productFiles.length === 0 &&
      logoFiles.length === 0
    ) {
      showError(t('该模型需要先上传参考图'));
      return;
    }
    if (
      productFiles.length === 0 &&
      logoFiles.length === 0 &&
      !templateForm.productName.trim() &&
      !templateForm.sellingPoints.trim()
    ) {
      showError(t('请上传商品图或填写商品信息'));
      return;
    }
    if (templateForm.optimize && !templateForm.textModel) {
      showError(t('请选择提示词优化模型'));
      return;
    }

    const failures = [];
    let historySaveFailed = false;

    setGenerating(true);
    setGeneratedCount(0);
    setLastError('');
    setResults([]);
    setCurrentResultIndex(0);
    setImageErrors({});

    try {
      const templateSlots = getTemplateSlots(templateForm.count);
      const tasks = templateSlots.map(async (slot) => {
        try {
          const result = await requestTemplateSlot(slot);
          setResults((current) => [...current, result]);
          try {
            await saveImageHistory(result);
          } catch {
            historySaveFailed = true;
          }
          return result;
        } catch (error) {
          failures.push(
            `${t(slot.title)}: ${extractErrorMessage(error, t('生图请求失败'))}`,
          );
        } finally {
          setGeneratedCount((current) => current + 1);
        }
        return null;
      });

      await Promise.all(tasks);

      if (failures.length === getTemplateSlots(templateForm.count).length) {
        const message = failures[0] || t('生图请求失败');
        setLastError(message);
        showError(message);
      } else if (failures.length > 0) {
        setLastError(t('部分图片生成失败：') + failures.join('；'));
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

  const handleCopyPrompt = async (promptText) => {
    if (!promptText) return;
    if (await copy(promptText)) {
      showSuccess(t('复制成功'));
    } else {
      showError(t('复制失败'));
    }
  };

  const formatHistoryTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  };

  const previewHistoryRecord = (record) => {
    const promptText = record.revised_prompt || record.prompt || '';
    let modalRef;

    modalRef = Modal.info({
      title: t('查看历史图片'),
      width: 980,
      bodyStyle: { overflow: 'hidden' },
      content: (
        <div
          className={
            isMobile
              ? 'flex max-h-[68vh] flex-col gap-4 overflow-y-auto'
              : 'grid h-[68vh] overflow-hidden grid-cols-[minmax(0,1fr)_380px] gap-4'
          }
        >
          <div
            className='flex items-center justify-center overflow-hidden rounded'
            style={{
              background: 'var(--semi-color-fill-0)',
              minHeight: isMobile ? 280 : 520,
            }}
          >
            {record.image ? (
              <img
                alt={promptText}
                className='max-h-full max-w-full object-contain'
                src={record.image}
              />
            ) : (
              <Text type='tertiary'>{t('图片加载失败')}</Text>
            )}
          </div>
          <div className='flex min-h-0 flex-col gap-3 overflow-hidden'>
            <div className='flex flex-col gap-1'>
              <Text strong>{record.model || t('未知模型')}</Text>
              <Text size='small' type='tertiary'>
                {record.template_slot
                  ? t(record.template_slot)
                  : record.mode === 'edit'
                    ? t('图生图')
                    : t('文生图')}{' '}
                · {record.size || t('自动')}
              </Text>
              <Text size='small' type='tertiary'>
                {formatHistoryTime(record.created_at)}
              </Text>
            </div>
            <div className='flex items-center justify-between gap-2'>
              <Text strong>{t('提示词')}</Text>
              <Button
                disabled={!promptText}
                onClick={() => handleCopyPrompt(promptText)}
                size='small'
                theme='outline'
              >
                {t('复制提示词')}
              </Button>
            </div>
            <textarea
              className='w-full flex-1 rounded border p-3 text-sm leading-6 outline-none'
              readOnly
              style={{
                background: 'var(--semi-color-fill-0)',
                borderColor: 'var(--semi-color-border)',
                color: 'var(--semi-color-text-0)',
                minHeight: isMobile ? 260 : 0,
                overflow: 'auto',
                resize: 'none',
              }}
              value={promptText}
            />
          </div>
        </div>
      ),
      footer: (
        <div className='flex justify-end gap-2'>
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
            onClick={() => {
              modalRef?.destroy?.();
              removeHistoryRecord(record);
            }}
            theme='outline'
            type='danger'
          >
            {t('删除')}
          </Button>
          <Button
            onClick={() => modalRef?.destroy?.()}
            theme='solid'
            type='primary'
          >
            {t('关闭')}
          </Button>
        </div>
      ),
      hasCancel: false,
      hasOk: false,
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

  const renderModelGroupSettings = () => (
    <div
      className='grid gap-3'
      style={{
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
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
  );

  const renderTemplateWorkflow = () => (
    <div className='flex flex-col gap-4'>
      <Banner
        closeIcon={null}
        description={t('一次生成商品主图、社媒封面、销售海报和详情页头图。')}
        type='info'
      />

      <div className='grid grid-cols-2 gap-3'>
        <Button
          disabled={generating}
          onClick={() => updateTemplateForm('optimize', false)}
          theme={!templateForm.optimize ? 'solid' : 'outline'}
          type={!templateForm.optimize ? 'primary' : 'tertiary'}
        >
          {t('快速生成')}
        </Button>
        <Button
          disabled={generating}
          onClick={() => updateTemplateForm('optimize', true)}
          theme={templateForm.optimize ? 'solid' : 'outline'}
          type={templateForm.optimize ? 'primary' : 'tertiary'}
        >
          {t('AI 优化')}
        </Button>
      </div>

      {renderModelGroupSettings()}

      {templateForm.optimize && (
        <div className='flex flex-col gap-2'>
          <Text strong>{t('提示词优化模型')}</Text>
          <Select
            disabled={generating || textModelOptions.length === 0}
            filter
            optionList={selectOptions(textModelOptions)}
            onChange={(value) => updateTemplateForm('textModel', value)}
            placeholder={t('请选择模型')}
            value={templateForm.textModel}
          />
        </div>
      )}

      <div className='grid grid-cols-2 gap-3'>
        <div className='flex flex-col gap-2'>
          <Text strong>{t('生成张数')}</Text>
          <InputNumber
            disabled={generating}
            max={8}
            min={1}
            onChange={(value) =>
              updateTemplateForm('count', Number(value) || 4)
            }
            value={templateForm.count}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Text strong>{t('自行发挥想象')}</Text>
          <div className='semi-input-default flex items-center justify-between gap-3'>
            <Text size='small' type='tertiary'>
              {templateForm.imagine ? t('开') : t('关')}
            </Text>
            <Switch
              checked={templateForm.imagine}
              disabled={generating}
              onChange={(checked) => updateTemplateForm('imagine', checked)}
            />
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('商品参考图')}</Text>
        <Upload
          accept='image/png,image/jpeg,image/webp'
          beforeUpload={() => false}
          fileList={productFileList}
          limit={4}
          multiple
          onChange={handleProductUploadChange}
          uploadTrigger='custom'
        >
          <Button
            disabled={generating}
            icon={<UploadCloud size={16} />}
            theme='outline'
          >
            {t('上传商品图')}
          </Button>
        </Upload>
        {productFiles.length > 0 && (
          <Text size='small' type='tertiary'>
            {productFiles.map((file) => file.name).join(', ')}
          </Text>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('Logo/品牌图')}</Text>
        <Upload
          accept='image/png,image/jpeg,image/webp'
          beforeUpload={() => false}
          fileList={logoFileList}
          limit={1}
          onChange={handleLogoUploadChange}
          uploadTrigger='custom'
        >
          <Button
            disabled={generating}
            icon={<UploadCloud size={16} />}
            theme='outline'
          >
            {t('上传 Logo')}
          </Button>
        </Upload>
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('商品名称')}</Text>
        <Input
          disabled={generating}
          onChange={(value) => updateTemplateForm('productName', value)}
          placeholder={t('例如：AI 写作训练营')}
          value={templateForm.productName}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('核心卖点')}</Text>
        <TextArea
          autosize={{ minRows: 3, maxRows: 6 }}
          disabled={generating}
          onChange={(value) => updateTemplateForm('sellingPoints', value)}
          placeholder={t('用 2-4 句话描述最想突出的卖点')}
          value={templateForm.sellingPoints}
        />
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <div className='flex flex-col gap-2'>
          <Text strong>{t('目标人群')}</Text>
          <Input
            disabled={generating}
            onChange={(value) => updateTemplateForm('audience', value)}
            placeholder={t('例如：职场新人、内容创作者')}
            value={templateForm.audience}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Text strong>{t('品牌色')}</Text>
          <div className='image-studio-color-picker semi-input-default flex items-center gap-2'>
            <input
              aria-label={t('品牌色')}
              disabled={generating}
              onChange={(event) =>
                updateTemplateForm('brandColor', event.target.value)
              }
              onInput={(event) =>
                updateTemplateForm('brandColor', event.currentTarget.value)
              }
              type='color'
              value={templateForm.brandColor}
            />
            <Text size='small' type='tertiary'>
              {templateForm.brandColor}
            </Text>
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('使用场景')}</Text>
        <Input
          disabled={generating}
          onChange={(value) => updateTemplateForm('scenario', value)}
          placeholder={t('例如：通勤学习、直播间转化、课程详情页')}
          value={templateForm.scenario}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('活动文案')}</Text>
        <Input
          disabled={generating}
          onChange={(value) => updateTemplateForm('campaign', value)}
          placeholder={t('例如：限时 7 折、今晚 20:00 开课')}
          value={templateForm.campaign}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Text strong>{t('视觉风格')}</Text>
        <TextArea
          autosize={{ minRows: 2, maxRows: 4 }}
          disabled={generating}
          onChange={(value) => updateTemplateForm('style', value)}
          value={templateForm.style}
        />
      </div>
    </div>
  );

  const renderCurrentResults = () => {
    if (results.length === 0) {
      return (
        <div className='flex h-full min-h-[420px] items-center justify-center'>
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
    const promptText = result.prompt || result.revised_prompt || config.prompt;

    return (
      <div className='flex h-full min-h-0 flex-col gap-3'>
        {result.template_slot && (
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Text strong>{t(result.template_slot)}</Text>
            <Text size='small' type='tertiary'>
              {result.size || t('自动')}
            </Text>
          </div>
        )}

        <div
          className='relative flex items-center justify-center overflow-hidden rounded'
          style={{
            background: 'var(--semi-color-fill-0)',
            flex: 1,
            minHeight: isMobile ? 300 : 0,
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
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <Button
              disabled={!promptText}
              onClick={() => handleCopyPrompt(promptText)}
              theme='outline'
            >
              {t('复制提示词')}
            </Button>
            <Button
              disabled={generating}
              icon={<Sparkles size={16} />}
              onClick={() => handleRegenerateResult(currentResultIndex)}
              theme='outline'
            >
              {t('重新生成')}
            </Button>
            <Button
              disabled={!source}
              icon={<Download size={16} />}
              onClick={() => handleDownload(result, currentResultIndex)}
              theme='outline'
            >
              {t('下载')}
            </Button>
          </div>
        </div>

        {promptText && (
          <Text
            ellipsis={{ showTooltip: true, rows: 3 }}
            size='small'
            type='tertiary'
          >
            {promptText}
          </Text>
        )}
      </div>
    );
  };

  const renderHistoryRecords = () => (
    <div className='flex flex-col gap-3'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Text type='tertiary'>{t('仅保存在当前浏览器，最多保留 50 条')}</Text>
          {historyLoading && <Spin size='small' />}
        </div>
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
          className='grid content-start gap-4'
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
                    {record.template_slot
                      ? t(record.template_slot)
                      : record.mode === 'edit'
                        ? t('图生图')
                        : t('文生图')}{' '}
                    · {record.size || t('自动')}
                  </Text>
                  <Text
                    className='flex items-center gap-1'
                    size='small'
                    type='tertiary'
                  >
                    <Clock3 size={13} />
                    {formatHistoryTime(record.created_at)}
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
    </div>
  );

  const renderPromptPresetModal = () => (
    <Modal
      footer={null}
      onCancel={() => setPresetModalVisible(false)}
      title={t('选择预设提示词')}
      visible={presetModalVisible}
      width={820}
    >
      <Spin spinning={presetLoading}>
        {promptPresets.length === 0 ? (
          <div className='py-10'>
            <Empty
              image={<ImageIcon size={40} />}
              title={t('暂无预设提示词')}
            />
          </div>
        ) : (
          <div className='grid max-h-[68vh] grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2'>
            {promptPresets.map((preset, index) => (
              <div
                className='flex min-h-0 flex-col overflow-hidden rounded-lg border'
                key={preset.id || index}
                style={{ borderColor: 'var(--semi-color-border)' }}
              >
                <div className='flex h-44 items-center justify-center bg-semi-color-fill-0'>
                  {preset.image ? (
                    <img
                      alt={preset.name}
                      className='max-h-full max-w-full object-contain'
                      src={preset.image}
                    />
                  ) : (
                    <ImageIcon
                      size={40}
                      style={{ color: 'var(--semi-color-text-2)' }}
                    />
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
                  <Button
                    block
                    onClick={() => applyPromptPreset(preset)}
                    theme='solid'
                    type='primary'
                  >
                    {t('使用预设')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Modal>
  );

  return (
    <div
      className={
        isMobile
          ? 'mt-[60px] px-2'
          : publicMode
            ? 'mt-[60px] flex h-[calc(100vh-64px)] flex-col overflow-hidden px-2 py-2'
            : 'mt-[60px] flex h-[calc(100vh-108px)] flex-col overflow-hidden px-2'
      }
    >
      {lastError && (
        <Banner
          className='mb-4'
          closeIcon={null}
          description={lastError}
          type='error'
        />
      )}

      <div
        className={
          isMobile ? 'grid gap-4' : 'grid min-h-0 flex-1 gap-4 overflow-hidden'
        }
        style={{
          gridTemplateColumns: isMobile ? '1fr' : '340px minmax(0, 1fr)',
          alignItems: 'stretch',
        }}
      >
        <Card
          bordered
          bodyStyle={{
            display: 'flex',
            flexDirection: 'column',
            flex: isMobile ? undefined : 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: isMobile ? undefined : 'hidden',
          }}
          className={
            isMobile
              ? undefined
              : 'image-studio-create-card flex min-h-0 flex-col overflow-hidden'
          }
          title={
            <div className='flex items-center gap-2'>
              <WandSparkles size={16} />
              <span>{t('创建')}</span>
            </div>
          }
        >
          <Spin
            spinning={loadingModels}
            wrapperClassName={isMobile ? undefined : 'image-studio-create-spin'}
          >
            <div
              className={
                isMobile
                  ? 'flex flex-col gap-4'
                  : 'flex h-full min-h-0 flex-col gap-4 pr-1'
              }
            >
              <Tabs
                activeKey={mode}
                onChange={(key) => setMode(key)}
                type='button'
              >
                {(imageModelSupportsMode(currentModelSetting, 'generations') ||
                  imageModelSupportsMode(currentModelSetting, 'edits')) && (
                  <Tabs.TabPane itemKey='generate' tab={t('生图')} />
                )}
                {(imageModelSupportsMode(currentModelSetting, 'generations') ||
                  imageModelSupportsMode(currentModelSetting, 'edits')) && (
                  <Tabs.TabPane itemKey='template' tab={t('商品图')} />
                )}
              </Tabs>

              <div
                className={
                  isMobile
                    ? 'flex flex-col gap-4'
                    : 'image-studio-settings-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2'
                }
              >
                {mode !== 'template' && renderModelGroupSettings()}

                {mode === 'template' && renderTemplateWorkflow()}

                {mode !== 'template' && (
                  <>
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

                    <div className='flex flex-col gap-2'>
                      <div className='flex items-center justify-between gap-2'>
                        <Text strong>{t('预设提示词')}</Text>
                        {presetName && (
                          <Text
                            ellipsis={{ showTooltip: true }}
                            size='small'
                            type='tertiary'
                          >
                            {presetName}
                          </Text>
                        )}
                      </div>
                      <TextArea
                        autosize={{ minRows: 4, maxRows: 10 }}
                        disabled={generating}
                        onChange={(value) => {
                          setPresetPrompt(value);
                          if (!String(value || '').trim()) {
                            setPresetName('');
                          }
                        }}
                        placeholder={t('输入预设提示词')}
                        value={presetPrompt}
                      />
                    </div>

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
                          {getOrderedReferenceFiles()
                            .map((file) => file.name)
                            .join(', ')}
                        </Text>
                      )}
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
                  </>
                )}
              </div>

              <div
                className={
                  mode === 'template'
                    ? 'shrink-0'
                    : 'grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2'
                }
              >
                {mode !== 'template' && (
                  <Button
                    disabled={generating}
                    icon={<WandSparkles size={16} />}
                    onClick={openPromptPresetModal}
                    theme='outline'
                  >
                    {t('预设提示词')}
                  </Button>
                )}
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
                    ? t('生成中') +
                      ` ${generatedCount}/${
                        mode === 'template'
                          ? getTemplateSlots(templateForm.count).length
                          : config.count
                      }`
                    : t('生成')}
                </Button>
              </div>
            </div>
          </Spin>
        </Card>

        <Card
          bordered
          bodyStyle={{
            display: 'flex',
            flexDirection: 'column',
            flex: isMobile ? undefined : 1,
            height: isMobile ? 620 : undefined,
            minHeight: 0,
            overflow: 'hidden',
          }}
          className='flex min-h-0 flex-col overflow-hidden'
        >
          <Tabs activeKey={resultTab} onChange={setResultTab} type='button'>
            <Tabs.TabPane itemKey='current' tab={t('当前结果')} />
            <Tabs.TabPane
              itemKey='history'
              tab={`${t('历史记录')} (${historyRecords.length})`}
            />
          </Tabs>

          <div
            className={
              resultTab === 'history'
                ? 'mt-4 min-h-0 flex-1 overflow-y-auto pr-1'
                : 'mt-4 min-h-0 flex-1 overflow-hidden'
            }
          >
            {resultTab === 'history'
              ? renderHistoryRecords()
              : renderCurrentResults()}
          </div>
        </Card>
      </div>
      {renderPromptPresetModal()}
    </div>
  );
};

export default ImageStudio;
