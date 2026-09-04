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

import React from 'react';
import {
  Button,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { getRelativeTime, timestamp2string } from '../../../helpers';

const { Text } = Typography;

const STATUS_TAG = {
  online: { color: 'green', label: '在线' },
  stale: { color: 'orange', label: '已失联' },
};

const ROLE_TAG = {
  master: { color: 'blue', label: 'master' },
  worker: { color: 'white', label: 'worker' },
};

const formatPercent = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value.toFixed(1)}%`;
};

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const getNodeName = (instance) =>
  instance.info?.node?.name || instance.node_name || '-';

const getRuntimeLabel = (instance) => {
  const runtime = instance.info?.runtime;
  if (!runtime?.goos && !runtime?.goarch) return '-';
  return [runtime.goos, runtime.goarch].filter(Boolean).join('/');
};

const renderResourcePercent = (value, tooltip) => {
  const text = formatPercent(value);
  const color =
    typeof value === 'number' && !Number.isNaN(value)
      ? value >= 90
        ? 'var(--semi-color-danger)'
        : value >= 70
          ? 'var(--semi-color-warning)'
          : 'var(--semi-color-success)'
      : undefined;
  const content = <Text style={color ? { color } : undefined}>{text}</Text>;
  if (!tooltip) return content;
  return (
    <Tooltip content={tooltip} showArrow>
      {content}
    </Tooltip>
  );
};

const SystemInstancesPanel = ({ data, t }) => {
  const {
    instances,
    instancesLoading,
    instancesRefreshing,
    deletingNodeName,
    deletingAllStale,
    loadInstances,
    deleteStaleInstance,
    deleteStaleInstances,
  } = data;

  const staleCount = instances.filter((i) => i.status === 'stale').length;
  const isDeleting = deletingNodeName !== null || deletingAllStale;

  const confirmDeleteStale = (instance) => {
    Modal.confirm({
      title: t('删除失效实例'),
      content: t('确定删除失效实例「{{name}}」吗？若其已重新上报则不会删除。', {
        name: getNodeName(instance),
      }),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: () => deleteStaleInstance(instance.node_name),
    });
  };

  const confirmDeleteAllStale = () => {
    Modal.confirm({
      title: t('删除全部失效实例'),
      content: t('确定删除 {{count}} 个失效实例记录吗？在线实例不会被删除。', {
        count: staleCount,
      }),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: () => deleteStaleInstances(),
    });
  };

  const columns = [
    {
      title: t('实例'),
      dataIndex: 'node_name',
      render: (text, record) => {
        const shouldConfigure = record.info?.node?.should_configure_manually;
        return (
          <div>
            <div className='flex items-center gap-1.5'>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    record.status === 'online'
                      ? 'var(--semi-color-success)'
                      : 'var(--semi-color-warning)',
                  flexShrink: 0,
                }}
              />
              <Text
                strong
                ellipsis={{ showTooltip: true }}
                style={{ maxWidth: 200 }}
              >
                {getNodeName(record)}
              </Text>
              {shouldConfigure && (
                <Tooltip
                  content={t(
                    '该实例使用自动主机名，请配置 NODE_NAME 为稳定的唯一值以便多实例管理',
                  )}
                  showArrow
                >
                  <Tag color='orange' size='small' shape='circle'>
                    {t('NODE_NAME')}
                  </Tag>
                </Tooltip>
              )}
            </div>
            <div className='text-xs semi-text-tertiary truncate'>
              {record.info?.host?.hostname || '-'}
            </div>
          </div>
        );
      },
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 100,
      render: (status) => {
        const cfg = STATUS_TAG[status] || STATUS_TAG.stale;
        return (
          <Tag color={cfg.color} size='small'>
            {t(cfg.label)}
          </Tag>
        );
      },
    },
    {
      title: t('角色'),
      dataIndex: 'info',
      width: 90,
      render: (info, record) => {
        const isMaster = info?.role?.is_master === true;
        const cfg = ROLE_TAG[isMaster ? 'master' : 'worker'];
        return (
          <Tooltip
            content={
              isMaster
                ? t('master 实例负责执行定时后台任务')
                : t('worker 实例不执行 master 专属后台任务')
            }
            showArrow
          >
            <Tag color={cfg.color} size='small' shape='circle'>
              {cfg.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'CPU',
      dataIndex: 'info',
      width: 80,
      render: (info) =>
        renderResourcePercent(info?.resources?.cpu?.usage_percent),
    },
    {
      title: t('内存'),
      dataIndex: 'info',
      width: 80,
      render: (info) =>
        renderResourcePercent(info?.resources?.memory?.usage_percent),
    },
    {
      title: t('磁盘'),
      dataIndex: 'info',
      width: 80,
      render: (info) => {
        const storage = info?.resources?.storage;
        const tooltip = storage ? (
          <div style={{ fontSize: 12, lineHeight: '20px' }}>
            <div>
              {t('已用')}：{formatBytes(storage.used_bytes)}
            </div>
            <div>
              {t('可用')}：{formatBytes(storage.free_bytes)}
            </div>
            <div>
              {t('总量')}：{formatBytes(storage.total_bytes)}
            </div>
          </div>
        ) : null;
        return renderResourcePercent(storage?.used_percent, tooltip);
      },
    },
    {
      title: t('版本'),
      dataIndex: 'info',
      width: 110,
      render: (info) => (
        <Text className='font-mono text-xs' ellipsis={{ showTooltip: true }}>
          {info?.runtime?.version || '-'}
        </Text>
      ),
    },
    {
      title: t('运行环境'),
      dataIndex: 'info',
      width: 110,
      render: (info) => (
        <Text className='font-mono text-xs'>{getRuntimeLabel({ info })}</Text>
      ),
    },
    {
      title: t('启动时间'),
      dataIndex: 'started_at',
      width: 150,
      render: (ts) => (
        <Text type='secondary' className='text-xs whitespace-nowrap'>
          {ts ? timestamp2string(ts) : '-'}
        </Text>
      ),
    },
    {
      title: t('最后心跳'),
      dataIndex: 'last_seen_at',
      width: 120,
      render: (ts) => (
        <Tooltip content={ts ? timestamp2string(ts) : ''} showArrow>
          <Text type='secondary' className='text-xs whitespace-nowrap'>
            {ts ? getRelativeTime(ts * 1000) : '-'}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: t('操作'),
      dataIndex: 'operate',
      width: 90,
      render: (text, record) =>
        record.status === 'stale' ? (
          <Button
            type='danger'
            size='small'
            loading={deletingNodeName === record.node_name}
            disabled={isDeleting}
            onClick={() => confirmDeleteStale(record)}
          >
            {t('删除')}
          </Button>
        ) : (
          <Text type='tertiary'>-</Text>
        ),
    },
  ];

  return (
    <div>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3'>
        <div>
          <Text strong className='text-base'>
            {t('实例')}
          </Text>
          <div className='text-xs semi-text-tertiary mt-0.5'>
            {t('上报心跳的本部署节点及其最新状态')}
          </div>
        </div>
        <Space>
          <Text type='tertiary' className='text-xs'>
            {t('每 {{seconds}} 秒自动刷新', { seconds: 30 })}
          </Text>
          {staleCount > 0 && (
            <Button
              type='danger'
              size='small'
              loading={deletingAllStale}
              disabled={isDeleting}
              onClick={confirmDeleteAllStale}
            >
              {t('删除全部失效实例')}
            </Button>
          )}
          <Button
            theme='outline'
            size='small'
            loading={instancesRefreshing}
            onClick={() => loadInstances()}
          >
            {t('刷新')}
          </Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={instances}
        loading={instancesLoading}
        pagination={false}
        size='small'
        rowKey='node_name'
        scroll={{ x: 'max-content' }}
        empty={<Text type='secondary'>{t('暂无实例上报')}</Text>}
      />
    </div>
  );
};

export default SystemInstancesPanel;
