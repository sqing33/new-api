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

import React, { useMemo, useState } from 'react';
import { SideSheet, Skeleton, Table, Typography } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import dayjs from 'dayjs';
import { CHART_CONFIG } from '../../constants/dashboard.constants';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import PeriodTabs from '../rankings/PeriodTabs';
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateColor,
} from './format';
import { renderConcurrencyDot } from '../../helpers';

const { Text } = Typography;

// 趋势图可按分组或按渠道拆分。两条数据链路同构（都是 BucketPoint 序列），
// 后端零改动，切换只影响 series 的取值来源。
const TREND_DIMENSIONS = ['group', 'channel'];
const TREND_DIMENSION_LABELS = {
  group: '按分组',
  channel: '按渠道',
};
// series 超过这个数量就隐藏图例：192px 高的图表放不下，图例会挤掉绘图区。
const TREND_LEGEND_MAX_SERIES = 8;

const StatCard = ({ label, value, color, t }) => (
  <div
    className='rounded-lg border p-3'
    style={{ borderColor: 'var(--semi-color-border)' }}
  >
    <div className='text-xs semi-text-tertiary mb-1'>{label}</div>
    <div
      className='font-mono text-lg font-semibold tabular-nums'
      style={color ? { color } : undefined}
    >
      {value}
    </div>
  </div>
);

const ModelPerformanceSheet = ({
  visible,
  modelName,
  detail,
  loading,
  onClose,
  t,
}) => {
  const isMobile = useIsMobile();
  const groups = detail?.groups || [];
  const channels = detail?.channels || [];
  const tokens = detail?.tokens || [];
  const [trendDimension, setTrendDimension] = useState('group');

  // 跨分组聚合的整体指标
  const overall = useMemo(() => {
    if (groups.length === 0) return null;
    const avg = (key) =>
      groups.reduce((sum, g) => sum + (Number(g[key]) || 0), 0) / groups.length;
    return {
      avgLatencyMs: avg('avg_latency_ms'),
      avgTtftMs: avg('avg_ttft_ms'),
      successRate: avg('success_rate'),
      avgTps: avg('avg_tps'),
    };
  }, [groups]);

  const buildTrendSpec = (yField, formatMethod) => {
    // 按渠道看时用渠道行；普通用户拿不到渠道数据（后端置空），回落到分组视图。
    const rows =
      trendDimension === 'channel' && channels.length > 0 ? channels : groups;
    const nameOf = (row) => (row.group ?? row.channel ?? '');
    const points = [];
    for (const row of rows) {
      for (const point of row.series || []) {
        points.push({
          // 保留原始时间戳用于排序：X 轴是类目轴，类目顺序取数据首次出现顺序，
          // 而这里是按维度逐段拼接的，不排序会让后一条的时间轴从左侧重新开始
          ts: point.ts,
          // X 轴数据直接预处理为可读时间(该版本对轴 formatMethod 不生效)
          time: dayjs(point.ts * 1000).format('MM-DD HH:mm'),
          dimension: nameOf(row),
          value: point[yField] ?? null,
        });
      }
    }
    if (points.length === 0) return null;
    // 与 useDashboardCharts 里其他时间轴图表一致，构造完成后按时间全局升序
    points.sort((a, b) => a.ts - b.ts);
    return {
      type: 'line',
      data: [{ id: 'modelTrendData', values: points }],
      xField: 'time',
      yField: 'value',
      seriesField: 'dimension',
      padding: 'auto',
      // 原生 axes 数组配置(该版本不认 categoryAxis/valueAxis 速记)
      axes: [
        {
          orient: 'bottom',
          label: { autoHide: true, autoRotate: false, style: { fontSize: 10 } },
          line: { visible: false },
          tick: { visible: false },
        },
        {
          orient: 'left',
          grid: { visible: true, style: { lineDash: [3, 3] } },
          label: formatMethod
            ? { formatMethod, style: { fontSize: 10 } }
            : { style: { fontSize: 10 } },
        },
      ],
      legend: {
        visible: rows.length > 1 && rows.length <= TREND_LEGEND_MAX_SERIES,
      },
      line: {
        symbol: false,
        lineWidth: 2,
      },
    };
  };

  const latencySpec = useMemo(
    () => buildTrendSpec('avg_ttft_ms', (v) => formatLatency(v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendDimension, groups, channels],
  );
  const successSpec = useMemo(
    () => buildTrendSpec('success_rate', (v) => `${Math.round(v)}%`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendDimension, groups, channels],
  );
  const concurrencySpec = useMemo(
    () => buildTrendSpec('max_concurrency', (v) => String(Math.round(v))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendDimension, groups, channels],
  );

  const groupColumns = [
    {
      title: t('分组'),
      dataIndex: 'group',
      width: 120,
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
      title: 'TTFT',
      dataIndex: 'avg_ttft_ms',
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      render: (value) => (
        <Text
          className='font-mono text-xs tabular-nums'
          style={{ color: getSuccessRateColor(value) }}
        >
          {formatUptimePct(value)}
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
      title: t('并发'),
      dataIndex: 'max_concurrency',
      render: (value, record) => {
        const peak = Math.round(value ?? 0);
        const average = Math.round(record?.avg_concurrency ?? 0);
        return (
          <span className='inline-flex items-center gap-1.5'>
            {renderConcurrencyDot(peak)}
            <span className='font-mono text-xs tabular-nums whitespace-nowrap'>
              {peak}
              <span className='text-[var(--semi-color-text-2)]'> / {average}</span>
            </span>
          </span>
        );
      },
    },
  ];

  const channelColumns = [
    {
      title: t('渠道'),
      dataIndex: 'channel',
      width: 120,
      render: (name) => (
        <Text
          className='font-mono text-xs'
          ellipsis={{ showTooltip: true }}
          style={{ maxWidth: 120 }}
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
      title: 'TTFT',
      dataIndex: 'avg_ttft_ms',
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      render: (value) => (
        <Text
          className='font-mono text-xs tabular-nums'
          style={{ color: getSuccessRateColor(value) }}
        >
          {formatUptimePct(value)}
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
      title: t('并发'),
      dataIndex: 'max_concurrency',
      render: (value, record) => {
        const peak = Math.round(value ?? 0);
        const average = Math.round(record?.avg_concurrency ?? 0);
        return (
          <span className='inline-flex items-center gap-1.5'>
            {renderConcurrencyDot(peak)}
            <span className='font-mono text-xs tabular-nums whitespace-nowrap'>
              {peak}
              <span className='text-[var(--semi-color-text-2)]'> / {average}</span>
            </span>
          </span>
        );
      },
    },
  ];

  const tokenColumns = [
    {
      title: t('令牌'),
      dataIndex: 'token_id',
      width: 160,
      render: (tokenId, record) => {
        // 后端已按角色过滤：管理员看到全部用户的令牌，普通用户只看自己的。
        // 名称缺失时回退到 #id，历史行（token_id=0）显示「未知令牌」。
        const label =
          record?.token_name || (tokenId > 0 ? `#${tokenId}` : t('未知令牌'));
        return (
          <Text className='text-xs' ellipsis={{ showTooltip: true }}>
            {label}
          </Text>
        );
      },
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
      title: 'TTFT',
      dataIndex: 'avg_ttft_ms',
      render: (value) => (
        <Text className='font-mono text-xs tabular-nums'>
          {formatLatency(value)}
        </Text>
      ),
    },
    {
      title: t('成功率'),
      dataIndex: 'success_rate',
      render: (value) => (
        <Text
          className='font-mono text-xs tabular-nums'
          style={{ color: getSuccessRateColor(value) }}
        >
          {formatUptimePct(value)}
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
    // 令牌维度的并发来自 perf_concurrency 的 token_id 列（按令牌跨渠道求和）。
    // 采样在部署后才开始积累，刚上线的一段时间会显示 0 / 0。
    {
      title: t('并发'),
      dataIndex: 'max_concurrency',
      render: (value, record) => {
        const peak = Math.round(value ?? 0);
        const average = Math.round(record?.avg_concurrency ?? 0);
        return (
          <span className='inline-flex items-center gap-1.5'>
            {renderConcurrencyDot(peak)}
            <span className='font-mono text-xs tabular-nums whitespace-nowrap'>
              {peak}
              <span className='text-[var(--semi-color-text-2)]'> / {average}</span>
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <SideSheet
      title={
        <Text strong className='font-mono'>
          {modelName}
        </Text>
      }
      placement='right'
      width={isMobile ? '100%' : 680}
      visible={visible}
      onCancel={onClose}
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ padding: 16 }} className='space-y-4'>
        {loading ? (
          <div className='space-y-3'>
            <Skeleton active className='!h-16' />
            <Skeleton active className='!h-40' />
          </div>
        ) : (
          <>
            <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
              <StatCard
                label={t('平均延迟')}
                value={formatLatency(overall?.avgLatencyMs)}
              />
              <StatCard
                label='TTFT'
                value={formatLatency(overall?.avgTtftMs)}
              />
              <StatCard
                label={t('成功率')}
                value={formatUptimePct(overall?.successRate)}
                color={getSuccessRateColor(overall?.successRate)}
              />
              <StatCard
                label={t('吞吐')}
                value={formatThroughput(overall?.avgTps)}
              />
            </div>
            {groups.length > 0 ? (
              <>
                <div>
                  <Text strong className='text-sm'>
                    {t('分组指标')}
                  </Text>
                  <Table
                    className='mt-2'
                    columns={groupColumns}
                    dataSource={groups}
                    pagination={false}
                    size='small'
                    rowKey='group'
                  />
                </div>
                {channels.length > 0 && (
                  <div>
                    <Text strong className='text-sm'>
                      {t('渠道指标')}
                    </Text>
                    <Table
                      className='mt-2'
                      columns={channelColumns}
                      dataSource={channels}
                      pagination={false}
                      size='small'
                      rowKey='channel'
                    />
                  </div>
                )}
                {tokens.length > 0 && (
                  <div>
                    <Text strong className='text-sm'>
                      {t('令牌指标')}
                    </Text>
                    <Table
                      className='mt-2'
                      columns={tokenColumns}
                      dataSource={tokens}
                      pagination={false}
                      size='small'
                      rowKey='token_id'
                    />
                  </div>
                )}
                {/* 三个趋势图共用一个维度切换：按分组 / 按渠道。
                    普通用户拿不到渠道数据，切换控件只在有渠道数据时出现。 */}
                {channels.length > 0 && (
                  <div className='flex items-center justify-between gap-2'>
                    <Text strong className='text-sm'>
                      {t('趋势维度')}
                    </Text>
                    <PeriodTabs
                      periods={TREND_DIMENSIONS}
                      labels={TREND_DIMENSION_LABELS}
                      active={trendDimension}
                      onChange={setTrendDimension}
                      t={t}
                    />
                  </div>
                )}
                <div>
                  <Text strong className='text-sm'>
                    {t('TTFT 趋势')}
                  </Text>
                  <div className='h-48 mt-2'>
                    {latencySpec ? (
                      <VChart
                        style={{ background: 'transparent' }}
                        spec={latencySpec}
                        option={CHART_CONFIG}
                      />
                    ) : (
                      <Text type='secondary' className='block text-center py-8'>
                        {t('暂无趋势数据')}
                      </Text>
                    )}
                  </div>
                </div>
                <div>
                  <Text strong className='text-sm'>
                    {t('成功率趋势')}
                  </Text>
                  <div className='h-48 mt-2'>
                    {successSpec ? (
                      <VChart
                        style={{ background: 'transparent' }}
                        spec={successSpec}
                        option={CHART_CONFIG}
                      />
                    ) : (
                      <Text type='secondary' className='block text-center py-8'>
                        {t('暂无趋势数据')}
                      </Text>
                    )}
                  </div>
                </div>
                <div>
                  <Text strong className='text-sm'>
                    {t('并发趋势')}
                  </Text>
                  <div className='h-48 mt-2'>
                    {concurrencySpec ? (
                      <VChart
                        style={{ background: 'transparent' }}
                        spec={concurrencySpec}
                        option={CHART_CONFIG}
                      />
                    ) : (
                      <Text type='secondary' className='block text-center py-8'>
                        {t('暂无趋势数据')}
                      </Text>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <Text type='secondary' className='block text-center py-8'>
                {t('该模型暂无分组性能数据')}
              </Text>
            )}
          </>
        )}
      </div>
    </SideSheet>
  );
};

export default ModelPerformanceSheet;
