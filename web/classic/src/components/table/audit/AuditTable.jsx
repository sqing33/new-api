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

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Form,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { IconSearch } from '@douyinfe/semi-icons';
import { API, showError, timestamp2string } from '../../../helpers';
import { createCardProPagination } from '../../../helpers/utils';
import CardPro from '../../common/ui/CardPro';
import CardTable from '../../common/ui/CardTable';

const { Text, Paragraph } = Typography;

const AUDIT_CATEGORY_OPTIONS = [
  { value: 'login', label: '登录' },
  { value: 'security', label: '安全' },
  { value: 'operation', label: '管理操作' },
  { value: 'access_token', label: '访问令牌' },
];

const renderCategoryTag = (category, t) => {
  const colorMap = {
    login: 'blue',
    security: 'red',
    operation: 'green',
    access_token: 'purple',
  };
  const labelMap = Object.fromEntries(
    AUDIT_CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
  );
  return (
    <Tag color={colorMap[category] || 'grey'} shape='circle' size='small'>
      {t(labelMap[category] || category)}
    </Tag>
  );
};

const AuditTable = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [logCount, setLogCount] = useState(0);
  const [formApi, setFormApi] = useState(null);

  const loadLogs = async (page = activePage, size = pageSize) => {
    setLoading(true);
    try {
      const values = formApi ? formApi.getValues() : {};
      const params = new URLSearchParams();
      params.set('p', String(page));
      params.set('page_size', String(size));
      if (values.username) params.set('username', values.username.trim());
      if (values.category) params.set('category', values.category);
      if (values.success !== undefined && values.success !== '') {
        params.set('success', values.success);
      }
      if (
        Array.isArray(values.dateRange) &&
        values.dateRange.length === 2 &&
        values.dateRange[0] &&
        values.dateRange[1]
      ) {
        params.set(
          'start_timestamp',
          String(Math.floor(new Date(values.dateRange[0]).getTime() / 1000)),
        );
        params.set(
          'end_timestamp',
          String(Math.floor(new Date(values.dateRange[1]).getTime() / 1000)),
        );
      }
      const res = await API.get(`/api/audit?${params.toString()}`);
      const { success, message, data } = res.data;
      if (success) {
        setLogs(data?.items || []);
        setLogCount(data?.total || 0);
        setActivePage(page);
        setPageSize(size);
      } else {
        showError(message);
      }
    } catch (error) {
      showError(error?.message || t('加载审计日志失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePageChange = (page) => loadLogs(page, pageSize);
  const handlePageSizeChange = (size) => loadLogs(1, size);

  const columns = [
    {
      title: t('时间'),
      dataIndex: 'created_at',
      width: 170,
      render: (text) => (
        <span className='text-xs'>{timestamp2string(text)}</span>
      ),
    },
    {
      title: t('用户'),
      dataIndex: 'username',
      width: 120,
      render: (text) => text || '-',
    },
    {
      title: t('类别'),
      dataIndex: 'category',
      width: 110,
      render: (text) => renderCategoryTag(text, t),
    },
    {
      title: t('操作'),
      dataIndex: 'action',
      width: 200,
      render: (text) => <Text code>{text}</Text>,
    },
    {
      title: t('验证方式'),
      dataIndex: 'auth_method',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: t('IP 地址'),
      dataIndex: 'ip',
      width: 130,
      render: (text) => <Text ellipsis={{ showTooltip: true }}>{text}</Text>,
    },
    {
      title: t('路由'),
      dataIndex: 'route',
      width: 180,
      render: (text) => <Text ellipsis={{ showTooltip: true }}>{text}</Text>,
    },
    {
      title: t('结果'),
      dataIndex: 'success',
      width: 80,
      render: (text) =>
        text ? (
          <Tag color='green' shape='circle' size='small'>
            {t('成功')}
          </Tag>
        ) : (
          <Tag color='red' shape='circle' size='small'>
            {t('失败')}
          </Tag>
        ),
    },
  ];

  const renderDetails = (record) => {
    let other = null;
    try {
      other =
        typeof record.other === 'string'
          ? JSON.parse(record.other || '{}')
          : record.other;
    } catch (e) {
      other = null;
    }
    return (
      <div className='text-xs p-2 flex flex-col gap-2'>
        <div>
          <Text strong>{t('事件 ID')}: </Text>
          <Text code>{record.event_id}</Text>
        </div>
        <div>
          <Text strong>{t('请求 ID')}: </Text>
          <Text code>{record.request_id || '-'}</Text>
        </div>
        <div>
          <Text strong>{t('请求方法')}: </Text>
          <Text code>{record.method || '-'}</Text>
        </div>
        <div>
          <Text strong>{t('User-Agent')}: </Text>
          <Text>{record.user_agent || '-'}</Text>
        </div>
        {record.content && (
          <div>
            <Text strong>{t('详情')}: </Text>
            <Paragraph
              copyable={{ content: record.content }}
              style={{ maxWidth: 600, marginBottom: 0 }}
              ellipsis={{ rows: 3, expandable: true, collapsible: true }}
            >
              {record.content}
            </Paragraph>
          </div>
        )}
        {other && Object.keys(other).length > 0 && (
          <div>
            <Text strong>{t('附加信息')}: </Text>
            <pre className='text-xs bg-gray-50 rounded p-2 overflow-auto max-w-2xl whitespace-pre-wrap break-all'>
              {JSON.stringify(other, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const searchArea = (
    <Form
      getFormApi={(api) => setFormApi(api)}
      allowEmpty
      autoComplete='off'
      layout='vertical'
      onSubmit={() => loadLogs(1, pageSize)}
    >
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2'>
        <Form.Input
          field='username'
          prefix={<IconSearch />}
          placeholder={t('用户名称')}
          showClear
          pure
          size='small'
        />
        <Form.Select
          field='category'
          placeholder={t('类别')}
          showClear
          pure
          size='small'
          optionList={AUDIT_CATEGORY_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.label),
          }))}
        />
        <Form.Select
          field='success'
          placeholder={t('结果')}
          showClear
          pure
          size='small'
          optionList={[
            { value: 'true', label: t('成功') },
            { value: 'false', label: t('失败') },
          ]}
        />
        <Form.DatePicker
          field='dateRange'
          type='dateTimeRange'
          placeholder={[t('开始时间'), t('结束时间')]}
          showClear
          pure
          size='small'
        />
      </div>
      <div className='flex justify-end mt-2'>
        <Button type='tertiary' htmlType='submit' size='small' loading={loading}>
          {t('查询')}
        </Button>
      </div>
    </Form>
  );

  return (
    <CardPro
      type='type1'
      descriptionArea={
        <span className='text-sm text-gray-600'>
          {t('审计日志记录了登录、安全验证与管理操作，仅管理员可见')}
        </span>
      }
      searchArea={searchArea}
      paginationArea={createCardProPagination({
        currentPage: activePage,
        pageSize: pageSize,
        total: logCount,
        onPageChange: handlePageChange,
        onPageSizeChange: handlePageSizeChange,
        t: t,
      })}
      t={t}
    >
      <Card className='!rounded-2xl shadow-sm border-0'>
        <CardTable
          columns={columns}
          dataSource={logs}
          scroll={{ x: 'max-content' }}
          rowKey='event_id'
          loading={loading}
          expandedRowRender={renderDetails}
          pagination={{
            currentPage: activePage,
            pageSize: pageSize,
            total: logCount,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
          }}
          empty={
            <Empty
              image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
              darkModeImage={
                <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
              }
              description={t('暂无审计日志')}
              style={{ padding: 30 }}
            />
          }
          className='rounded-xl overflow-hidden'
          size='middle'
        />
      </Card>
    </CardPro>
  );
};

export default AuditTable;
