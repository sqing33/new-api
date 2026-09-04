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
import { Card, Select, Table, Typography } from '@douyinfe/semi-ui';
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

// 数据看板右侧的性能指标面板:紧凑摘要(模型/延迟/成功率),
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
      width: 100,
      render: (value) => <SuccessRateDot value={value} />,
    },
  ];

  return (
    <Card
      {...CARD_PROPS}
      className='!rounded-2xl lg:col-span-3'
      title={
        <div className='flex flex-col lg:flex-row lg:items-center lg:justify-between w-full gap-3'>
          <div className='flex items-center gap-2'>
            <Activity size={16} />
            {t('性能指标')}
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
      <div className='mt-2'>
        <Text type='tertiary' className='text-xs'>
          {t('点击行查看吞吐等完整指标')}
        </Text>
      </div>
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
