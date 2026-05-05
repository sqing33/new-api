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
  Banner,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { KeyRound, Laptop, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 8,
        background: 'var(--semi-color-fill-0)',
        padding: 10,
      }}
    >
      <pre
        style={{
          flex: 1,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {command}
      </pre>
      <Button size='small' onClick={copyCommand}>
        {t('复制')}
      </Button>
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
    <Space vertical align='stretch' style={{ width: '100%' }}>
      <Descriptions
        row
        data={[
          { key: t('安装包'), value: tool.package_name || '-' },
          { key: t('Node 要求'), value: 'Node.js 18+ / npm' },
          { key: t('验证命令'), value: tool.verify_command || '-' },
        ]}
      />

      <Card
        title={
          <Space>
            <Terminal size={16} />
            {t('macOS / Linux')}
          </Space>
        }
      >
        <Text type='secondary'>
          {t('运行管理员配置的 Shell 安装脚本，并使用当前安装密钥获取配置。')}
        </Text>
        <div style={{ marginTop: 12 }}>
          <CommandBlock command={shellCommand} />
        </div>
      </Card>

      <Card
        title={
          <Space>
            <Laptop size={16} />
            {t('Windows PowerShell')}
          </Space>
        }
      >
        <Text type='secondary'>
          {t('运行管理员配置的 PowerShell 安装脚本，并写入用户级环境变量。')}
        </Text>
        <div style={{ marginTop: 12 }}>
          <CommandBlock command={psCommand} />
        </div>
      </Card>
    </Space>
  );
}

export default function Tools() {
  const { t } = useTranslation();
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
    <div className='mt-[60px] px-2'>
      <Space vertical align='stretch' style={{ width: '100%' }}>
        <div>
          <Typography.Title heading={4} style={{ marginBottom: 4 }}>
            {t('工具配置')}
          </Typography.Title>
          <Text type='secondary'>
            {t('选择令牌生成短期安装密钥，然后复制对应工具的一键安装脚本。')}
          </Text>
        </div>

        <Card>
          <Row gutter={[16, 16]} align='bottom'>
            <Col xs={24} md={16}>
              <Text strong>{t('选择 API 令牌')}</Text>
              <Select
                value={selectedTokenId}
                onChange={(value) => {
                  setSelectedTokenId(value);
                  setInstallToken('');
                  setExpiresAt(0);
                }}
                placeholder={t('选择一个已启用的令牌')}
                style={{ width: '100%', marginTop: 8 }}
                disabled={enabledTokens.length === 0}
              >
                {enabledTokens.map((token) => (
                  <Select.Option key={token.id} value={String(token.id)}>
                    {token.name} · {token.key}
                  </Select.Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} md={8}>
              <Button
                type='primary'
                icon={<KeyRound size={16} />}
                loading={generating}
                disabled={!selectedTokenId}
                onClick={generateInstallToken}
                style={{ width: '100%' }}
              >
                {t('生成安装密钥')}
              </Button>
            </Col>
          </Row>

          {enabledTokens.length === 0 && !loading && (
            <Banner
              type='warning'
              description={t('暂无可用的已启用令牌，请先创建或启用令牌。')}
              style={{ marginTop: 16 }}
            />
          )}

          {installToken && (
            <div style={{ marginTop: 16 }}>
              <Tag color='green'>{t('已就绪')}</Tag>
              <Text type='secondary' style={{ marginLeft: 8 }}>
                {t('过期时间')}：
                {new Date(expiresAt * 1000).toLocaleString()}
              </Text>
            </div>
          )}
        </Card>

        <Spin spinning={loading}>
          {tools.length === 0 ? (
            <Empty description={t('暂无工具配置')} />
          ) : (
            <Tabs type='card'>
              {tools.map((tool) => (
                <Tabs.TabPane tab={tool.name} itemKey={tool.slug} key={tool.id}>
                  <Card>
                    <Typography.Title heading={5}>{tool.name}</Typography.Title>
                    {tool.description && (
                      <Text type='secondary'>{tool.description}</Text>
                    )}
                    <div style={{ marginTop: 16 }}>
                      {installToken ? (
                        <ToolPanel
                          tool={tool}
                          installToken={installToken}
                          baseURL={baseURL}
                        />
                      ) : (
                        <Banner
                          type='info'
                          description={t('生成安装密钥后即可查看可复制脚本。')}
                        />
                      )}
                    </div>
                  </Card>
                </Tabs.TabPane>
              ))}
            </Tabs>
          )}
        </Spin>
      </Space>
    </div>
  );
}
