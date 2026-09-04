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
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { getRelativeTime, timestamp2string } from '../../../helpers';
import { TASK_TYPE_LABELS } from '../../../hooks/system-info/useSystemInfoData';

const { Text } = Typography;

const STATUS_TAG = {
  pending: { color: 'orange', label: '等待中' },
  running: { color: 'blue', label: '运行中' },
  succeeded: { color: 'green', label: '成功' },
  failed: { color: 'red', label: '失败' },
};

const getProgress = (task) => {
  const progress = task.state?.progress;
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null;
  return Math.min(100, Math.max(0, progress));
};

const buildColumns = (t) => [
  {
    title: t('类型'),
    dataIndex: 'type',
    width: 220,
    render: (type) => (
      <div>
        <Text strong>{t(TASK_TYPE_LABELS[type] || type)}</Text>
        <div className='font-mono text-xs semi-text-tertiary'>{type}</div>
      </div>
    ),
  },
  {
    title: t('状态'),
    dataIndex: 'status',
    width: 100,
    render: (status) => {
      const cfg = STATUS_TAG[status] || STATUS_TAG.failed;
      return (
        <Tag color={cfg.color} size='small'>
          {t(cfg.label)}
        </Tag>
      );
    },
  },
  {
    title: t('进度'),
    dataIndex: 'state',
    width: 180,
    render: (state, record) => {
      const progress = getProgress(record);
      return (
        <div className='flex items-center gap-2'>
          <Progress
            percent={progress ?? 0}
            size='small'
            style={{ width: 100 }}
            showInfo={false}
          />
          <Text type='tertiary' className='text-xs whitespace-nowrap'>
            {progress === null ? '-' : `${Math.round(progress)}%`}
          </Text>
        </div>
      );
    },
  },
  {
    title: t('执行节点'),
    dataIndex: 'locked_by',
    width: 200,
    render: (lockedBy) => (
      <Text
        type='secondary'
        className='font-mono text-xs'
        ellipsis={{ showTooltip: true }}
      >
        {lockedBy || '-'}
      </Text>
    ),
  },
  {
    title: t('更新时间'),
    dataIndex: 'updated_at',
    width: 130,
    render: (ts) => (
      <Tooltip content={ts ? timestamp2string(ts) : ''} showArrow>
        <Text type='secondary' className='text-xs whitespace-nowrap'>
          {ts ? getRelativeTime(ts * 1000) : '-'}
        </Text>
      </Tooltip>
    ),
  },
  {
    title: t('详情'),
    dataIndex: 'error',
    render: (error) =>
      error ? (
        <Tooltip content={error} showArrow position='top'>
          <Text
            type='danger'
            className='text-xs'
            ellipsis={{ showTooltip: false }}
            style={{
              maxWidth: 220,
              display: 'inline-block',
              verticalAlign: 'bottom',
            }}
          >
            {error}
          </Text>
        </Tooltip>
      ) : (
        <Text type='tertiary'>-</Text>
      ),
  },
];

const SystemTasksPanel = ({ data, t }) => {
  const { tasks, tasksLoading, tasksRefreshing, hasActiveTasks, loadTasks } =
    data;

  const activeTasks = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'running',
  );
  const historyTasks = tasks.filter(
    (task) => task.status !== 'pending' && task.status !== 'running',
  );
  const columns = buildColumns(t);

  return (
    <div>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3'>
        <div>
          <Text strong className='text-base'>
            {t('系统任务')}
          </Text>
          <div className='text-xs semi-text-tertiary mt-0.5'>
            {t('各实例正在执行与维护中的后台任务状态')}
          </div>
        </div>
        <Space>
          <Text type='tertiary' className='text-xs'>
            {hasActiveTasks
              ? t('每 {{seconds}} 秒自动刷新', { seconds: 8 })
              : t('无运行中任务时暂停自动刷新')}
          </Text>
          <Button
            theme='solid'
            size='small'
            loading={tasksRefreshing}
            onClick={() => loadTasks()}
          >
            {t('刷新')}
          </Button>
        </Space>
      </div>
      <div className='space-y-5'>
        <div>
          <div className='flex items-center justify-between mb-2'>
            <div>
              <Text strong>{t('运行中任务')}</Text>
              <div className='text-xs semi-text-tertiary'>
                {t('当前等待或正在执行的任务')}
              </div>
            </div>
            <Tag size='small' shape='circle' color='white'>
              {activeTasks.length}
            </Tag>
          </div>
          <Table
            columns={columns}
            dataSource={activeTasks}
            loading={tasksLoading && activeTasks.length === 0}
            pagination={false}
            size='small'
            rowKey='task_id'
            scroll={{ x: 'max-content' }}
            empty={<Text type='secondary'>{t('暂无运行中系统任务')}</Text>}
          />
        </div>
        <div>
          <div className='flex items-center justify-between mb-2'>
            <div>
              <Text strong>{t('任务历史')}</Text>
              <div className='text-xs semi-text-tertiary'>
                {t('最近完成或失败的系统任务记录')}
              </div>
            </div>
            <Tag size='small' shape='circle' color='white'>
              {historyTasks.length}
            </Tag>
          </div>
          <Table
            columns={columns}
            dataSource={historyTasks}
            loading={tasksLoading && historyTasks.length === 0}
            pagination={false}
            size='small'
            rowKey='task_id'
            scroll={{ x: 'max-content' }}
            empty={<Text type='secondary'>{t('暂无历史系统任务')}</Text>}
          />
        </div>
      </div>
    </div>
  );
};

export default SystemTasksPanel;
