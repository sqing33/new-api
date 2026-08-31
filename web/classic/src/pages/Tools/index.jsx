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
import {
  Button,
  Card,
  Input,
  Radio,
  RadioGroup,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Apple,
  CheckCircle2,
  Clipboard,

  ExternalLink,
  KeyRound,
  Laptop,
  Monitor,
  PackageCheck,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  API,
  copy,
  selectFilter,
  showError,
  showSuccess,
} from '../../helpers';
import { fetchTokenKey, getServerAddress } from '../../helpers/token';
import {
  APP_CONFIGS,
  buildCCSwitchURL,
} from '../../components/table/tokens/modals/CCSwitchModal';

const { Text } = Typography;

const INSTALL_STATE_KEY = 'tools_install_state';

function saveInstallState(installToken, expiresAt, selectedTokenId) {
  try {
    localStorage.setItem(INSTALL_STATE_KEY, JSON.stringify({ installToken, expiresAt, selectedTokenId }));
  } catch {}
}

function loadInstallState() {
  try {
    const raw = localStorage.getItem(INSTALL_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearInstallState() {
  try {
    localStorage.removeItem(INSTALL_STATE_KEY);
  } catch {}
}

function buildScriptUrl(baseURL, tool, platform, token) {
  return `${baseURL}/api/tool-install/scripts/${tool}/${platform}?token=${encodeURIComponent(token)}`;
}

function CommandBlock({ command }) {
  const { t } = useTranslation();
  const copyCommand = async () => {
    if (await copy(command)) {
      showSuccess(t('已复制到剪贴板！'));
    }
  };

  return (
    <div className='tools-command-block'>
      <pre
        className='m-0 min-h-[72px] whitespace-pre-wrap break-all py-4 pl-4 pr-24 font-mono text-[13px] leading-6 text-slate-100'
      >
        {command}
      </pre>
      <Button
        size='small'
        type='tertiary'
        icon={<Clipboard size={14} />}
        onClick={copyCommand}
        className='tools-command-copy'
      >
        {t('复制')}
      </Button>
    </div>
  );
}

function InfoItem({ icon, label, value }) {
  return (
    <div className='tools-info-item'>
      <div className='mb-1 flex items-center gap-2 text-xs text-gray-500'>
        {icon}
        <span>{label}</span>
      </div>
      <div className='truncate text-sm font-medium text-gray-800'>
        {value || '-'}
      </div>
    </div>
  );
}

function ScriptSection({ icon, title, description, command }) {
  return (
    <div className='tools-script-section'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2 text-sm font-semibold text-gray-900'>
            {icon}
            <span>{title}</span>
          </div>
          <Text type='secondary' size='small'>
            {description}
          </Text>
        </div>
      </div>
      <CommandBlock command={command} />
    </div>
  );
}

function CCSwitchPanel({ selectedTokenId, modelOptions }) {
  const { t } = useTranslation();
  const defaultNames = { claude: '清荫 Claude', codex: '清荫 Codex', gemini: '清荫 Gemini' };
  const [app, setApp] = useState('claude');
  const [name, setName] = useState(defaultNames.claude);
  const [models, setModels] = useState({});
  const [importing, setImporting] = useState(false);

  const currentConfig = APP_CONFIGS[app];

  const handleAppChange = (val) => {
    setApp(val);
    setName(defaultNames[val]);
    setModels({});
  };

  const handleImport = async () => {
    if (!selectedTokenId) {
      showError(t('请先选择一个令牌'));
      return;
    }
    if (!models.model) {
      showError(t('请选择主模型'));
      return;
    }
    setImporting(true);
    try {
      const fullKey = await fetchTokenKey(Number(selectedTokenId));
      const url = buildCCSwitchURL(app, name, models, 'sk-' + fullKey);
      window.open(url, '_blank');
    } catch (error) {
      showError(error.message || t('获取令牌密钥失败'));
    } finally {
      setImporting(false);
    }
  };

  const macCommand = `brew tap farion1231/ccswitch && brew install --cask cc-switch || { VERSION=$(curl -s https://api.github.com/repos/farion1231/cc-switch/releases/latest | grep '"tag_name"' | sed 's/.*"v\\(.*\\)".*/\\1/') && curl -fsSL "https://github.com/farion1231/cc-switch/releases/download/v\${VERSION}/CC-Switch-v\${VERSION}-macOS.dmg" -o /tmp/cc-switch.dmg && open /tmp/cc-switch.dmg; }`;
  const linuxCommand = `VERSION=$(curl -s https://api.github.com/repos/farion1231/cc-switch/releases/latest | grep '"tag_name"' | sed 's/.*"v\\(.*\\)".*/\\1/') && curl -fsSL "https://github.com/farion1231/cc-switch/releases/download/v\${VERSION}/CC-Switch-v\${VERSION}-Linux-x86_64.deb" -o /tmp/cc-switch.deb && sudo dpkg -i /tmp/cc-switch.deb`;
  const winCommand = `$v=(Invoke-RestMethod "https://api.github.com/repos/farion1231/cc-switch/releases/latest").tag_name -replace '^v',''; Invoke-WebRequest -Uri "https://github.com/farion1231/cc-switch/releases/download/v$v/CC-Switch-v$v-Windows.msi" -OutFile "$env:TEMP\\cc-switch.msi"; Start-Process msiexec.exe -ArgumentList "/i \`"$env:TEMP\\cc-switch.msi\`" /quiet" -Wait`;

  return (
    <div className='grid grid-cols-1 gap-6 xl:grid-cols-2' style={{ minHeight: 0 }}>
      {/* Left: Install commands (scrollable) */}
      <div className='space-y-4 overflow-y-auto pr-2' style={{ maxHeight: 'calc(100vh - 380px)', scrollbarWidth: 'none' }}>
        <ScriptSection
          icon={<Apple size={16} />}
          title='macOS (Homebrew)'
          description={t('优先通过 Homebrew 安装，若失败则自动从 GitHub 下载 .dmg 安装包。')}
          command={macCommand}
        />
        <ScriptSection
          icon={<Monitor size={16} />}
          title='Linux (Debian / Ubuntu)'
          description={t('下载最新版 .deb 包并安装。')}
          command={linuxCommand}
        />
        <ScriptSection
          icon={<Laptop size={16} />}
          title='Windows (PowerShell)'
          description={t('下载最新版 .msi 安装包并静默安装。')}
          command={winCommand}
        />
      </div>

      {/* Right: Import configuration panel */}
      <div className='flex justify-center'>
      <div className='tools-ccswitch-import' style={{ maxWidth: 360, width: '100%' }}>
        <div className='mb-4'>
          <div className='flex items-center gap-2 text-sm font-semibold text-gray-900'>
            <ExternalLink size={16} />
            <span>{t('导入配置到 CC Switch')}</span>
          </div>
          <Text type='secondary' size='small'>
            {t('选择应用和模型，一键导入 API 配置到 CC Switch。')}
          </Text>
        </div>

        <div className='space-y-4'>
          <div>
            <div className='mb-2 text-sm text-gray-600'>{t('应用')}</div>
            <RadioGroup
              type='button'
              value={app}
              onChange={(e) => handleAppChange(e.target.value)}
            >
              {Object.entries(APP_CONFIGS).map(([key, cfg]) => (
                <Radio key={key} value={key}>
                  {cfg.label}
                </Radio>
              ))}
            </RadioGroup>
          </div>

          <div>
            <div className='mb-2 text-sm text-gray-600'>{t('名称')}</div>
            <Input
              value={name}
              onChange={setName}
              placeholder={currentConfig.defaultName}
            />
          </div>

          {currentConfig.modelFields.map((field) => (
            <div key={field.key}>
              <div className='mb-2 text-sm text-gray-600'>
                {t(field.label)}
                {field.key === 'model' && (
                  <span className='ml-1 text-red-500'>*</span>
                )}
              </div>
              <Select
                placeholder={t('请选择模型')}
                optionList={modelOptions}
                value={models[field.key] || undefined}
                onChange={(val) =>
                  setModels((prev) => ({ ...prev, [field.key]: val }))
                }
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                emptyContent={t('暂无数据')}
              />
            </div>
          ))}

          <Button
            type='primary'
            theme='solid'
            icon={<ExternalLink size={16} />}
            loading={importing}
            disabled={!selectedTokenId}
            onClick={handleImport}
            className='w-full !rounded-xl'
          >
            {t('打开 CC Switch')}
          </Button>
          {!selectedTokenId && (
            <Text type='tertiary' size='small'>
              {t('请先在上方选择一个 API 令牌。')}
            </Text>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function ToolPanel({ tool, installToken, baseURL }) {
  const { t } = useTranslation();
  const shellURL = buildScriptUrl(baseURL, tool.slug, 'sh', installToken);
  const psURL = buildScriptUrl(baseURL, tool.slug, 'ps1', installToken);
  const shellCommand = `curl -fsSL "${shellURL}" | sh`;
  const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing '${psURL}' | iex"`;

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
        <InfoItem
          icon={<PackageCheck size={14} />}
          label={t('安装包')}
          value={tool.package_name || '-'}
        />
        <InfoItem
          icon={<Terminal size={14} />}
          label={t('Node 要求')}
          value='Node.js 18+ / bun · pnpm · npm'
        />
        <InfoItem
          icon={<CheckCircle2 size={14} />}
          label={t('验证命令')}
          value={tool.verify_command || '-'}
        />
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <ScriptSection
          icon={<Terminal size={16} />}
          title={t('macOS / Linux')}
          description={t('运行管理员配置的 Shell 安装脚本，并使用当前安装密钥获取配置。')}
          command={shellCommand}
        />
        <ScriptSection
          icon={<Laptop size={16} />}
          title={t('Windows PowerShell')}
          description={t('运行管理员配置的 PowerShell 安装脚本，并写入用户级环境变量。')}
          command={psCommand}
        />
      </div>
    </div>
  );
}

export default function Tools() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tools, setTools] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [selectedTokenId, setSelectedTokenId] = useState('');
  const [installToken, setInstallToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [modelOptions, setModelOptions] = useState([]);
  const baseURL = getServerAddress().replace(/\/$/, '');

  const enabledTokens = useMemo(
    () => tokens.filter((token) => token.status === 1),
    [tokens],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [toolsRes, tokenRes, modelsRes] = await Promise.all([
        API.get('/api/tool-install/tools'),
        API.get('/api/token/?p=1&size=100'),
        API.get('/api/user/models'),
      ]);
      if (toolsRes.data.success) {
        setTools(toolsRes.data.data || []);
      } else {
        showError(toolsRes.data.message);
      }
      if (tokenRes.data.success) {
        setTokens(tokenRes.data.data?.items || []);
      } else {
        showError(tokenRes.data.message);
      }
      if (modelsRes.data.success) {
        setModelOptions(
          (modelsRes.data.data || []).map((m) => ({ label: m, value: m })),
        );
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const generateInstallToken = async () => {
    if (!selectedTokenId) {
      showError(t('请先选择一个已启用的令牌'));
      return;
    }
    setGenerating(true);
    try {
      const res = await API.post('/api/tool-install/token', {
        api_token_id: Number(selectedTokenId),
      });
      if (res.data.success) {
        const { token, expires_at } = res.data.data;
        setInstallToken(token);
        setExpiresAt(expires_at);
        saveInstallState(token, expires_at, selectedTokenId);
        showSuccess(t('安装密钥已生成'));
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(error);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading && tokens.length > 0) {
      const saved = loadInstallState();
      if (saved && saved.expiresAt && saved.expiresAt * 1000 > Date.now()) {
        setInstallToken(saved.installToken);
        setExpiresAt(saved.expiresAt);
        setSelectedTokenId(saved.selectedTokenId);
      } else if (saved) {
        clearInstallState();
      }
    }
  }, [loading, tokens]);

  return (
    <div className='h-full min-h-0'>
      <div className='mb-4'>
        <h2 className='mb-1 text-2xl font-semibold text-gray-800'>
          {t('清荫手册')}
        </h2>
        <div className='text-sm text-gray-500'>
          {t('选择令牌生成短期安装密钥，然后复制对应工具的一键安装脚本。')}
        </div>
      </div>

      <Card className='table-scroll-card !rounded-2xl border-0' bordered={false}>
        <div className='space-y-5'>
          <div className='grid grid-cols-1 gap-3 xl:grid-cols-[minmax(200px,360px)_180px_auto]'>
            <div className='min-w-0'>
              <div className='mb-2 flex items-center gap-2 text-sm text-gray-500'>
                <KeyRound size={14} />
                <span>{t('选择 API 令牌')}</span>
              </div>
              <Select
                value={selectedTokenId}
                onChange={(value) => {
                  setSelectedTokenId(value);
                  setInstallToken('');
                  setExpiresAt(0);
                  clearInstallState();
                }}
                placeholder={t('选择一个已启用的令牌')}
                style={{ width: '100%' }}
                disabled={enabledTokens.length === 0}
              >
                {enabledTokens.map((token) => (
                  <Select.Option key={token.id} value={String(token.id)}>
                    {token.name} · {token.key}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className='flex items-end'>
              <Button
                type='primary'
                icon={<KeyRound size={16} />}
                loading={generating}
                disabled={!selectedTokenId}
                onClick={generateInstallToken}
                className='w-full !rounded-xl'
              >
                {t('生成密钥')}
              </Button>
            </div>
            {installToken && (
              <div className='flex items-end pb-[3px]'>
                <Tag
                  color='green'
                  size='large'
                  shape='circle'
                  prefixIcon={<CheckCircle2 size={14} />}
                  className='tools-status-tag'
                >
                  {t('已就绪')} · {t('过期时间')} {new Date(expiresAt * 1000).toLocaleTimeString()}
                </Tag>
              </div>
            )}
          </div>

          {enabledTokens.length === 0 && !loading && (
            <div className='tools-warning-panel flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
              <Text type='warning'>
                {t('暂无可用的已启用令牌，请先创建或启用令牌。')}
              </Text>
              <Button
                type='warning'
                theme='light'
                onClick={() => navigate('/token')}
                className='!rounded-xl'
              >
                {t('令牌管理')}
              </Button>
            </div>
          )}

          <Spin spinning={loading}>
            <Tabs type='card' className='tools-workbench-tabs'>
              <Tabs.TabPane
                tab='CC Switch'
                itemKey='__ccswitch__'
                key='__ccswitch__'
              >
                <div className='tools-tab-panel space-y-4 p-4'>
                  <div className='flex flex-col gap-2 md:flex-row md:items-start md:justify-between'>
                    <div className='min-w-0'>
                      <h3 className='mb-1 text-lg font-semibold text-gray-900'>
                        CC Switch
                      </h3>
                      <Text type='secondary'>
                        {t('跨平台桌面应用，统一管理 Claude Code、Codex、Gemini CLI 等 AI 编程工具的配置。')}
                      </Text>
                    </div>
                  </div>
                  <CCSwitchPanel
                    selectedTokenId={selectedTokenId}
                    modelOptions={modelOptions}
                  />
                </div>
              </Tabs.TabPane>
              {tools.map((tool) => (
                <Tabs.TabPane
                  tab={tool.name}
                  itemKey={tool.slug}
                  key={tool.id}
                >
                  <div className='tools-tab-panel space-y-4 p-4'>
                    <div className='flex flex-col gap-2 md:flex-row md:items-start md:justify-between'>
                      <div className='min-w-0'>
                        <h3 className='mb-1 text-lg font-semibold text-gray-900'>
                          {tool.name}
                        </h3>
                        {tool.description && (
                          <Text type='secondary'>{tool.description}</Text>
                        )}
                      </div>
                      {installToken && <Tag color='green'>{t('已就绪')}</Tag>}
                    </div>

                    {installToken ? (
                      <ToolPanel
                        tool={tool}
                        installToken={installToken}
                        baseURL={baseURL}
                      />
                    ) : (
                      <div className='tools-info-panel p-4 text-sm text-blue-700'>
                        {t('生成安装密钥后即可查看可复制脚本。')}
                      </div>
                    )}
                  </div>
                </Tabs.TabPane>
              ))}
            </Tabs>
          </Spin>
        </div>
      </Card>
    </div>
  );
}
