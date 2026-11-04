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
  formatThroughput,
  formatUptimePct,
  getSuccessRateColor,
} from '../performance/format';
import {
  PERFORMANCE_HOURS_OPTIONS,
  usePerformanceData,
} from '../../hooks/performance/usePerformanceData';
import { renderConcurrencyDot } from '../../helpers';

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

// 近 N 个时间桶的成功率迷你趋势线(与完整页同款 SVG 折线);
// 数据不足两个点时显示单个状态点,保证该列视觉上不空缺

// ConcurrencySparkline 画并发的迷你趋势线。与成功率不同，这里的 x 坐标
// 按 point.ts 定位而不是数组索引——并发采样可能缺桶，按索引会把不规则
// 间隔画成等距，趋势会失真。
const ConcurrencySparkline = ({ points }) => {
  const width = 64;
  const height = 20;
  const series = Array.isArray(points) ? points : [];
  if (series.length === 0) {
    return (
      <svg width={width} height={height} aria-hidden='true' className='shrink-0'>
        <line
          x1='1'
          y1={height - 1}
          x2={width - 1}
          y2={height - 1}
          stroke='var(--semi-color-border)'
          strokeWidth='1'
          strokeDasharray='3 3'
        />
      </svg>
    );
  }
  const maxValue = Math.max(1, ...series.map((p) => Number(p.max_concurrency) || 0));
  const firstTs = series[0].ts;
  const spanTs = Math.max(1, series[series.length - 1].ts - firstTs);
  const coords = series.map((point) => {
    const x = 1 + ((point.ts - firstTs) / spanTs) * (width - 2);
    const ratio = (Number(point.max_concurrency) || 0) / maxValue;
    const y = height - 1 - ratio * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastValue = Number(series[series.length - 1].max_concurrency) || 0;
  const hue = Math.max(0, 120 - (Math.min(lastValue, 40) / 40) * 120);
  const color = lastValue <= 0 ? 'var(--semi-color-text-2)' : `hsl(${hue}, 70%, 45%)`;
  if (series.length === 1) {
    return (
      <svg width={width} height={height} aria-hidden='true' className='shrink-0'>
        <circle cx={width / 2} cy={height - 1 - ((lastValue / maxValue) * (height - 2))} r='3' fill={color} />
      </svg>
    );
  }
  return (
    <svg width={width} height={height} aria-hidden='true' className='shrink-0'>
      <polyline
        points={coords.join(' ')}
        fill='none'
        stroke={color}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <circle
        cx={coords[coords.length - 1].split(',')[0]}
        cy={coords[coords.length - 1].split(',')[1]}
        r='2.5'
        fill={color}
      />
    </svg>
  );
};

const SuccessRateSparkline = ({ values }) => {
  if (!Array.isArray(values) || values.length === 0) {
    return (
      <svg width={64} height={20} aria-hidden='true' className='shrink-0'>
        <line
          x1='1'
          y1='10'
          x2='63'
          y2='10'
          stroke='var(--semi-color-border)'
          strokeWidth='1'
          strokeDasharray='3 3'
        />
      </svg>
    );
  }
  if (values.length === 1) {
    const color = getSuccessRateColor(values[0]);
    return (
      <svg width={64} height={20} aria-hidden='true' className='shrink-0'>
        <circle cx='32' cy='10' r='3' fill={color} />
      </svg>
    );
  }
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
  const lastValue = values[values.length - 1];
  return (
    <svg width={width} height={height} aria-hidden='true' className='shrink-0'>
      <polyline
        points={points}
        fill='none'
        stroke={getSuccessRateColor(lastValue)}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      {/* 末点加圆点标记,当前状态一目了然 */}
      <circle
        cx={width - 1}
        cy={
          20 -
          1 -
          ((Math.min(100, Math.max(0, Number(lastValue) || 0)) - 0) / 100) *
            (20 - 2)
        }
        r='2.5'
        fill={getSuccessRateColor(lastValue)}
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
          style={{ maxWidth: 160 }}
        >
          {name}
        </Text>
      ),
    },
    {
      title: t('平均延迟'),
      dataIndex: 'avg_latency_ms',
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('吞吐'),
      dataIndex: 'avg_tps',
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatThroughput(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      render: (value, record) => {
        // 后端返回 [{ts, success_rate}]，这里取出成功率序列用于迷你趋势线
        const recentRates = (record.recent_success_series || []).map(
          (point) => point.success_rate,
        );
        return (
          <div className='flex items-center gap-2'>
            <SuccessRateDot value={value} />
            <Tooltip content={recentRates.map((v) => `${v}%`).join(' → ')} showArrow>
              <span className='inline-flex'>
                <SuccessRateSparkline values={recentRates} />
              </span>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: t('并发'),
      dataIndex: 'max_concurrency',
      render: (value, record) => {
        const series = record.recent_concurrency_series || [];
        // 峰值与均值一并展示：两者差距大说明存在突发流量，只看任一个都会误判。
        // 圆点按峰值着色，保持与渠道/令牌/用户表格一致的视觉语言。
        const peak = Math.round(value ?? record.max_concurrency ?? 0);
        const average = Math.round(record.avg_concurrency ?? 0);
        return (
          <div className='flex items-center gap-2'>
            <span className='inline-flex items-center gap-1.5'>
              {renderConcurrencyDot(peak)}
              <span className='font-mono text-xs tabular-nums whitespace-nowrap'>
                {peak}
                <span className='text-[var(--semi-color-text-2)]'> / {average}</span>
              </span>
            </span>
            <Tooltip
              content={series
                .map(
                  (p) =>
                    `${Math.round(p.max_concurrency ?? 0)} / ${Math.round(p.avg_concurrency ?? 0)}`,
                )
                .join(' → ')}
              showArrow
            >
              <span className='inline-flex'>
                <ConcurrencySparkline points={series} />
              </span>
            </Tooltip>
          </div>
        );
      },
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
        className='performance-panel-table'
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
