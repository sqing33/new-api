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
import { Activity } from 'lucide-react';
import { Card, Select, Table, Tooltip, Typography } from '@douyinfe/semi-ui';
import ModelPerformanceSheet from '../performance/ModelPerformanceSheet';
import {
  formatLatency,
  formatUptimePct,
  getSuccessRateColor,
} from '../performance/format';
import {
  PERFORMANCE_HOURS_OPTIONS,
  usePerformanceData,
} from '../../hooks/performance/usePerformanceData';

const { Text } = Typography;

const SuccessRateDot = ({ value }) => (
  <div className='flex items-center gap-1.5'>
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
  </div>
);

// 近 N 个时间桶的成功率迷你趋势线(与完整页同款 SVG 折线)
const SuccessRateSparkline = ({ values }) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const width = 64;
  const height = 20;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const clamped = Math.min(100, Math.max(0, Number(value) || 0));
      const y = height - 1 - ((clamped - 0) / 100) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden='true' className='shrink-0'>
      <polyline
        points={points}
        fill='none'
        stroke={getSuccessRateColor(values[values.length - 1])}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

// 数据看板右侧的性能指标面板:紧凑摘要(模型/延迟/成功率+趋势),
// 时段切换与"模型数据分析"卡片一致放在标题栏右侧,详情走侧滑抽屉。
const PerformancePanel = ({ CARD_PROPS, t }) => {
  const perf = usePerformanceData();

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      render: (name) => (
        <Text
          className='font-mono text-xs'
          ellipsis={{ showTooltip: true }}
          style={{ maxWidth: 140 }}
        >
          {name}
        </Text>
      ),
    },
    {
      title: t('平均延迟'),
      dataIndex: 'avg_latency_ms',
      width: 90,
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      width: 150,
      render: (value, record) => (
        <div className='flex items-center gap-2'>
          <SuccessRateDot value={value} />
          <Tooltip
            content={(record.recent_success_rates || [])
              .map((v) => `${v}%`)
              .join(' → ')}
            showArrow
          >
            <span className='inline-flex'>
              <SuccessRateSparkline values={record.recent_success_rates} />
            </span>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <Card
      {...CARD_PROPS}
      className='!rounded-2xl lg:col-span-3'
      title={
        <div className='flex flex-col lg:flex-row lg:items-center lg:justify-between w-full gap-3'>
          <div className='flex items-center gap-2 flex-wrap'>
            <Activity size={16} />
            {t('性能指标')}
            <Text type='tertiary' className='text-xs font-normal'>
              {t('点击行查看吞吐等完整指标')}
            </Text>
          </div>
          <Select
            size='small'
            value={perf.hours}
            onChange={perf.setHours}
            style={{ width: 120 }}
            optionList={PERFORMANCE_HOURS_OPTIONS.map((option) => ({
              label: t(option.label),
              value: option.value,
            }))}
          />
        </div>
      }
    >
      <Table
        columns={columns}
        dataSource={perf.summary}
        loading={perf.summaryLoading}
        pagination={false}
        size='small'
        rowKey='model_name'
        onRow={(record) => ({
          onClick: () => perf.openModelDetail(record.model_name),
          style: { cursor: 'pointer' },
        })}
        empty={<Text type='secondary'>{t('暂无性能指标数据')}</Text>}
      />
      <ModelPerformanceSheet
        visible={Boolean(perf.sheetModel)}
        modelName={perf.sheetModel}
        detail={perf.sheetDetail}
        loading={perf.sheetLoading}
        onClose={perf.closeModelDetail}
        t={t}
      />
    </Card>
  );
};

export default PerformancePanel;
