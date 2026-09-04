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
import { Card, Typography } from '@douyinfe/semi-ui';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getLobeHubIcon } from '../../helpers';

const { Text } = Typography;

const MoverRow = ({ mover, up, onModelClick }) => {
  return (
    <li
      className='grid grid-cols-[1.25rem_minmax(0,1.6fr)_minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 py-2.5 border-b border-dashed last:border-0'
      style={{ borderColor: 'var(--semi-color-border)' }}
    >
      <span className='flex justify-center'>
        {mover.vendor_icon ? getLobeHubIcon(mover.vendor_icon, 20) : null}
      </span>
      <button
        type='button'
        className='font-mono text-xs truncate cursor-pointer bg-transparent border-0 p-0 text-left hover:underline'
        style={{ color: 'var(--semi-color-primary)' }}
        onClick={() => onModelClick?.(mover)}
        title={mover.model_name}
      >
        {mover.model_name}
      </button>
      <span
        className='text-xs semi-text-tertiary truncate'
        title={mover.vendor}
      >
        {mover.vendor}
      </span>
      <span className='font-mono text-xs semi-text-tertiary text-right whitespace-nowrap'>
        #{mover.current_rank}
      </span>
      <span
        className='font-mono text-xs text-right whitespace-nowrap'
        style={{
          color: up ? 'var(--semi-color-success)' : 'var(--semi-color-danger)',
        }}
      >
        {up ? '↑' : '↓'}
        {Math.abs(mover.rank_delta)}
      </span>
    </li>
  );
};

const PulseSection = ({ data, t }) => {
  const navigate = useNavigate();
  const movers = data?.top_movers || [];
  const droppers = data?.top_droppers || [];

  return (
    <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
      <Card className='!rounded-xl' bodyStyle={{ padding: 16 }}>
        <div className='mb-2 flex items-center gap-2'>
          <TrendingUp
            size={18}
            color='var(--semi-color-success)'
            aria-hidden='true'
          />
          <div>
            <Text strong className='text-base'>
              {t('上升榜')}
            </Text>
            <div className='text-xs semi-text-tertiary'>
              {t('排名正在上升的模型')}
            </div>
          </div>
        </div>
        {movers.length > 0 ? (
          <ul className='list-none m-0 p-0'>
            {movers.map((mover) => (
              <MoverRow
                key={mover.model_name}
                mover={mover}
                up
                onModelClick={() => navigate('/pricing')}
              />
            ))}
          </ul>
        ) : (
          <Text type='secondary' className='text-center block py-6'>
            {t('暂无明显上升的模型')}
          </Text>
        )}
      </Card>
      <Card className='!rounded-xl' bodyStyle={{ padding: 16 }}>
        <div className='mb-2 flex items-center gap-2'>
          <TrendingDown
            size={18}
            color='var(--semi-color-danger)'
            aria-hidden='true'
          />
          <div>
            <Text strong className='text-base'>
              {t('下降榜')}
            </Text>
            <div className='text-xs semi-text-tertiary'>
              {t('排名正在下滑的模型')}
            </div>
          </div>
        </div>
        {droppers.length > 0 ? (
          <ul className='list-none m-0 p-0'>
            {droppers.map((mover) => (
              <MoverRow
                key={mover.model_name}
                mover={mover}
                up={false}
                onModelClick={() => navigate('/pricing')}
              />
            ))}
          </ul>
        ) : (
          <Text type='secondary' className='text-center block py-6'>
            {t('暂无明显下滑的模型')}
          </Text>
        )}
      </Card>
    </div>
  );
};

export default PulseSection;
