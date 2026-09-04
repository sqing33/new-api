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
import { Button, Card, Select, Space, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import PerformanceSummaryTable from '../../components/performance/PerformanceSummaryTable';
import ModelPerformanceSheet from '../../components/performance/ModelPerformanceSheet';
import {
  PERFORMANCE_HOURS_OPTIONS,
  usePerformanceData,
} from '../../hooks/performance/usePerformanceData';

const { Title } = Typography;

const PerformancePage = () => {
  const perf = usePerformanceData();
  const {
    hours,
    setHours,
    summary,
    summaryLoading,
    summaryRefreshing,
    refresh,
    t,
  } = perf;

  return (
    // mt-[60px] 是控制台填充布局的样式钩子(CSS 已将其 margin 归零),
    // 配合 table-scroll-card 让卡片占满内容区剩余高度,页面无外层滚动
    <div className='mt-[60px] px-2 flex flex-col gap-4'>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
        <div>
          <Title heading={4} className='!mb-1'>
            {t('性能指标')}
          </Title>
          <div
            className='text-sm'
            style={{ color: 'var(--semi-color-text-1)' }}
          >
            {t('各模型的延迟、成功率与吞吐表现，数据来自网关调用日志。')}
          </div>
        </div>
        <Space>
          <Select
            size='small'
            value={hours}
            onChange={setHours}
            style={{ width: 130 }}
            optionList={PERFORMANCE_HOURS_OPTIONS.map((option) => ({
              label: t(option.label),
              value: option.value,
            }))}
          />
          <Button
            type='tertiary'
            icon={<RefreshCw size={16} />}
            loading={summaryRefreshing}
            onClick={refresh}
            className='bg-blue-500 hover:bg-blue-600'
          />
        </Space>
      </div>
      <Card
        className='!rounded-xl table-scroll-card'
        bodyStyle={{ padding: 16 }}
      >
        <PerformanceSummaryTable
          models={summary}
          loading={summaryLoading}
          onOpenDetail={perf.openModelDetail}
          t={t}
        />
      </Card>
      <ModelPerformanceSheet
        visible={Boolean(perf.sheetModel)}
        modelName={perf.sheetModel}
        detail={perf.sheetDetail}
        loading={perf.sheetLoading}
        onClose={perf.closeModelDetail}
        t={t}
      />
    </div>
  );
};

export default PerformancePage;
