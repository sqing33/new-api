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

import React, { useEffect } from 'react';
import { Progress, Spin, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import { useChannelPlanQuota } from '../../../hooks/channels/useChannelPlanQuota';
import { useChannelKeysPlanQuota } from '../../../hooks/channels/useChannelKeysPlanQuota';
import {
  planQuotaSortValueFromWindows,
  recordChannelSortValue,
} from '../../../hooks/channels/planQuotaRegistry';
import {
  aggregateKeyWindows,
  aggregateTooltipKeyLines,
  clampPercent,
  formatAmount,
  formatResetShort,
  formatResetTime,
  pickStrokeColor,
  resolveWindowUsedPercent,
  statusTagText,
  windowTitle,
  windowTooltipLines,
  getDisplayText,
} from '../../../hooks/channels/planQuotaFormat';

const { Text } = Typography;

// Fixed-width right-aligned percent: reserving room for three digits keeps
// the bar length stable between 10% and 100% (tabular digits, no reflow).
const percentSpanStyle = {
  minWidth: '4ch',
  fontVariantNumeric: 'tabular-nums',
};

// One usage window per line. Row 1: the window title (truncated) on the
// left, the compact reset time (`MM-DD HH:mm`, localized Reset suffix) on
// the right. Row 2: a full-width progress bar plus a fixed-width right
// aligned bare percent (`NN%`, no "Used: " prefix) so the bar length never
// changes between 10% and 100%. `remaining` is an absolute unit-qualified
// amount, never a percentage, so no bar and no percent text are fabricated
// from it. The tooltip carries the amounts, remaining%, the full reset time
// and unit. A missing or unparseable reset renders nothing — no reset is
// ever guessed.
export const PlanQuotaWindowLine = ({ t, item, tooltipExtraLines }) => {
  const usedPercent = resolveWindowUsedPercent(item);
  const resetShort = formatResetShort(item?.reset);
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
          {(tooltipExtraLines || []).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      }
      trigger='hover'
      position='top'
    >
      <div className='w-full'>
        <div className='flex items-center justify-between gap-2 text-xs'>
          <span className='truncate text-semi-color-text-1'>{title}</span>
          {resetShort ? (
            <span className='shrink-0 text-xs text-semi-color-text-2'>
              {resetShort} {t('Reset')}
            </span>
          ) : null}
        </div>
        {usedPercent != null ? (
          <div className='mt-1 flex items-center gap-2'>
            <div className='min-w-0 flex-1'>
              <Progress
                percent={clampPercent(usedPercent)}
                stroke={pickStrokeColor(usedPercent)}
                showInfo={false}
                aria-label={title}
                strokeWidth={3}
              />
            </div>
            <span
              className='inline-block shrink-0 text-right text-xs font-medium text-semi-color-text-1'
              style={percentSpanStyle}
            >
              {usedPercent}%
            </span>
          </div>
        ) : null}
      </div>
    </Tooltip>
  );
};

// Amounts-only line for an aggregated window with no derivable percent: the
// same two-row layout — title with the compact reset on row 1, the summed
// used/remaining as text on row 2 — but no bar and no fabricated 0%.
const AggregateAmountLine = ({ t, item }) => {
  const resetShort = formatResetShort(item?.reset);
  const title = windowTitle(item?.name, t);
  const unitText = getDisplayText(item?.unit);
  const parts = [];
  if (item?.used != null) {
    parts.push(`${t('Used: ')}${formatAmount(item.used)}`);
  }
  if (item?.remaining != null) {
    parts.push(`${t('Remaining: ')}${formatAmount(item.remaining)}`);
  }
  return (
    <div className='w-full text-xs'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-semi-color-text-1'>{title}</span>
        {resetShort ? (
          <span className='shrink-0 text-xs text-semi-color-text-2'>
            {resetShort} {t('Reset')}
          </span>
        ) : null}
      </div>
      <div className='mt-1 text-right font-medium text-semi-color-text-1'>
        {parts.length ? (
          <span>
            {parts.join(' / ')}
            {unitText ? ` ${unitText}` : ''}
          </span>
        ) : (
          <span className='text-semi-color-text-2'>{t('Not provided')}</span>
        )}
      </div>
    </div>
  );
};

// Multi-key body: one GET /usage/keys scan (all keys) whose per-key results
// are aggregated per window name — summed used/remaining, sum-derived
// percent (or the per-key percent average for percent-only upstreams),
// earliest reset. The tooltip lists the per-key lines (capped). A channel
// whose preset is not queryable shows the same unbound tag as the
// single-key cell and never retries.
const MultiKeyPlanQuotaCell = ({ t, record }) => {
  const { state } = useChannelKeysPlanQuota({
    channelId: record?.id,
    keyIndexes: null,
    enabled: true,
  });

  const usage = state.data;
  const perKeyResults = Array.isArray(usage?.keys) ? usage.keys : [];
  const anyOk = perKeyResults.some((key) => key?.status === 'ok');

  // Report the aggregated remaining metric so the table can sort by plan
  // usage once the cells have their data.
  useEffect(() => {
    if (state.status !== 'ok' || !anyOk) return;
    recordChannelSortValue(
      record?.id,
      planQuotaSortValueFromWindows(aggregateKeyWindows(perKeyResults)),
    );
  }, [state.status, record?.id, anyOk, usage]);

  if (state.loading && !state.data) {
    return <Spin size='small' />;
  }
  if (state.status === 'error') {
    return (
      <Tag color='red' shape='circle'>
        {t(state.error || 'Failed to fetch plan usage')}
      </Tag>
    );
  }
  if (!anyOk) {
    // Unbound / not queryable preset: same tag as the single-key cell.
    const status = getDisplayText(perKeyResults[0]?.status) || 'disabled';
    return (
      <Tag color='amber' shape='circle'>
        {t(
          {
            disabled: 'No preset bound',
            needs_configuration: 'Needs configuration',
            unresolved: 'Plan not recognized',
            unsupported: 'Preset does not support query',
          }[status] || status,
        )}
      </Tag>
    );
  }
  const windows = aggregateKeyWindows(perKeyResults);
  return (
    <div className='flex flex-col gap-1'>
      {windows.map((item, index) =>
        item.percent != null ? (
          <PlanQuotaWindowLine
            key={`${item.name}-${index}`}
            t={t}
            item={item}
            tooltipExtraLines={aggregateTooltipKeyLines(
              perKeyResults,
              item.name,
              t,
            )}
          />
        ) : (
          <AggregateAmountLine
            key={`${item.name}-${index}`}
            t={t}
            item={item}
          />
        ),
      )}
    </div>
  );
};

// Cell body for one channel row. Single-key channels render one thin progress
// line per returned window item; multi-key channels render the aggregated
// per-window totals of an all-keys scan. A successful query
// (`status: 'ok'`) renders usage only — no status tag. The auto GET is
// scheduled by the hooks' mounted effects; no network happens during render.
export const PlanQuotaCell = ({ t, record, visible }) => {
  const channelInfo = record?.channel_info || {};
  const isMultiKey = channelInfo.is_multi_key === true;

  const enabled = visible === true && !!record?.id;
  const { state } = useChannelPlanQuota({
    record,
    keyIndex: null,
    enabled: enabled && !isMultiKey,
  });

  const usage = state.data;
  const items = Array.isArray(usage?.items) ? usage.items : [];

  // Report the five-hour remaining metric so the table can sort by plan
  // usage once the cell has its data. Hooks stay above every early return.
  useEffect(() => {
    if (!enabled || isMultiKey || state.status !== 'ok') return;
    recordChannelSortValue(record?.id, planQuotaSortValueFromWindows(items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, record?.id, usage, enabled, isMultiKey]);

  if (!enabled) {
    return <span className='text-semi-color-text-2'>-</span>;
  }

  if (isMultiKey) {
    return (
      <div className='flex flex-col gap-1' onClick={(e) => e.stopPropagation()}>
        <MultiKeyPlanQuotaCell t={t} record={record} />
      </div>
    );
  }

  const usageStatus = getDisplayText(usage?.status);
  const isError = state.status === 'error';
  const isPending = state.loading === true;

  const isConfigIssue =
    !isError &&
    ['needs_configuration', 'unresolved', 'unsupported', 'disabled'].includes(
      usageStatus,
    );
  // A successful query with no problem to report shows usage only: the tag
  // is suppressed for `ok` (and while loading). Errors and configuration
  // problems keep their tag.
  const statusNode = isError ? (
    <Tag color='red' shape='circle'>
      {t(state.error || 'Failed to fetch plan usage')}
    </Tag>
  ) : usageStatus === '' || usageStatus === 'ok' ? null : (
    <Tag color={isConfigIssue ? 'amber' : 'grey'} shape='circle'>
      {statusTagText(usage, t)}
    </Tag>
  );

  return (
    <div className='flex flex-col gap-1' onClick={(e) => e.stopPropagation()}>
      {isPending && items.length === 0 ? <Spin size='small' /> : null}
      {statusNode}
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
