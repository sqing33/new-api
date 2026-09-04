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
import { Card, Typography } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useNavigate } from 'react-router-dom';
import { CHART_CONFIG } from '../../constants/dashboard.constants';
import { getLobeHubIcon } from '../../helpers';
import { formatTokens } from './format';

const { Text } = Typography;

const PERIOD_DESCRIPTIONS = {
  today: '最近 24 小时按小时统计的模型 token 用量',
  week: '过去数周按天统计的模型 token 用量',
  month: '过去一个月按天统计的模型 token 用量',
  year: '过去一年按周统计的模型 token 用量',
};

const GROWTH_DISPLAY_CAP = 1000;

const GrowthText = ({ value, t }) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value === 0) {
    return (
      <Text type='tertiary' className='font-mono text-xs'>
        -
      </Text>
    );
  }
  const up = value > 0;
  const magnitude = Math.abs(value);
  // 新模型或基数极小时百分比会大到几千几万,封顶展示避免撑爆布局
  const shown =
    magnitude > GROWTH_DISPLAY_CAP
      ? `>${GROWTH_DISPLAY_CAP}%`
      : `${magnitude.toFixed(magnitude >= 10 ? 0 : 1)}%`;
  return (
    <Text
      className='font-mono text-xs whitespace-nowrap'
      style={{
        color: up ? 'var(--semi-color-success)' : 'var(--semi-color-danger)',
      }}
    >
      {up ? '↑' : '↓'}
      {shown}
    </Text>
  );
};

const ModelsSection = ({ data, period, t, periodSlot }) => {
  const navigate = useNavigate();
  const history = data?.models_history || { points: [], models: [] };
  const models = data?.models || [];

  const totalTokens = useMemo(
    () => models.reduce((sum, m) => sum + (m.total_tokens || 0), 0),
    [models],
  );

  const chartSpec = useMemo(() => {
    const points = history.points || [];
    if (points.length === 0) return null;
    // 时间点形如 "Aug 28"(按天)或 "06:00"(今天周期按小时),转成中文展示
    const formatLabel = (label) => {
      if (!label) return label;
      // 今天周期:小时刻度原样保留
      if (/^\d{1,2}:\d{2}$/.test(label)) return label;
      const parsed = new Date(`${label} ${new Date().getFullYear()}`);
      if (Number.isNaN(parsed.getTime())) return label;
      const now = new Date();
      const sameYear = parsed.getFullYear() === now.getFullYear();
      const text = `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
      return sameYear ? text : `${parsed.getFullYear()}年${text}`;
    };
    // 该 VChart 版本对堆叠柱状图的轴 label formatMethod 不生效,
    // 直接在数据里预处理:X 轴换成中文日期,Y 轴用缩放后的展示值
    const displayTokens = (value) => {
      if (!value) return 0;
      if (value >= 1e9) return Number((value / 1e9).toFixed(2));
      if (value >= 1e6) return Number((value / 1e6).toFixed(1));
      if (value >= 1e3) return Number((value / 1e3).toFixed(1));
      return value;
    };
    const values = points.map((point) => ({
      ...point,
      label: formatLabel(point.label),
      tokens: displayTokens(point.tokens),
      rawTokens: point.tokens,
    }));
    return {
      type: 'bar',
      background: 'transparent',
      data: [{ id: 'modelsHistoryData', values }],
      xField: 'label',
      yField: 'tokens',
      seriesField: 'model',
      stack: true,
      padding: 'auto',
      // 该 VChart 版本只认原生 axes 数组配置(categoryAxis/valueAxis 速记不生效)
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
          label: { style: { fontSize: 10 } },
          title: {
            visible: true,
            text: 'tokens (K/M/B)',
            style: { fontSize: 10, fontWeight: 'normal' },
          },
        },
      ],
      legend: { visible: false },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum) => datum['model'],
              value: (datum) => formatTokens(datum['rawTokens']),
            },
          ],
        },
        dimension: {
          title: (datum) => datum?.['label'],
          content: [
            {
              key: (datum) => datum['model'],
              value: (datum) => formatTokens(datum['rawTokens']),
            },
          ],
          updateContent: (array) => {
            array.sort((a, b) => {
              const av = a?.datum?.rawTokens || 0;
              const bv = b?.datum?.rawTokens || 0;
              return bv - av;
            });
            return array;
          },
        },
      },
      bar: {
        columnWidthRatio: 0.6,
      },
    };
  }, [history.points]);

  const half = Math.ceil(models.length / 2);
  const columnsList = [models.slice(0, half), models.slice(half)];

  return (
    <Card className='!rounded-xl' bodyStyle={{ padding: 16 }}>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4'>
        <div>
          <Text strong className='text-base'>
            {t('热门模型')}
          </Text>
          <div className='text-xs semi-text-tertiary mt-0.5'>
            {t(PERIOD_DESCRIPTIONS[period] || PERIOD_DESCRIPTIONS.week)}
          </div>
        </div>
        <div className='flex items-center gap-4'>
          {periodSlot}
          <div className='md:text-right'>
            <span className='font-mono text-xl font-semibold tabular-nums'>
              {formatTokens(totalTokens)}
            </span>
            <span className='text-xs uppercase tracking-widest semi-text-tertiary ml-2'>
              tokens
            </span>
          </div>
        </div>
      </div>
      {chartSpec ? (
        <div className='h-64 sm:h-72 mb-4'>
          <VChart
            className='dashboard-vchart'
            style={{ background: 'transparent' }}
            spec={chartSpec}
            option={CHART_CONFIG}
          />
        </div>
      ) : null}
      {models.length > 0 ? (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-x-8'>
          {columnsList.map((rows, colIndex) => (
            <ul key={colIndex} className='list-none m-0 p-0'>
              {rows.map((row) => (
                <li
                  key={row.model_name}
                  className='grid grid-cols-[2rem_1.25rem_minmax(0,1.6fr)_minmax(0,1fr)_5rem_4rem] items-center gap-2 py-2.5 border-b border-dashed last:border-0'
                  style={{ borderColor: 'var(--semi-color-border)' }}
                >
                  <span className='font-mono text-xs semi-text-tertiary text-right'>
                    {row.rank}.
                  </span>
                  <span className='flex justify-center'>
                    {row.vendor_icon
                      ? getLobeHubIcon(row.vendor_icon, 20)
                      : null}
                  </span>
                  <button
                    type='button'
                    className='text-sm font-medium truncate cursor-pointer hover:underline bg-transparent border-0 p-0 text-left'
                    style={{ color: 'var(--semi-color-primary)' }}
                    onClick={() => navigate('/pricing')}
                    title={row.model_name}
                  >
                    {row.model_name}
                  </button>
                  <span
                    className='text-xs semi-text-tertiary truncate'
                    title={row.vendor}
                  >
                    {row.vendor}
                  </span>
                  <span className='font-mono text-sm tabular-nums whitespace-nowrap text-right'>
                    {formatTokens(row.total_tokens)}
                  </span>
                  <span className='text-right'>
                    <GrowthText value={row.growth_pct} t={t} />
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : (
        <Text type='secondary' className='text-center block py-6'>
          {t('暂无模型用量数据')}
        </Text>
      )}
    </Card>
  );
};

export default ModelsSection;
