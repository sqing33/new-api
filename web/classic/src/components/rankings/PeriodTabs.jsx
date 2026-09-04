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

// 控制台玻璃主题的 CSS 会把 Semi Tabs 的底色与选中态强制置透明,
// 胶囊样式在该环境下不可用,这里用按钮组自行实现周期切换。
const PeriodTabs = ({ periods, labels, active, onChange, t }) => {
  return (
    <div
      className='inline-flex items-center rounded-full p-0.5'
      role='tablist'
      aria-label={t('统计周期')}
      style={{ background: 'var(--semi-color-fill-0)' }}
    >
      {periods.map((period) => {
        const isActive = period === active;
        return (
          <button
            key={period}
            type='button'
            role='tab'
            aria-selected={isActive}
            className='px-3 py-1 rounded-full text-xs cursor-pointer border-0 transition-colors'
            style={
              isActive
                ? {
                    background: 'var(--semi-color-primary)',
                    color: 'var(--semi-color-bg-0)',
                    fontWeight: 600,
                  }
                : {
                    background: 'transparent',
                    color: 'var(--semi-color-text-1)',
                  }
            }
            onClick={() => onChange(period)}
          >
            {t(labels[period])}
          </button>
        );
      })}
    </div>
  );
};

export default PeriodTabs;
