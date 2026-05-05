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
  Empty,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  CheckCircle2,
  Clipboard,
  Clock3,
  KeyRound,
  Laptop,
  PackageCheck,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  API,
  copy,
  showError,
  showSuccess,
} from '../../helpers';
import { getServerAddress } from '../../helpers/token';

const { Text } = Typography;

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
          value='Node.js 18+ / npm'
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
  const baseURL = getServerAddress().replace(/\/$/, '');

  const enabledTokens = useMemo(
    () => tokens.filter((token) => token.status === 1),
    [tokens],
  );

  const selectedToken = useMemo(
    () => enabledTokens.find((token) => String(token.id) === selectedTokenId),
    [enabledTokens, selectedTokenId],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [toolsRes, tokenRes] = await Promise.all([
        API.get('/api/tool-install/tools'),
        API.get('/api/token/?p=1&size=100'),
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
        setInstallToken(res.data.data.token);
        setExpiresAt(res.data.data.expires_at);
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

  return (
    <div className='h-full min-h-0'>
      <div className='mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='min-w-0'>
          <h2 className='mb-1 text-2xl font-semibold text-gray-800'>
            {t('工具配置')}
          </h2>
          <div className='text-sm text-gray-500'>
            {t('选择令牌生成短期安装密钥，然后复制对应工具的一键安装脚本。')}
          </div>
        </div>
        <Space>
          {installToken && (
            <Tag color='green' size='large' prefixIcon={<Clock3 size={14} />}>
              {t('过期时间')}：{new Date(expiresAt * 1000).toLocaleString()}
            </Tag>
          )}
          <Button
            type='tertiary'
            icon={<RefreshCw size={16} />}
            loading={loading}
            onClick={loadData}
            className='tools-refresh-button'
            aria-label={t('刷新')}
          />
        </Space>
      </div>

      <Card className='table-scroll-card !rounded-2xl border-0' bordered={false}>
        <div className='space-y-5'>
          <div className='grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_220px]'>
            <div className='min-w-0'>
              <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800'>
                <KeyRound size={16} />
                <span>{t('选择 API 令牌')}</span>
              </div>
              <Select
                value={selectedTokenId}
                onChange={(value) => {
                  setSelectedTokenId(value);
                  setInstallToken('');
                  setExpiresAt(0);
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
                {t('生成安装密钥')}
              </Button>
            </div>
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

          {installToken && selectedToken && (
            <div className='tools-success-panel flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
              <div className='flex items-center gap-2 text-sm font-medium text-green-700'>
                <CheckCircle2 size={16} />
                <span>{t('已就绪')}</span>
                <span className='text-green-700/70'>· {selectedToken.name}</span>
              </div>
              <Text type='secondary'>
                {t('过期时间')}：{new Date(expiresAt * 1000).toLocaleString()}
              </Text>
            </div>
          )}

          <Spin spinning={loading}>
            {tools.length === 0 ? (
              <div className='tools-empty-panel py-10'>
                <Empty description={t('暂无工具配置')} />
              </div>
            ) : (
              <Tabs type='card' className='tools-workbench-tabs'>
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
            )}
          </Spin>
        </div>
      </Card>
    </div>
  );
}
