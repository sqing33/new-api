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

import React, { useContext, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, Skeleton, Typography } from '@douyinfe/semi-ui';
import { StatusContext } from '../../context/Status';
import { UserContext } from '../../context/User';
import ModelsSection from '../../components/rankings/ModelsSection';
import MarketShareSection from '../../components/rankings/MarketShareSection';
import PulseSection from '../../components/rankings/PulseSection';
import {
  RANKINGS_PERIODS,
  useRankingsData,
} from '../../hooks/rankings/useRankingsData';
import PeriodTabs from '../../components/rankings/PeriodTabs';

const { Title } = Typography;

const PERIOD_LABELS = {
  today: '今天',
  week: '本周',
  month: '本月',
  year: '全年',
};

const Rankings = () => {
  const [statusState] = useContext(StatusContext);
  const [userState] = useContext(UserContext);
  const rankings = useRankingsData();
  const { data, loading, error, period, setPeriod, t } = rankings;

  // 模块开关来自 /api/status 的 HeaderNavModules（默认启用、无需登录）
  const access = useMemo(() => {
    try {
      const config = JSON.parse(statusState?.status?.HeaderNavModules || '{}');
      return config.rankings || {};
    } catch (_) {
      return {};
    }
  }, [statusState?.status?.HeaderNavModules]);

  if (access.enabled === false) {
    return <Navigate to='/' replace />;
  }
  if (access.requireAuth && !userState?.user?.id) {
    return <Navigate to='/login?redirect=/rankings' replace />;
  }

  return (
    <div className='px-2 space-y-4'>
      <div className='flex flex-col md:flex-row md:items-end md:justify-between gap-3'>
        <div>
          <Title heading={4} className='!mb-1'>
            {t('排行榜')}
          </Title>
          <div
            className='text-sm'
            style={{ color: 'var(--semi-color-text-1)' }}
          >
            {t(
              '发现平台上使用最多的模型与上升中的厂商，数据来自实时用量统计。',
            )}
          </div>
        </div>
        <PeriodTabs
          periods={RANKINGS_PERIODS}
          labels={PERIOD_LABELS}
          active={period}
          onChange={setPeriod}
          t={t}
        />
      </div>
      {loading ? (
        <div className='space-y-4'>
          <Skeleton className='!h-[420px] !rounded-xl' active />
          <Skeleton className='!h-[360px] !rounded-xl' active />
          <Skeleton className='!h-[180px] !rounded-xl' active />
        </div>
      ) : error ? (
        <Card className='!rounded-xl'>
          <div className='p-6 text-center'>
            <Typography.Text type='danger'>{error}</Typography.Text>
          </div>
        </Card>
      ) : (
        <>
          <ModelsSection data={data} period={period} t={t} />
          <MarketShareSection data={data} period={period} t={t} />
          <PulseSection data={data} t={t} />
        </>
      )}
    </div>
  );
};

export default Rankings;
