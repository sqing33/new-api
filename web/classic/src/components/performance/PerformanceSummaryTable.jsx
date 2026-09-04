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
import { Button, Table, Typography } from '@douyinfe/semi-ui';
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateColor,
} from './format';

const { Text } = Typography;

// 近 N 个时间桶的成功率迷你趋势线
const SuccessRateSparkline = ({ values }) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const width = 80;
  const height = 22;
  const min = 0;
  const max = 100;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const clamped = Math.min(100, Math.max(0, Number(value) || 0));
      const y = height - 1 - ((clamped - min) / (max - min)) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = getSuccessRateColor(values[values.length - 1]);
  return (
    <svg
      width={width}
      height={height}
      aria-hidden='true'
      className='shrink-0'
    >
      <polyline
        points={points}
        fill='none'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

const PerformanceSummaryTable = ({ models, loading = false, onOpenDetail, t }) => {
  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      render: (name) => (
        <Text className='font-mono text-xs' ellipsis={{ showTooltip: true }} style={{ maxWidth: 260 }}>
          {name}
        </Text>
      ),
    },
    {
      title: t('平均延迟'),
      dataIndex: 'avg_latency_ms',
      width: 120,
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      width: 200,
      render: (value, record) => (
        <div className='flex items-center gap-2'>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: getSuccessRateColor(value),
              flexShrink: 0,
            }}
          />
          <Text
            className='font-mono text-xs tabular-nums whitespace-nowrap'
            style={{ color: getSuccessRateColor(value) }}
          >
            {formatUptimePct(value)}
          </Text>
          <SuccessRateSparkline values={record.recent_success_rates} />
        </div>
      ),
    },
    {
      title: t('吞吐'),
      dataIndex: 'avg_tps',
      width: 110,
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatThroughput(value)}
        </Text>
      ),
    },
    {
      title: t('操作'),
      dataIndex: 'operate',
      width: 90,
      render: (text, record) => (
        <Button
          size='small'
          type='tertiary'
          onClick={() => onOpenDetail(record.model_name)}
        >
          {t('详情')}
        </Button>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={models}
      loading={loading}
      pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
      size='small'
      rowKey='model_name'
      scroll={{ x: 'max-content' }}
      empty={<Text type='secondary'>{t('暂无性能指标数据')}</Text>}
    />
  );
};

export default PerformanceSummaryTable;
