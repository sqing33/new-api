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

import React, { useEffect, useState } from 'react';
import {
  Button,
  Progress,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useChannelPlanQuota } from '../../../hooks/channels/useChannelPlanQuota';
import {
  clampPercent,
  pickStrokeColor,
  resolveWindowUsedPercent,
  statusTagText,
  windowTitle,
  windowTooltipLines,
  getDisplayText,
} from '../../../hooks/channels/planQuotaFormat';

const { Text } = Typography;

// One usage window per line: thin progress bar (only when the upstream
// exposes a `percent`) plus the explicit used percentage. `remaining` is an
// absolute unit-qualified amount, never a percentage, so no bar and no
// percent text are fabricated from it. The tooltip carries the amounts,
// remaining%, reset time and unit.
const PlanQuotaWindowLine = ({ t, item }) => {
  const usedPercent = resolveWindowUsedPercent(item);
  const title = windowTitle(item?.name, t);
  const tooltipLines = windowTooltipLines(item, t);

  return (
    <Tooltip
      content={
        <div className='flex flex-col gap-1'>
          {tooltipLines.length > 0 ? (
            tooltipLines.map((line) => <div key={line}>{line}</div>)
          ) : (
            <div>
              {t('The upstream only exposes usage percentages for this window')}
            </div>
          )}
        </div>
      }
      trigger='hover'
      position='top'
    >
      <div className='w-full'>
        <div className='flex items-center justify-between gap-2 text-xs'>
          <span className='truncate text-semi-color-text-1'>{title}</span>
          <span className='shrink-0 font-medium text-semi-color-text-1'>
            {usedPercent != null
              ? `${t('Used: ')}${usedPercent}%`
              : t('Not provided')}
          </span>
        </div>
        {usedPercent != null ? (
          <Progress
            percent={clampPercent(usedPercent)}
            stroke={pickStrokeColor(usedPercent)}
            showInfo={false}
            aria-label={title}
            strokeWidth={3}
            className='mt-1'
          />
        ) : null}
      </div>
    </Tooltip>
  );
};

const KeyIndexSelect = ({ t, multiKeySize, keyIndex, onChange }) => (
  <Select
    placeholder={t('Select key index')}
    style={{ width: 150 }}
    size='small'
    data={Array.from({ length: multiKeySize }, (_, i) => ({
      value: i,
      label: t('Key {{index}}', { index: i + 1 }),
    }))}
    value={keyIndex}
    onChange={onChange}
  />
);

// Cell body for one channel row. Renders the inline key select for multi-key
// channels (no query until a key is chosen) and one thin progress line per
// returned window item. The auto GET is scheduled by the hook's mounted
// effect; no network happens during render.
export const PlanQuotaCell = ({ t, record, visible }) => {
  const channelInfo = record?.channel_info || {};
  const isMultiKey = channelInfo.is_multi_key === true;
  const multiKeySize = Number(channelInfo.multi_key_size) || 0;
  const [keyIndex, setKeyIndex] = useState(null);

  const enabled = visible === true && !!record?.id;
  const queryEnabled = enabled && (!isMultiKey || keyIndex != null);
  const effectiveKeyIndex = isMultiKey ? keyIndex : null;
  const { state, refresh } = useChannelPlanQuota({
    record,
    keyIndex: effectiveKeyIndex,
    enabled: queryEnabled,
  });

  const handleKeyIndexChange = (value) => {
    setKeyIndex(value);
  };

  if (!enabled) {
    return <span className='text-semi-color-text-2'>-</span>;
  }

  if (isMultiKey && keyIndex == null) {
    return (
      // Tag-parent rows never reach the hook's effect; the select itself must
      // not trigger the row click handler.
      <div onClick={(e) => e.stopPropagation()}>
        <KeyIndexSelect
          t={t}
          multiKeySize={multiKeySize}
          keyIndex={keyIndex}
          onChange={handleKeyIndexChange}
        />
      </div>
    );
  }

  const usage = state.data;
  const items = Array.isArray(usage?.items) ? usage.items : [];
  const usageStatus = getDisplayText(usage?.status);
  const isError = state.status === 'error';
  const isPending = state.loading;
  const isConfigIssue =
    !isError &&
    ['needs_configuration', 'unresolved', 'unsupported', 'disabled'].includes(
      usageStatus,
    );
  const tagColor = isError
    ? 'red'
    : isConfigIssue
      ? 'amber'
      : usageStatus === 'ok'
        ? 'green'
        : 'grey';

  return (
    <div className='flex flex-col gap-1' onClick={(e) => e.stopPropagation()}>
      <div className='flex items-center gap-2'>
        <Tag color={tagColor} shape='circle'>
          {isError
            ? t(state.error || 'Failed to fetch plan usage')
            : statusTagText(usage, t)}
        </Tag>
        <Tooltip content={t('Force refresh')} position='top'>
          <Button
            size='small'
            type='tertiary'
            icon={<IconRefresh />}
            loading={isPending}
            disabled={isPending}
            onClick={refresh}
            aria-label={t('Force refresh')}
          />
        </Tooltip>
        {isMultiKey ? (
          <KeyIndexSelect
            t={t}
            multiKeySize={multiKeySize}
            keyIndex={keyIndex}
            onChange={handleKeyIndexChange}
          />
        ) : null}
      </div>
      {isPending && items.length === 0 ? <Spin size='small' /> : null}
      {items.map((item, index) => (
        <PlanQuotaWindowLine
          key={`${getDisplayText(item?.name)}-${index}`}
          t={t}
          item={item}
        />
      ))}
      {usage?.cache_hit === true ? (
        <Text type='tertiary' size='small'>
          {t('Cached')}
        </Text>
      ) : null}
    </div>
  );
};
