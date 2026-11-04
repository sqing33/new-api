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

import React, { useState } from 'react';
import { Button, Checkbox, Popover, Typography } from '@douyinfe/semi-ui';
import { IconSort } from '@douyinfe/semi-icons';

// 渠道列表的排序入口：4 个维度收进一个弹层，拖拽顺序即优先级。
//
// 为什么「可以勾多个但只生效一个」：后端 ChannelSortOptions.SortBy 是单值，
// 只能下发一个 ORDER BY；而套餐用量是纯前端页内排序，与后端排序叠加会产生
// 「页内一个序、页间另一个序」的撕裂结果。所以勾选多个时，按拖拽顺序取第一个
// 启用的维度，其余静默忽略，并在弹层底部显式说明当前生效的是哪一个。
const ChannelSortPriorityPopover = ({
  order,
  items,
  enabled,
  activeKey,
  onToggle,
  onReorder,
  t,
}) => {
  const [visible, setVisible] = useState(false);
  const [draggedKey, setDraggedKey] = useState('');
  const [dragOverKey, setDragOverKey] = useState('');
  const [dragOverPosition, setDragOverPosition] = useState('before');

  const resetDragState = () => {
    setDraggedKey('');
    setDragOverKey('');
    setDragOverPosition('before');
  };

  const handleDragStart = (event, key) => {
    setDraggedKey(key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  };

  const handleDragOver = (event, key) => {
    event.preventDefault();
    if (!draggedKey || draggedKey === key) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setDragOverKey(key);
    setDragOverPosition(
      event.clientY - rect.top > rect.height / 2 ? 'after' : 'before',
    );
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event, key) => {
    event.preventDefault();
    const sourceKey = draggedKey || event.dataTransfer.getData('text/plain');
    const position = dragOverKey === key ? dragOverPosition : 'before';
    onReorder(sourceKey, key, position);
    resetDragState();
  };

  const enabledCount = order.filter((key) => enabled[key]).length;
  const activeLabel = activeKey ? items[activeKey].label : t('无');

  const content = (
    <div className='p-2 w-[240px]'>
      <div className='text-xs text-[var(--semi-color-text-2)] mb-2'>
        {t('拖动调整优先级')}
      </div>
      <div className='flex flex-col'>
        {order.map((key) => {
          const isDragTarget = dragOverKey === key && draggedKey !== key;
          return (
            <div
              key={key}
              draggable
              onDragStart={(event) => handleDragStart(event, key)}
              onDragOver={(event) => handleDragOver(event, key)}
              onDrop={(event) => handleDrop(event, key)}
              onDragEnd={resetDragState}
              className='flex items-center gap-2 px-2 py-1.5 rounded cursor-move select-none'
              style={{
                background: enabled[key]
                  ? 'var(--semi-color-fill-0)'
                  : 'transparent',
                borderTop:
                  isDragTarget && dragOverPosition === 'before'
                    ? '2px solid var(--semi-color-primary)'
                    : '2px solid transparent',
                borderBottom:
                  isDragTarget && dragOverPosition === 'after'
                    ? '2px solid var(--semi-color-primary)'
                    : '2px solid transparent',
              }}
            >
              <Checkbox
                checked={!!enabled[key]}
                onChange={(checked) => onToggle(key, checked)}
              />
              <span className='text-sm'>{t(items[key].label)}</span>
            </div>
          );
        })}
      </div>
      <div className='mt-2 pt-2 border-t border-[var(--semi-color-border)] text-xs text-[var(--semi-color-text-2)]'>
        {t('当前生效')}
        {': '}
        <span className='text-[var(--semi-color-text-0)]'>
          {t(activeLabel)}
        </span>
        {enabledCount > 1 && (
          <span>
            {'（'}
            {t('其余已忽略')}
            {'）'}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      position='bottomRight'
      trigger='click'
      visible={visible}
      onVisibleChange={setVisible}
      content={content}
      showArrow
    >
      <Button
        icon={<IconSort />}
        size='small'
        theme={activeKey ? 'solid' : 'borderless'}
        type={activeKey ? 'primary' : 'tertiary'}
      >
        <Typography.Text
          className='text-xs'
          style={{
            color: activeKey
              ? 'var(--semi-color-bg-0)'
              : 'var(--semi-color-text-1)',
          }}
        >
          {t('排序优先级')}
        </Typography.Text>
      </Button>
    </Popover>
  );
};

export default ChannelSortPriorityPopover;
