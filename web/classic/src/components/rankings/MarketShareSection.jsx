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
import { buildVendorColorMap, formatShare, formatTokens } from './format';

const { Text } = Typography;

const PERIOD_DESCRIPTIONS = {
  today: '最近 24 小时模型作者的 token 占比',
  week: '过去数周模型作者的 token 占比',
  month: '过去一个月模型作者的 token 占比',
  year: '过去一年模型作者的 token 占比',
};

const MarketShareSection = ({ data, period, t }) => {
  const navigate = useNavigate();
  const history = data?.vendor_share_history || { points: [], vendors: [] };
  const vendors = data?.vendors || [];

  const colorMap = useMemo(() => {
    const names = (history.vendors || []).map((v) => v.name);
    return buildVendorColorMap(names);
  }, [history.vendors]);

  const chartSpec = useMemo(() => {
    const points = history.points || [];
    if (points.length === 0) return null;
    // 时间点形如 "Aug 28",tooltip 标题转成中文"8月28日"
    const formatLabel = (label) => {
      const parsed = new Date(`${label} ${new Date().getFullYear()}`);
      if (Number.isNaN(parsed.getTime())) return label;
      const now = new Date();
      const sameYear = parsed.getFullYear() === now.getFullYear();
      const text = `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
      return sameYear ? text : `${parsed.getFullYear()}年${text}`;
    };
    return {
      type: 'bar',
      data: [{ id: 'vendorShareHistoryData', values: points }],
      xField: 'label',
      yField: 'share',
      seriesField: 'vendor',
      stack: true,
      padding: 'auto',
      color: { specified: colorMap },
      categoryAxis: {
        label: {
          autoHide: true,
          autoRotate: false,
          formatMethod: (value) => formatLabel(value),
          style: { fontSize: 10 },
        },
        line: false,
        tick: false,
      },
      valueAxis: {
        max: 1,
        percent: true,
        label: { style: { fontSize: 10 } },
      },
      legend: { visible: false },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum) => datum['vendor'],
              value: (datum) => formatShare(datum['share']),
            },
          ],
        },
        dimension: {
          title: (datum) => formatLabel(datum?.['label']),
          content: [
            {
              key: (datum) => datum['vendor'],
              value: (datum) => formatShare(datum['share']),
            },
          ],
          updateContent: (array) => {
            array.sort((a, b) => b.value - a.value);
            return array;
          },
        },
      },
      bar: {
        columnWidthRatio: 0.6,
        seriesGapWidth: 1,
      },
    };
  }, [history.points, colorMap]);

  return (
    <Card className='!rounded-xl' bodyStyle={{ padding: 16 }}>
      <div className='mb-4'>
        <Text strong className='text-base'>
          {t('市场份额')}
        </Text>
        <div className='text-xs semi-text-tertiary mt-0.5'>
          {t(PERIOD_DESCRIPTIONS[period] || PERIOD_DESCRIPTIONS.week)}
        </div>
      </div>
      {chartSpec ? (
        <div className='h-56 sm:h-64 mb-4'>
          <VChart
            style={{ background: 'transparent' }}
            spec={chartSpec}
            option={CHART_CONFIG}
          />
        </div>
      ) : null}
      {vendors.length > 0 ? (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-x-8'>
          <ul className='list-none m-0 p-0'>
            {vendors.slice(0, 6).map((vendor) => (
              <VendorRow
                key={vendor.vendor}
                vendor={vendor}
                t={t}
                onVendorClick={() => navigate('/pricing')}
              />
            ))}
          </ul>
          <ul className='list-none m-0 p-0'>
            {vendors.slice(6).map((vendor) => (
              <VendorRow
                key={vendor.vendor}
                vendor={vendor}
                t={t}
                onVendorClick={() => navigate('/pricing')}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
};

const VendorRow = ({ vendor, t, onVendorClick }) => {
  return (
    <li
      className='flex items-center gap-3 py-2.5 border-b border-dashed last:border-0'
      style={{ borderColor: 'var(--semi-color-border)' }}
    >
      <span className='font-mono text-xs semi-text-tertiary w-6 text-right shrink-0'>
        {vendor.rank}.
      </span>
      {vendor.vendor_icon ? getLobeHubIcon(vendor.vendor_icon, 20) : null}
      <button
        type='button'
        className='max-w-40 truncate cursor-pointer bg-transparent border-0 p-0 text-left text-sm'
        style={{ color: 'var(--semi-color-primary)' }}
        onClick={() => onVendorClick?.(vendor)}
        title={vendor.vendor}
      >
        {vendor.vendor}
      </button>
      <span className='text-xs semi-text-tertiary whitespace-nowrap'>
        {formatShare(vendor.share)}
      </span>
      {vendor.top_model ? (
        <span
          className='text-xs semi-text-tertiary truncate'
          title={`${t('最热模型')}：${vendor.top_model}`}
        >
          {vendor.top_model}
        </span>
      ) : null}
      <span className='ml-auto font-mono text-sm tabular-nums whitespace-nowrap'>
        {formatTokens(vendor.total_tokens)}
      </span>
    </li>
  );
};

export default MarketShareSection;
