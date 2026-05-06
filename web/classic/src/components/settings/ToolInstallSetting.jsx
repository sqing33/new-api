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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  TabPane,
  Tabs,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { IconClose } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import {
  API,
  copy,
  processModelsData,
  showError,
  showSuccess,
} from '../../helpers';
import {
  buildImageModelSettingsMap,
  loadImageModelSettingsOption,
} from '../../helpers/imageModelSettingsOption';
import CardPro from '../common/ui/CardPro';

const CHAT_COMPLETIONS_ENDPOINT = '/pg/chat/completions';
const USER_MODELS_ENDPOINT = '/api/user/models';

const emptyTool = {
  slug: '',
  name: '',
  description: '',
  package_name: '',
  verify_command: '',
  shell_script: '',
  powershell_script: '',
  config_files: [],
  enabled: true,
};

const emptyConfigFile = {
  unix_path: '',
  windows_path: '',
  content: '',
  backup: true,
};

const defaultCodexConfigContent = `model_provider = "new-api"

[model_providers.new-api]
name = "New API"
base_url = "{{OPENAI_BASE_URL}}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`;

const defaultClaudeCodeConfigContent = `{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",
    "ANTHROPIC_BASE_URL": "{{BASE_URL}}"
  }
}
`;

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
      if (Array.isArray(parsed)) return parsed[0] || null;
      if (parsed && typeof parsed === 'object') return parsed.tool || parsed;
    } catch {}
  }
  return null;
};

const normalizeConfigFiles = (files = []) =>
  (Array.isArray(files) ? files : [])
    .map((file = {}) => ({
      index: file.index,
      platform: String(file.platform || 'unix').trim() || 'unix',
      path: String(file.path || file.target_path || file.targetPath || '').trim(),
      content: String(file.content || file.template || '').trim(),
      backup: file.backup === undefined ? true : !!file.backup,
      enabled: file.enabled === undefined ? true : !!file.enabled,
    }))
    .filter((file) => file.path || file.content);

const isWindowsConfigFile = (platform = '') =>
  String(platform).trim().toLowerCase() === 'windows';

const getDefaultConfigFileGroups = (tool = {}) => {
  const slug = String(tool.slug || '').trim().toLowerCase();
  const packageName = String(tool.package_name || '').trim().toLowerCase();
  if (slug === 'codex' || packageName === '@openai/codex') {
    return [
      {
        ...emptyConfigFile,
        unix_path: '~/.codex/config.toml',
        windows_path: '$env:USERPROFILE\\.codex\\config.toml',
        content: defaultCodexConfigContent,
      },
    ];
  }
  if (
    slug === 'claude-code' ||
    packageName === '@anthropic-ai/claude-code'
  ) {
    return [
      {
        ...emptyConfigFile,
        unix_path: '~/.claude/settings.json',
        windows_path: '$env:USERPROFILE\\.claude\\settings.json',
        content: defaultClaudeCodeConfigContent,
      },
    ];
  }
  return [];
};

const normalizeConfigFileGroups = (files = []) => {
  const indexedGroups = [];
  const groups = [];
  (Array.isArray(files) ? files : []).forEach((rawFile = {}) => {
    if (rawFile.unix_path !== undefined || rawFile.windows_path !== undefined) {
      const index = Number(rawFile.index);
      const group = {
        ...emptyConfigFile,
        unix_path: String(rawFile.unix_path || '').trim(),
        windows_path: String(rawFile.windows_path || '').trim(),
        content: String(rawFile.content || '').trim(),
        backup: rawFile.backup === undefined ? true : !!rawFile.backup,
      };
      if (Number.isInteger(index) && index >= 0) {
        indexedGroups[index] = group;
      } else {
        groups.push(group);
      }
      return;
    }

    const file = normalizeConfigFiles([rawFile])[0];
    if (!file) return;
    if (file.index !== undefined && file.index !== null) {
      const index = Number(file.index);
      if (Number.isInteger(index) && index >= 0) {
        const current = indexedGroups[index] || { ...emptyConfigFile };
        if (isWindowsConfigFile(file.platform)) {
          current.windows_path = file.path;
        } else {
          current.unix_path = file.path;
        }
        current.content = file.content || current.content || '';
        current.backup = file.backup;
        indexedGroups[index] = current;
        return;
      }
    }
    const sameTemplate = (item) =>
      item.content === file.content && item.backup === file.backup;
    const windows = isWindowsConfigFile(file.platform);
    const existing = groups.find(
      (item) =>
        sameTemplate(item) &&
        (windows ? !item.windows_path : !item.unix_path),
    );
    const group =
      existing ||
      (() => {
        const next = {
          ...emptyConfigFile,
          content: file.content,
          backup: file.backup,
        };
        groups.push(next);
        return next;
      })();
    if (windows) {
      group.windows_path = file.path;
    } else {
      group.unix_path = file.path;
    }
  });
  if (indexedGroups.length) {
    return indexedGroups
      .map((group) => group || { ...emptyConfigFile })
      .slice(0, indexedGroups.length);
  }
  return groups;
};

const expandConfigFileGroups = (groups = []) =>
  (Array.isArray(groups) ? groups : []).flatMap((group = {}) => {
    const content = String(group.content || '');
    const backup = group.backup === undefined ? true : !!group.backup;
    const files = [];
    const unixPath = String(group.unix_path || group.path || '').trim();
    const windowsPath = String(group.windows_path || '').trim();
    if (unixPath) {
      files.push({
        platform: 'unix',
        path: unixPath,
        content,
        backup,
        enabled: true,
      });
    }
    if (windowsPath) {
      files.push({
        platform: 'windows',
        path: windowsPath,
        content,
        backup,
        enabled: true,
      });
    }
    if (!unixPath && !windowsPath && content) {
      files.push({
        platform: 'all',
        path: '',
        content,
        backup,
        enabled: true,
      });
    }
    return files;
  });

const createSlugFromPackageName = (packageName = '') =>
  String(packageName)
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

const createSlugFromToolValues = (values = {}) =>
  createSlugFromPackageName(values.package_name) ||
  createSlugFromPackageName(values.name);

const getFieldSourceKey = (field) => `basic.${field}`;
const getConfigSourceKey = (index, field) => `config.${index}.${field}`;

const normalizeAiConfigFileGroups = (files = []) =>
  (Array.isArray(files) ? files : [])
    .map((file = {}, index) => ({
      index: Number.isInteger(Number(file.index)) ? Number(file.index) : index,
      unix_path: String(file.unix_path || '').trim(),
      windows_path: String(file.windows_path || '').trim(),
      content: String(file.content || '').trim(),
      backup: file.backup === undefined ? true : !!file.backup,
    }))
    .filter((file) => file.unix_path || file.windows_path || file.content);

const normalizeGeneratedTool = (tool = {}) => {
  const configFiles =
    tool.config_files ||
    tool.configFiles ||
    tool.files ||
    tool.templates ||
    tool.config_templates ||
    [];
  return {
    name: String(tool.name || '').trim(),
    slug:
      String(tool.slug || '').trim() ||
      createSlugFromToolValues({
        package_name: tool.package_name || tool.packageName,
        name: tool.name,
      }),
    description: String(tool.description || '').trim(),
    package_name: String(tool.package_name || tool.packageName || '').trim(),
    verify_command: String(tool.verify_command || tool.verifyCommand || '').trim(),
    shell_script: String(tool.shell_script || tool.shellScript || '').trim(),
    powershell_script: String(
      tool.powershell_script ||
        tool.powerShellScript ||
        tool.powershellScript ||
        '',
    ).trim(),
    config_files: normalizeAiConfigFileGroups(configFiles),
    enabled: tool.enabled === undefined ? true : !!tool.enabled,
  };
};

const getSuggestionConfigGroups = (suggestion) =>
  suggestion?.config_files?.length ? normalizeConfigFileGroups(suggestion.config_files) : [];

export default function ToolInstallSetting() {
  const { t } = useTranslation();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalActiveKey, setModalActiveKey] = useState('form');
  const [editingTool, setEditingTool] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [imageModelSettings, setImageModelSettings] = useState([]);
  const [toolAiModel, setToolAiModel] = useState('');
  const [generatingTool, setGeneratingTool] = useState(false);
  const [configFiles, setConfigFiles] = useState([]);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [fieldSources, setFieldSources] = useState({});
  const [userDraftValues, setUserDraftValues] = useState({});
  const formApiRef = useRef(null);

  const textModelOptions = useMemo(() => {
    const imageModelMap = buildImageModelSettingsMap(imageModelSettings);
    return modelOptions.filter((option) => {
      const setting = imageModelMap[option.value];
      return (
        !setting ||
        ((setting.modes || []).length === 0 &&
          (setting.video_modes || []).length === 0)
      );
    });
  }, [imageModelSettings, modelOptions]);

  const loadTools = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tool-install/admin/tools');
      if (res.data.success) {
        setTools(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingTool(null);
    setModalActiveKey('form');
    setConfigFiles([{ ...emptyConfigFile }]);
    setAiSuggestion(null);
    setFieldSources({});
    setUserDraftValues({});
    setModalVisible(true);
  };

  const openEdit = (tool) => {
    setEditingTool(tool);
    setModalActiveKey('form');
    const configGroups = normalizeConfigFileGroups(tool.config_files);
    const defaultGroups = getDefaultConfigFileGroups(tool);
    setConfigFiles(
      configGroups.length
        ? configGroups
        : defaultGroups.length
          ? defaultGroups
          : [{ ...emptyConfigFile }],
    );
    setAiSuggestion(null);
    setFieldSources({});
    setUserDraftValues({});
    setModalVisible(true);
  };

  const saveTool = async (values) => {
    setSaving(true);
    try {
      const payload = {
        ...emptyTool,
        ...(editingTool || {}),
        ...values,
        enabled: true,
        config_files: expandConfigFileGroups(configFiles),
      };
      payload.slug = String(payload.slug || '').trim() || createSlugFromToolValues(payload);
      const res = editingTool
        ? await API.put(
            `/api/tool-install/admin/tools/${editingTool.id}`,
            payload,
          )
        : await API.post('/api/tool-install/admin/tools', payload);
      if (res.data.success) {
        showSuccess(t('保存成功'));
        setModalVisible(false);
        await loadTools();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const deleteTool = (tool) => {
    Modal.confirm({
      title: t('确认删除'),
      content: `${t('确定要删除工具')}：${tool.name}？`,
      onOk: async () => {
        const res = await API.delete(`/api/tool-install/admin/tools/${tool.id}`);
        if (res.data.success) {
          showSuccess(t('删除成功'));
          await loadTools();
        } else {
          showError(res.data.message);
        }
      },
    });
  };

  const loadModelOptions = async () => {
    try {
      const [res, settings] = await Promise.all([
        API.get(USER_MODELS_ENDPOINT),
        loadImageModelSettingsOption(),
      ]);
      const { success, data, message } = res.data || {};
      if (!success) {
        showError(t(message || '加载模型失败'));
        return;
      }
      const { modelOptions: nextOptions, selectedModel } = processModelsData(
        Array.isArray(data) ? data : [],
        toolAiModel,
      );
      setModelOptions(nextOptions);
      setImageModelSettings(settings);
      setToolAiModel((current) => current || selectedModel || '');
    } catch {
      showError(t('加载模型失败'));
    }
  };

  useEffect(() => {
    loadTools();
    loadModelOptions();
  }, []);

  useEffect(() => {
    if (
      toolAiModel &&
      textModelOptions.some((option) => option.value === toolAiModel)
    ) {
      return;
    }
    setToolAiModel(textModelOptions[0]?.value || '');
  }, [textModelOptions, toolAiModel]);

  const aiConfigGroups = useMemo(
    () => getSuggestionConfigGroups(aiSuggestion),
    [aiSuggestion],
  );

  const columns = [
    {
      title: t('名称'),
      dataIndex: 'name',
    },
    {
      title: t('标识'),
      dataIndex: 'slug',
      render: (text) => <Tag>{text}</Tag>,
    },
    {
      title: t('安装包'),
      dataIndex: 'package_name',
      render: (text) => text || '-',
    },
    {
      title: t('配置模板'),
      dataIndex: 'config_files',
      render: (files) => {
        const count = normalizeConfigFileGroups(files).length;
        return count ? <Tag color='blue'>{count}</Tag> : '-';
      },
    },
    {
      title: t('操作'),
      render: (_, record) => (
        <Space>
          <Button size='small' onClick={() => openEdit(record)}>
            {t('编辑')}
          </Button>
          <Button
            size='small'
            type='danger'
            theme='borderless'
            onClick={() => deleteTool(record)}
          >
            {t('删除')}
          </Button>
        </Space>
      ),
    },
  ];

  const placeholderDescriptions = [
    {
      name: '{{API_KEY}}',
      description: t('用户选择的 API 令牌对应的真实 API Key。'),
    },
    {
      name: '{{CONFIG_URL}}',
      description: t('安装脚本用于换取用户 API Key 和配置的接口地址。'),
    },
    {
      name: '{{INSTALL_KEY}}',
      description: t('用户生成的短期安装密钥，用于防止脚本被滥用。'),
    },
    {
      name: '{{BASE_URL}}',
      description: t('当前 New API 服务地址。'),
    },
    {
      name: '{{OPENAI_BASE_URL}}',
      description: t('兼容 OpenAI 协议的 API 基础地址。'),
    },
    {
      name: '{{TOOL_NAME}}',
      description: t('当前工具名称。'),
    },
    {
      name: '{{PACKAGE_NAME}}',
      description: t('工具安装包名称。'),
    },
    {
      name: '{{VERIFY_COMMAND}}',
      description: t('安装完成后的验证命令。'),
    },
  ];

  const aiScriptPrompt = `你是一名熟悉 CLI 工具配置文件和一键安装流程的工程师。我要把某个工具添加到 New API 的“工具安装设置”里。

如果我没有在同一条消息里明确说明要添加什么工具，请先反问我需要添加的工具名称、安装方式、配置目标，不要直接生成内容。

当工具信息足够明确时，请只输出一个严格 JSON 对象，不要 Markdown，不要解释，不要代码块。JSON 结构如下：

{
  "name": "工具展示名称，例如 Claude Code",
  "description": "一句中文，说明工具用途",
  "package_name": "npm 安装包名，若不是 npm 工具则填空字符串",
  "verify_command": "安装完成后的验证命令，例如 claude --version",
  "config_files": [
    {
      "index": 0,
      "unix_path": "~/.example/config.json",
      "windows_path": "$env:USERPROFILE\\\\.example\\\\config.json",
      "content": "配置文件完整内容，使用占位符填入 API Key 和地址",
      "backup": true
    }
  ]
}

配置文件路径和内容可用占位符：
- {{API_KEY}}：用户选择的 API 令牌对应的真实 API Key。
- {{CONFIG_URL}}：安装脚本用于换取用户 API Key 和配置的接口地址。
- {{INSTALL_KEY}}：用户生成的短期安装密钥，用于防止脚本被滥用。
- {{BASE_URL}}：当前 New API 服务地址。
- {{OPENAI_BASE_URL}}：兼容 OpenAI 协议的 API 基础地址。
- {{TOOL_NAME}}：当前工具名称。
- {{PACKAGE_NAME}}：工具安装包名称。
- {{VERIFY_COMMAND}}：安装完成后的验证命令。

配置要求：
- 不要输出 shell_script 或 powershell_script，平台会自动生成安装脚本。
- 如果我提供了现有配置文件内容，请保留原结构，只把真实 API Key、token、base url、服务地址等替换成 {{API_KEY}}、{{BASE_URL}}、{{OPENAI_BASE_URL}} 等占位符。
- 如果我没有提供配置文件内容，不要凭空生成完整配置文件内容，content 返回空字符串。
- unix_path / windows_path 请根据工具官方约定推荐 macOS/Linux 和 Windows 保存路径。
- 配置 OpenAI-compatible 工具时优先使用 {{OPENAI_BASE_URL}}。
- 配置 Claude/Anthropic-compatible 工具时通常使用 {{BASE_URL}} 和 {{API_KEY}}。`;

  const copyAiScriptPrompt = async () => {
    if (await copy(aiScriptPrompt)) {
      showSuccess(t('已复制到剪贴板！'));
    }
  };

  const saveAiSuggestion = (data) => {
    const parsedTool = normalizeGeneratedTool(data);
    const hasUsefulValue = [
      parsedTool.name,
      parsedTool.slug,
      parsedTool.description,
      parsedTool.package_name,
      parsedTool.verify_command,
      parsedTool.shell_script,
      parsedTool.powershell_script,
      ...(parsedTool.config_files || []).map((file) => file.path || file.content),
    ].some(Boolean);

    if (!hasUsefulValue) {
      showError(t('未解析到可用的工具配置'));
      return false;
    }

    setAiSuggestion(parsedTool);
    showSuccess(t('AI 建议已生成，可在字段旁切换查看'));
    return true;
  };

  const buildToolGenerationPrompt = (values) => {
    const currentConfigFiles = configFiles.map((file, index) => ({
      index,
      unix_path: file.unix_path || '',
      windows_path: file.windows_path || '',
      content: file.content || '',
      backup: file.backup !== false,
    }));
    const fields = [
      ['name', values.name],
      ['slug', values.slug],
      ['package_name', values.package_name],
      ['verify_command', values.verify_command],
      ['description', values.description],
    ].filter(([, value]) => String(value || '').trim());

    const knownFields = fields
      .map(([key, value]) => `- ${key}: ${String(value).trim()}`)
      .join('\n');

    return `请根据以下已填写字段和现有配置文件模板，生成 New API 工具安装设置的 AI 建议 JSON。只返回严格 JSON 对象，不要 Markdown，不要解释。

已填写字段：
${knownFields}

现有配置文件模板（按 index 顺序返回建议；content 为空时不要凭空生成完整配置内容）：
${JSON.stringify(currentConfigFiles, null, 2)}

必须返回的 JSON 字段：
{
  "name": "",
  "description": "",
  "package_name": "",
  "verify_command": "",
  "config_files": [
    {
      "index": 0,
      "unix_path": "",
      "windows_path": "",
      "content": "",
      "backup": true
    }
  ]
}

如果存在多个配置文件模板，请为每一个 index 都返回一条记录。例如第二个模板必须返回 index 为 1 的记录。

配置规则：
- 不要返回 shell_script 或 powershell_script，平台会统一生成安装脚本。
- name、package_name、verify_command 可以根据工具信息补全。
- description 必须是一句中文，简短说明工具用途。
- config_files 必须使用和现有配置文件模板相同的结构：index、unix_path、windows_path、content、backup。
- config_files 必须覆盖现有配置文件模板里的每一个 index。
- 每个 index 返回一条记录，index 必须等于现有配置文件模板里的 index。
- unix_path / windows_path 请分别给出该 index 对应配置文件的 macOS/Linux 和 Windows 推荐保存路径。
- 如果现有 content 不为空，请只把其中真实 API Key、token、base url、服务地址、模型网关地址等替换为 {{API_KEY}}、{{BASE_URL}}、{{OPENAI_BASE_URL}} 等占位符，不要重写整体结构。
- 如果现有 content 为空，不要凭空生成完整配置内容，content 返回空字符串。
- unix_path、windows_path 和 content 可以使用 {{API_KEY}}、{{BASE_URL}}、{{OPENAI_BASE_URL}}、{{TOOL_NAME}}、{{PACKAGE_NAME}}、{{VERIFY_COMMAND}}。`;
  };

  const generateToolWithAi = async () => {
    const values = { ...emptyTool, ...(formApiRef.current?.getValues() || {}) };
    const hasSeed = [
      values.name,
      values.slug,
      values.package_name,
      values.verify_command,
      values.description,
      ...configFiles.flatMap((file) => [
        file.unix_path,
        file.windows_path,
        file.content,
      ]),
    ].some((item) => String(item || '').trim());
    if (!hasSeed) return showError(t('请先填写任意一个工具信息'));
    if (!toolAiModel) return showError(t('请选择生成模型'));

    setGeneratingTool(true);
    try {
      const res = await API.post(
        CHAT_COMPLETIONS_ENDPOINT,
        {
          model: toolAiModel,
          stream: false,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '你是 CLI 工具配置文件工程师。输出必须是严格 JSON，不要 Markdown，不要解释。',
            },
            { role: 'user', content: buildToolGenerationPrompt(values) },
          ],
        },
        { skipErrorHandler: true },
      );
      const content = res.data?.choices?.[0]?.message?.content || '';
      const parsed = extractJsonObject(content);
      if (!parsed) {
        throw new Error(t('模型未返回可解析的 JSON'));
      }
      saveAiSuggestion(parsed);
    } catch (error) {
      showError(
        error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          error?.message ||
          t('AI 生成失败'),
      );
    } finally {
      setGeneratingTool(false);
    }
  };

  const updateConfigFile = (index, patch) => {
    setConfigFiles((current) =>
      current.map((file, fileIndex) =>
        fileIndex === index ? { ...file, ...patch } : file,
      ),
    );
  };

  const addConfigFile = () => {
    setConfigFiles((current) => [...current, { ...emptyConfigFile }]);
  };

  const removeConfigFile = (index) => {
    setConfigFiles((current) =>
      current.length <= 1
        ? [{ ...emptyConfigFile }]
        : current.filter((_, fileIndex) => fileIndex !== index),
    );
  };

  const getBasicAiValue = (field) => {
    if (!aiSuggestion) return '';
    return String(aiSuggestion[field] || '');
  };

  const getConfigAiValue = (index, field) => {
    const group = aiConfigGroups[index];
    if (!group) return '';
    return String(group[field] || '');
  };

  const toggleBasicFieldSource = (field) => {
    const key = getFieldSourceKey(field);
    const currentSource = fieldSources[key] || 'user';
    if (currentSource === 'ai') {
      const fallback = userDraftValues[key] ?? '';
      formApiRef.current?.setValue(field, fallback);
      setFieldSources((current) => ({ ...current, [key]: 'user' }));
      return;
    }
    const currentValue = formApiRef.current?.getValues()?.[field] || '';
    const aiValue = getBasicAiValue(field);
    setUserDraftValues((current) => ({ ...current, [key]: currentValue }));
    formApiRef.current?.setValue(field, aiValue);
    setFieldSources((current) => ({ ...current, [key]: 'ai' }));
  };

  const toggleConfigFieldSource = (index, field) => {
    const key = getConfigSourceKey(index, field);
    const currentSource = fieldSources[key] || 'user';
    if (currentSource === 'ai') {
      updateConfigFile(index, { [field]: userDraftValues[key] ?? '' });
      setFieldSources((current) => ({ ...current, [key]: 'user' }));
      return;
    }
    const currentValue = configFiles[index]?.[field] || '';
    const aiValue = getConfigAiValue(index, field);
    setUserDraftValues((current) => ({ ...current, [key]: currentValue }));
    updateConfigFile(index, { [field]: aiValue });
    setFieldSources((current) => ({ ...current, [key]: 'ai' }));
  };

  const renderAiToggleButton = (sourceKey, hasSuggestion, onClick) => {
    if (!hasSuggestion) return null;
    const isAi = fieldSources[sourceKey] === 'ai';
    return (
      <Button
        className='tool-install-ai-toggle'
        size='small'
        theme='solid'
        type={isAi ? 'warning' : 'primary'}
        onClick={onClick}
      >
        {isAi ? 'AI' : t('我的')}
      </Button>
    );
  };

  const renderAiFieldLabel = (label, sourceKey, hasSuggestion, onClick) => (
    <div className='tool-install-ai-field-label'>
      <Typography.Text strong>{label}</Typography.Text>
      {renderAiToggleButton(sourceKey, hasSuggestion, onClick)}
    </div>
  );

  return (
    <>
      <CardPro
        type='type1'
        className='tool-install-setting-card'
        descriptionArea={
          <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
            <div>
              <Typography.Title heading={5} style={{ marginBottom: 4 }}>
                {t('工具安装配置管理')}
              </Typography.Title>
              <Typography.Text type='secondary'>
                {t('手动维护用户工具页展示的工具信息和配置文件模板。')}
              </Typography.Text>
            </div>
            <Button type='primary' onClick={openCreate}>
              {t('新增工具')}
            </Button>
          </div>
        }
        t={t}
      >
        <div className='tool-install-setting-content'>
          <div className='tool-install-setting-table'>
            <Table
              columns={columns}
              dataSource={tools}
              rowKey='id'
              loading={loading}
              pagination={false}
            />
          </div>
        </div>
      </CardPro>

      <Modal
        className='tool-install-modal'
        header={null}
        visible={modalVisible}
        centered
        closable={false}
        onCancel={() => setModalVisible(false)}
        onOk={() => formApiRef.current?.submitForm()}
        confirmLoading={saving}
        footer={
          modalActiveKey === 'params' ? (
            <Button onClick={() => setModalVisible(false)}>{t('关闭')}</Button>
          ) : (
            <div className='tool-install-modal-footer'>
              <div className='tool-install-footer-ai'>
                <Select
                  className='tool-install-footer-model-select'
                  disabled={generatingTool}
                  filter
                  onChange={setToolAiModel}
                  optionList={textModelOptions}
                  placeholder={t('请选择模型')}
                  position='top'
                  value={toolAiModel}
                />
                <Button
                  loading={generatingTool}
                  onClick={generateToolWithAi}
                  type='primary'
                >
                  {t('AI 生成')}
                </Button>
              </div>
              <div className='tool-install-footer-actions'>
                <Button onClick={() => setModalVisible(false)}>
                  {t('取消')}
                </Button>
                <Button
                  type='primary'
                  loading={saving}
                  onClick={() => formApiRef.current?.submitForm()}
                >
                  {t('保存')}
                </Button>
              </div>
            </div>
          )
        }
        width={1080}
        height={656}
      >
        <Tabs
          activeKey={modalActiveKey}
          onChange={setModalActiveKey}
          type='line'
          tabBarExtraContent={
            <Button
              className='tool-install-modal-close'
              theme='borderless'
              type='tertiary'
              icon={<IconClose />}
              onClick={() => setModalVisible(false)}
              aria-label={t('关闭')}
            />
          }
        >
          <TabPane itemKey='form' tab={editingTool ? t('编辑工具') : t('新增工具')}>
            <Form
              initValues={editingTool || emptyTool}
              getFormApi={(api) => (formApiRef.current = api)}
              onSubmit={saveTool}
            >
              <div className='tool-install-form-grid'>
                <div className='tool-install-basic-row'>
                  <div className='tool-install-ai-field tool-install-ai-field-basic'>
                    {renderAiFieldLabel(
                      t('名称'),
                      getFieldSourceKey('name'),
                      !!getBasicAiValue('name'),
                      () => toggleBasicFieldSource('name'),
                    )}
                    <Form.Input
                      field='name'
                      noLabel
                      placeholder={t('例如 Claude Code')}
                      required
                      rules={[{ required: true, message: t('请输入名称') }]}
                    />
                  </div>
                  <div className='tool-install-ai-field tool-install-ai-field-basic'>
                    {renderAiFieldLabel(
                      t('安装包'),
                      getFieldSourceKey('package_name'),
                      !!getBasicAiValue('package_name'),
                      () => toggleBasicFieldSource('package_name'),
                    )}
                    <Form.Input
                      field='package_name'
                      noLabel
                      placeholder='@anthropic-ai/claude-code'
                    />
                  </div>
                  <div className='tool-install-ai-field tool-install-ai-field-basic'>
                    {renderAiFieldLabel(
                      t('验证命令'),
                      getFieldSourceKey('verify_command'),
                      !!getBasicAiValue('verify_command'),
                      () => toggleBasicFieldSource('verify_command'),
                    )}
                    <Form.Input
                      field='verify_command'
                      noLabel
                      placeholder='claude --version'
                    />
                  </div>
                  <div className='tool-install-ai-field tool-install-ai-field-basic'>
                    {renderAiFieldLabel(
                      t('说明'),
                      getFieldSourceKey('description'),
                      !!getBasicAiValue('description'),
                      () => toggleBasicFieldSource('description'),
                    )}
                    <Form.Input
                      field='description'
                      noLabel
                      placeholder={t('工具说明')}
                    />
                  </div>
                </div>
                <div className='tool-install-config-files'>
                  <div className='tool-install-config-files-header'>
                    <div>
                      <Typography.Text strong>
                        {t('配置文件模板')}
                      </Typography.Text>
                      <Typography.Text type='secondary' size='small'>
                        {t('安装脚本会自动替换占位符、备份旧文件并写入这些配置。')}
                      </Typography.Text>
                    </div>
                    <Button size='small' onClick={addConfigFile}>
                      {t('添加配置文件')}
                    </Button>
                  </div>
                  <div className='tool-install-config-files-list'>
                    {configFiles.map((file, index) => (
                      <div className='tool-install-config-file-card' key={index}>
                        <div className='tool-install-config-file-toolbar'>
                          <div className='tool-install-config-paths'>
                            <div className='tool-install-ai-field tool-install-ai-field-path'>
                              <Input
                                value={file.unix_path}
                                onChange={(value) =>
                                  updateConfigFile(index, { unix_path: value })
                                }
                                placeholder={t('macOS / Linux 保存路径')}
                              />
                              {renderAiToggleButton(
                                getConfigSourceKey(index, 'unix_path'),
                                !!getConfigAiValue(index, 'unix_path'),
                                () =>
                                  toggleConfigFieldSource(index, 'unix_path'),
                              )}
                            </div>
                            <div className='tool-install-ai-field tool-install-ai-field-path'>
                              <Input
                                value={file.windows_path}
                                onChange={(value) =>
                                  updateConfigFile(index, {
                                    windows_path: value,
                                  })
                                }
                                placeholder={t('Windows 保存路径')}
                              />
                              {renderAiToggleButton(
                                getConfigSourceKey(index, 'windows_path'),
                                !!getConfigAiValue(index, 'windows_path'),
                                () =>
                                  toggleConfigFieldSource(index, 'windows_path'),
                              )}
                            </div>
                          </div>
                          <Space>
                            <Switch
                              checked={file.backup}
                              onChange={(checked) =>
                                updateConfigFile(index, { backup: checked })
                              }
                            />
                            <Typography.Text size='small'>
                              {t('备份')}
                            </Typography.Text>
                          </Space>
                          <Button
                            size='small'
                            type='danger'
                            theme='borderless'
                            onClick={() => removeConfigFile(index)}
                          >
                            {t('删除')}
                          </Button>
                        </div>
                        <div className='tool-install-ai-field tool-install-ai-field-content'>
                          <TextArea
                            className='tool-install-config-content'
                            value={file.content}
                            onChange={(value) =>
                              updateConfigFile(index, { content: value })
                            }
                            placeholder={t('填写要写入目标路径的完整配置文件内容')}
                          />
                          {renderAiToggleButton(
                            getConfigSourceKey(index, 'content'),
                            !!getConfigAiValue(index, 'content'),
                            () => toggleConfigFieldSource(index, 'content'),
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Form>
          </TabPane>

          <TabPane itemKey='params' tab={t('参数说明')}>
            <div className='tool-install-params-layout'>
              <div className='tool-install-params-panel'>
                  <Typography.Title heading={6} style={{ marginBottom: 8 }}>
                  {t('参数说明')}
                </Typography.Title>
                <Table
                  columns={[
                    {
                      title: t('参数'),
                      dataIndex: 'name',
                      width: 210,
                      render: (text) => <Tag>{text}</Tag>,
                    },
                    {
                      title: t('说明'),
                      dataIndex: 'description',
                    },
                  ]}
                  dataSource={placeholderDescriptions}
                  rowKey='name'
                  pagination={false}
                />
              </div>

              <Divider layout='vertical' className='tool-install-params-divider' />

              <div className='tool-install-params-panel'>
                <div className='mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
                  <div>
                    <Typography.Title heading={6} style={{ marginBottom: 4 }}>
                      {t('给 AI 的配置生成说明')}
                    </Typography.Title>
                    <Typography.Text type='secondary'>
                      {t('复制后发给 AI，并补充你要添加的工具信息，即可生成结构化工具配置。')}
                    </Typography.Text>
                  </div>
                  <Button type='primary' onClick={copyAiScriptPrompt}>
                    {t('复制给 AI 的说明')}
                  </Button>
                </div>
                <pre className='tool-install-ai-prompt-preview'>
                  {aiScriptPrompt}
                </pre>
              </div>
            </div>
          </TabPane>
        </Tabs>
      </Modal>
    </>
  );
}
