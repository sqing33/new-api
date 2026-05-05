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

import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Divider,
  Form,
  Modal,
  Space,
  Table,
  TabPane,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconClose } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { API, copy, showError, showSuccess } from '../../helpers';
import CardPro from '../common/ui/CardPro';

const emptyTool = {
  slug: '',
  name: '',
  description: '',
  package_name: '',
  verify_command: '',
  shell_script: '',
  powershell_script: '',
  enabled: true,
};

export default function ToolInstallSetting() {
  const { t } = useTranslation();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalActiveKey, setModalActiveKey] = useState('form');
  const [editingTool, setEditingTool] = useState(null);
  const formApiRef = useRef(null);

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
    setModalVisible(true);
  };

  const openEdit = (tool) => {
    setEditingTool(tool);
    setModalActiveKey('form');
    setModalVisible(true);
  };

  const saveTool = async (values) => {
    setSaving(true);
    try {
      const payload = { ...emptyTool, ...values };
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

  useEffect(() => {
    loadTools();
  }, []);

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
      title: t('启用'),
      dataIndex: 'enabled',
      render: (enabled) =>
        enabled ? <Tag color='green'>{t('启用')}</Tag> : <Tag>{t('禁用')}</Tag>,
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

  const aiScriptPrompt = `你是一名熟悉 CLI 工具安装脚本的工程师。请根据我要添加的工具，生成可以直接填入 New API 工具安装设置里的 Shell 脚本和 PowerShell 脚本。

我要添加的工具：
- 工具名称：在这里填写，例如 Claude Code
- 工具标识 slug：在这里填写，例如 claude-code
- npm 安装包：在这里填写，例如 @anthropic-ai/claude-code
- 验证命令：在这里填写，例如 claude --version
- 需要写入的配置文件或环境变量：在这里填写
- 目标效果：用户运行 New API 生成的一键安装命令后，自动检测 Node.js/npm，安装工具，使用安装密钥换取 API Key 和配置，并完成工具的默认配置。

New API 脚本模板可用占位符：
- {{CONFIG_URL}}：安装脚本用于换取用户 API Key 和配置的接口地址。
- {{INSTALL_KEY}}：用户生成的短期安装密钥，用于防止脚本被滥用。
- {{BASE_URL}}：当前 New API 服务地址。
- {{OPENAI_BASE_URL}}：兼容 OpenAI 协议的 API 基础地址。
- {{TOOL_NAME}}：当前工具名称。
- {{PACKAGE_NAME}}：工具安装包名称。
- {{VERIFY_COMMAND}}：安装完成后的验证命令。

请输出：
1. Shell 脚本，适用于 macOS / Linux。
2. PowerShell 脚本，适用于 Windows。

脚本要求：
- 不要把真实 API Key 写死在脚本里，必须通过 {{CONFIG_URL}} 和 {{INSTALL_KEY}} 获取。
- 先检测 node 和 npm 是否存在，不存在时给出明确错误和安装提示。
- 优先使用 npm 全局安装 {{PACKAGE_NAME}}，安装后执行 {{VERIFY_COMMAND}} 验证。
- 配置 API 地址时优先使用 {{OPENAI_BASE_URL}}，需要展示服务地址时使用 {{BASE_URL}}。
- 兼容重复运行：目录、配置文件、环境变量重复存在时应覆盖或跳过，不要失败。
- 每一步输出清晰日志；失败时 exit 1。
- 最终只给我完整的 Shell 脚本和完整的 PowerShell 脚本，不要省略关键逻辑。`;

  const copyAiScriptPrompt = async () => {
    if (await copy(aiScriptPrompt)) {
      showSuccess(t('已复制到剪贴板！'));
    }
  };

  return (
    <>
      <CardPro
        type='type1'
        className='tool-install-setting-card'
        descriptionArea={
          <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
            <div>
              <Typography.Title heading={5} style={{ marginBottom: 4 }}>
                {t('工具安装脚本管理')}
              </Typography.Title>
              <Typography.Text type='secondary'>
                {t('手动维护用户工具页展示的工具名称、说明和安装脚本模板。')}
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
            <Space>
              <Button onClick={() => setModalVisible(false)}>
                {t('取消')}
              </Button>
              <Button
                type='primary'
                loading={saving}
                onClick={() => formApiRef.current?.submitForm()}
              >
                {editingTool ? t('保存') : t('新增工具')}
              </Button>
            </Space>
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
                <Form.Input
                  field='name'
                  label={t('名称')}
                  placeholder={t('例如 Claude Code')}
                  required
                  rules={[{ required: true, message: t('请输入名称') }]}
                />
                <Form.Input
                  field='slug'
                  label={t('标识')}
                  placeholder='claude-code'
                  required
                  rules={[{ required: true, message: t('请输入标识') }]}
                />
                <Form.Input
                  field='package_name'
                  label={t('安装包')}
                  placeholder='@anthropic-ai/claude-code'
                />
                <Form.Input
                  field='verify_command'
                  label={t('验证命令')}
                  placeholder='claude --version'
                />
                <Form.TextArea
                  field='description'
                  label={t('说明')}
                  autosize={{ minRows: 2, maxRows: 3 }}
                />
                <div className='tool-install-switch-field'>
                  <Form.Switch field='enabled' label={t('启用')} />
                </div>
                <Form.TextArea
                  field='shell_script'
                  fieldClassName='tool-install-script-field'
                  label='Shell'
                  style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}
                />
                <Form.TextArea
                  field='powershell_script'
                  fieldClassName='tool-install-script-field'
                  label='PowerShell'
                  style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}
                />
              </div>
            </Form>
          </TabPane>

          <TabPane itemKey='params' tab={t('参数说明')}>
            <div className='tool-install-params-layout'>
              <div className='tool-install-params-panel'>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>
                  {t('脚本参数')}
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
                      {t('给 AI 的脚本生成说明')}
                    </Typography.Title>
                    <Typography.Text type='secondary'>
                      {t('复制后发给 AI，并补充你要添加的工具信息，即可生成 Shell 和 PowerShell 脚本。')}
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
