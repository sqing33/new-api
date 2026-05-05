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
  Banner,
  Button,
  Card,
  Form,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

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
    setModalVisible(true);
  };

  const openEdit = (tool) => {
    setEditingTool(tool);
    setModalVisible(true);
  };

  const saveTool = async (values) => {
    setSaving(true);
    try {
      const payload = { ...emptyTool, ...values };
      const res = editingTool
        ? await API.put(`/api/tool-install/admin/tools/${editingTool.id}`, payload)
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

  return (
    <Card>
      <Space vertical align='stretch' style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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

        <Banner
          type='info'
          description={t(
            '脚本模板支持占位符：{{CONFIG_URL}}、{{INSTALL_KEY}}、{{BASE_URL}}、{{OPENAI_BASE_URL}}、{{TOOL_NAME}}、{{PACKAGE_NAME}}、{{VERIFY_COMMAND}}。',
          )}
        />

        <Table
          columns={columns}
          dataSource={tools}
          rowKey='id'
          loading={loading}
          pagination={false}
        />
      </Space>

      <Modal
        title={editingTool ? t('编辑工具') : t('新增工具')}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => formApiRef.current?.submitForm()}
        confirmLoading={saving}
        width={900}
      >
        <Form
          initValues={editingTool || emptyTool}
          getFormApi={(api) => (formApiRef.current = api)}
          onSubmit={saveTool}
        >
          <Form.Input
            field='name'
            label={t('名称')}
            required
            rules={[{ required: true, message: t('请输入名称') }]}
          />
          <Form.Input
            field='slug'
            label={t('标识')}
            required
            extraText={t('只能使用小写字母、数字和连字符，例如 claude-code。')}
            rules={[{ required: true, message: t('请输入标识') }]}
          />
          <Form.TextArea
            field='description'
            label={t('说明')}
            autosize={{ minRows: 2, maxRows: 4 }}
          />
          <Form.Input field='package_name' label={t('安装包')} />
          <Form.Input field='verify_command' label={t('验证命令')} />
          <Form.Switch field='enabled' label={t('启用')} />
          <Form.TextArea
            field='shell_script'
            label='Shell'
            autosize={{ minRows: 10, maxRows: 18 }}
            style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}
          />
          <Form.TextArea
            field='powershell_script'
            label='PowerShell'
            autosize={{ minRows: 10, maxRows: 18 }}
            style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}
          />
        </Form>
      </Modal>
    </Card>
  );
}
