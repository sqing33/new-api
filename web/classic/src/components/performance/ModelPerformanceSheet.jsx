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

import React, { useMemo } from 'react';
import { SideSheet, Skeleton, Table, Typography } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import dayjs from 'dayjs';
import { CHART_CONFIG } from '../../constants/dashboard.constants';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateColor,
} from './format';

const { Text } = Typography;

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
    const points = [];
    for (const group of groups) {
      for (const point of group.series || []) {
        points.push({
          ts: point.ts * 1000,
          group: group.group,
          value: point[yField] ?? null,
        });
      }
    }
    if (points.length === 0) return null;
    return {
      type: 'line',
      data: points,
      xField: 'ts',
      yField: 'value',
      seriesField: 'group',
      padding: 'auto',
      categoryAxis: {
        label: {
          autoHide: true,
          autoRotate: false,
          formatMethod: (value) => dayjs(value).format('MM-DD HH:mm'),
          style: { fontSize: 10 },
        },
        line: false,
        tick: false,
      },
      valueAxis: {
        grid: { lineStyle: { lineDash: [3, 3] } },
        label: formatMethod
          ? { formatMethod, style: { fontSize: 10 } }
          : { style: { fontSize: 10 } },
      },
      legend: { visible: groups.length > 1 },
      line: {
        symbol: false,
        lineWidth: 2,
      },
    };
  };

  const latencySpec = useMemo(
    () => buildTrendSpec('avg_ttft_ms', (v) => formatLatency(v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups],
  );
  const successSpec = useMemo(
    () => buildTrendSpec('success_rate', (v) => `${Math.round(v)}%`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups],
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
