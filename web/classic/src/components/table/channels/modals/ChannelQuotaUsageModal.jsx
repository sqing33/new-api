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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Button,
  Progress,
  Typography,
  Spin,
  Tag,
  Banner,
  Select,
} from '@douyinfe/semi-ui';
import { API, showError } from '../../../../helpers';
import { MOBILE_BREAKPOINT } from '../../../../hooks/common/useIsMobile';

const { Text } = Typography;

const clampPercent = (value) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
};

const pickStrokeColor = (percent) => {
  const p = clampPercent(percent);
  if (p >= 95) return '#ef4444';
  if (p >= 80) return '#f59e0b';
  return '#3b82f6';
};

const formatAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 1000000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

const formatResetTime = (reset) => {
  if (!reset) return null;
  const date = new Date(reset);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
};

const getDisplayText = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const WINDOW_NAME_KEYS = {
  five_hour: '5-hour window',
  weekly_limit: 'Weekly window',
  monthly: 'Monthly window',
  daily: 'Daily window',
  quota_window: 'Quota window',
};

const windowTitle = (name, t) => {
  const key = WINDOW_NAME_KEYS[name];
  return key ? t(key) : getDisplayText(name) || t('Quota window');
};

const STATUS_TAG_KEYS = {
  ok: 'Healthy',
  ready: 'Ready to query',
  needs_configuration: 'Needs configuration',
  unresolved: 'Plan not recognized',
  unsupported: 'Preset does not support query',
  disabled: 'No preset bound',
  authentication_error: 'Authentication failed',
  rate_limited: 'Rate limited',
  timeout: 'Query timed out',
  network_error: 'Network error',
  upstream_error: 'Upstream returned an error',
  response_too_large: 'Response too large',
  invalid_response: 'Failed to parse response',
  cancelled: 'Cancelled',
};

const TRANSIENT_STATUSES = new Set([
  'authentication_error',
  'rate_limited',
  'timeout',
  'network_error',
  'upstream_error',
  'response_too_large',
  'invalid_response',
  'cancelled',
]);

const CONFIG_HINT_STATUSES = new Set([
  'needs_configuration',
  'unresolved',
  'disabled',
  'unsupported',
]);

const MISSING_FIELD_KEYS = {
  key_index: 'Multi-key channel needs a key index selected for query',
  organization_id: 'Missing organization ID (organization_id)',
  project_id: 'Missing project ID (project_id)',
  region: 'Missing region (region)',
  access_key_id: 'Missing Access Key ID',
  secret_access_key: 'Missing Secret Access Key',
  credential: 'Missing separate query credential',
  credential_channel_id:
    'Missing credential channel reference for separate credentials',
  channel_key: 'Channel has no key',
};

const ConfigHint = ({ t, config }) => {
  const missing = Array.isArray(config?.missing_fields)
    ? config.missing_fields
    : [];
  const presetId = getDisplayText(config?.resolved_preset_id);

  return (
    <Banner
      type='warning'
      closeIcon={null}
      className='mb-2'
      description={
        <div className='space-y-1'>
          <div>
            {config?.preset_id === 'auto'
              ? t(
                  'Auto detection failed to recognize a plan from the channel URL, or the detected plan needs more configuration. Bind a preset manually in channel editing.',
                )
              : t(
                  'This channel has no queryable upstream plan bound, or the binding needs more configuration. Set it in "Quota Query Settings" when editing the channel.',
                )}
          </div>
          {presetId ? (
            <div className='text-xs text-semi-color-text-2'>
              {t('Detected: ')}
              {presetId}
            </div>
          ) : null}
          {missing.map((field) => (
            <div key={field} className='text-xs text-semi-color-text-2'>
              {t(MISSING_FIELD_KEYS[field] || field)}
            </div>
          ))}
        </div>
      }
    />
  );
};

const UsageItemCard = ({ t, item }) => {
  const hasPercent =
    item?.percent != null && Number.isFinite(Number(item.percent));
  const percent = hasPercent ? clampPercent(item.percent) : null;
  const remainingPercent =
    !hasPercent &&
    item?.remaining != null &&
    Number.isFinite(Number(item.remaining))
      ? clampPercent(item.remaining)
      : null;
  const hasAmounts = item?.used != null || item?.remaining != null;
  const resetText = formatResetTime(item?.reset);
  const unitText = getDisplayText(item?.unit);

  return (
    <div className='rounded-lg border border-semi-color-border bg-semi-color-bg-0 p-3'>
      <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1'>
        <div className='font-medium'>{windowTitle(item?.name, t)}</div>
        {resetText ? (
          <Text type='tertiary' size='small'>
            {t('Resets at: ')}
            {resetText}
          </Text>
        ) : null}
      </div>

      {percent != null ? (
        <div className='mt-2'>
          <Progress
            percent={percent}
            stroke={pickStrokeColor(percent)}
            showInfo={true}
            format={(p) => `${t('Used: ')}${clampPercent(p)}%`}
          />
        </div>
      ) : (
        <div className='mt-3 text-sm text-semi-color-text-2'>-</div>
      )}

      <div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-semi-color-text-2'>
        {item?.used != null ? (
          <div>
            {t('Used: ')}
            {formatAmount(item.used)}
            {unitText ? ` ${unitText}` : ''}
          </div>
        ) : null}
        {item?.remaining != null ? (
          <div>
            {t('Remaining: ')}
            {formatAmount(item.remaining)}
            {unitText ? ` ${unitText}` : ''}
          </div>
        ) : null}
        {remainingPercent != null ? (
          <div>
            {t('Remaining: ')}
            {remainingPercent}%
          </div>
        ) : null}
      </div>
      {!hasAmounts && percent == null ? (
        <div className='mt-1 text-xs text-semi-color-text-2'>
          {t('The upstream only exposes usage percentages for this window')}
        </div>
      ) : null}
    </div>
  );
};

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;

const getUsageModalLayout = () => {
  if (isMobileViewport()) {
    return {
      width: 'calc(100vw - 16px)',
      style: {
        top: 8,
        maxWidth: 'calc(100vw - 16px)',
        margin: '0 auto',
      },
      bodyStyle: {
        maxHeight: 'calc(100vh - 148px)',
        overflowY: 'auto',
        padding: '16px 16px 12px',
      },
    };
  }

  return {
    width: 720,
    style: {
      top: 24,
      maxWidth: 'min(720px, 92vw)',
    },
    bodyStyle: {
      maxHeight: 'calc(100vh - 172px)',
      overflowY: 'auto',
      padding: '20px 24px 16px',
    },
  };
};

const QuotaUsageView = ({ t, record, usage, config, onRefresh, loading }) => {
  const items = Array.isArray(usage?.items) ? usage.items : [];
  const fetchedAt = formatResetTime(usage?.fetched_at);
  const usageStatus = getDisplayText(usage?.status);
  const statusKey = STATUS_TAG_KEYS[usageStatus] || usageStatus || 'Healthy';
  const showConfigHint =
    config && CONFIG_HINT_STATUSES.has(getDisplayText(config.status));
  const showUsageError =
    !showConfigHint &&
    usage != null &&
    usageStatus !== 'ok' &&
    usageStatus !== '' &&
    (TRANSIENT_STATUSES.has(usageStatus) || !config);

  return (
    <div className='flex flex-col gap-4'>
      {showConfigHint ? <ConfigHint t={t} config={config} /> : null}

      {showUsageError ? (
        <Banner
          type='danger'
          closeIcon={null}
          description={
            getDisplayText(usage?.error) ||
            t(STATUS_TAG_KEYS[usageStatus]) ||
            usageStatus
          }
        />
      ) : null}

      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0 space-y-1'>
          <div className='text-sm font-semibold text-semi-color-text-0'>
            {t('Upstream plan usage')}
          </div>
          <div className='flex flex-wrap items-center gap-2 text-xs text-semi-color-text-2'>
            <span>
              {t('Channel: ')}
              {record?.name || '-'} ({t('ID: ')}
              {record?.id || '-'})
            </span>
            <Tag
              color={
                showConfigHint
                  ? 'amber'
                  : usageStatus === 'ok'
                    ? 'green'
                    : 'grey'
              }
            >
              {t(statusKey)}
            </Tag>
            {usage?.cache_hit === true ? (
              <Tag color='light-blue'>{t('Cached')}</Tag>
            ) : null}
            {fetchedAt ? (
              <span>
                {t('Queried at: ')}
                {fetchedAt}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          size='small'
          type='tertiary'
          theme='outline'
          loading={loading}
          disabled={loading}
          onClick={onRefresh}
        >
          {t('Force refresh')}
        </Button>
      </div>

      {items.length > 0 ? (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          {items.map((item, index) => (
            <UsageItemCard
              key={`${getDisplayText(item?.name)}-${index}`}
              t={t}
              item={item}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const QuotaUsageLoader = ({ t, record }) => {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keyIndex, setKeyIndex] = useState(undefined);
  const mountedRef = useRef(true);
  const recordId = record?.id;
  const channelInfo = record?.channel_info || {};
  const isMultiKey = channelInfo.is_multi_key === true;
  const multiKeySize = Number(channelInfo.multi_key_size) || 0;

  const fetchUsage = useCallback(
    async ({ refresh = false, index } = {}) => {
      if (!recordId) return;
      if (isMultiKey && (index === undefined || index === null)) {
        // Multi-key channel without a selected key: do not query.
        setUsage(null);
        setLoadError(null);
        return;
      }
      setLoading(true);
      setLoadError(null);
      const params = {};
      if (isMultiKey && index !== undefined && index !== null) {
        params.key_index = index;
      }
      try {
        const res = refresh
          ? await API.post(
              `/api/channel/${recordId}/usage`,
              {},
              { params, skipErrorHandler: true },
            )
          : await API.get(`/api/channel/${recordId}/usage`, {
              params,
              skipErrorHandler: true,
            });
        if (!mountedRef.current) return;
        if (res?.data?.success) {
          setUsage(res.data.data ?? null);
        } else {
          setUsage(null);
          setLoadError(
            getDisplayText(res?.data?.message) || 'Failed to fetch plan usage',
          );
        }
      } catch (error) {
        if (!mountedRef.current) return;
        setUsage(null);
        setLoadError('Failed to fetch plan usage');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [recordId, isMultiKey],
  );

  const fetchConfig = useCallback(
    async (index) => {
      if (!recordId) return;
      const params = {};
      if (index !== undefined && index !== null) {
        params.key_index = index;
      }
      try {
        const res = await API.get(`/api/channel/${recordId}/usage/config`, {
          params,
          skipErrorHandler: true,
        });
        if (mountedRef.current && res?.data?.success) {
          setConfig(res.data.data ?? null);
        }
      } catch (error) {
        // config hint is optional decoration
      }
    },
    [recordId],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isMultiKey) {
      // Wait for the admin to pick a key before issuing any query.
      setUsage(null);
      setConfig(null);
      setLoadError(null);
      return;
    }
    fetchConfig(undefined);
    fetchUsage({ index: undefined });
  }, [fetchUsage, fetchConfig, isMultiKey]);

  const handleKeyIndexChange = (value) => {
    setKeyIndex(value);
    if (value === undefined || value === null) {
      setUsage(null);
      setConfig(null);
      return;
    }
    fetchConfig(value);
    fetchUsage({ index: value });
  };

  if (loading && usage == null && !isMultiKey) {
    return (
      <div className='flex items-center justify-center py-10'>
        <Spin spinning={true} size='large' tip={t('Loading...')} />
      </div>
    );
  }

  if (isMultiKey && (keyIndex === undefined || keyIndex === null)) {
    return (
      <div className='flex flex-col gap-3'>
        <div className='text-sm text-semi-color-text-1'>
          {t(
            'This is a multi-key channel. Select the key to query before viewing its plan usage.',
          )}
        </div>
        <div className='flex items-center gap-2'>
          <Select
            placeholder={t('Select key index')}
            style={{ width: 240 }}
            data={Array.from({ length: multiKeySize }, (_, i) => ({
              value: i,
              label: t('Key {{index}}', { index: i + 1 }),
            }))}
            value={keyIndex}
            onChange={handleKeyIndexChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      {isMultiKey ? (
        <div className='flex items-center gap-2'>
          <Text type='tertiary' size='small'>
            {t('Query key: ')}
          </Text>
          <Select
            style={{ width: 200 }}
            data={Array.from({ length: multiKeySize }, (_, i) => ({
              value: i,
              label: t('Key {{index}}', { index: i + 1 }),
            }))}
            value={keyIndex}
            onChange={handleKeyIndexChange}
            size='small'
          />
        </div>
      ) : null}
      {loadError ? (
        <Banner type='danger' closeIcon={null} description={t(loadError)} />
      ) : null}
      <QuotaUsageView
        t={t}
        record={record}
        usage={usage}
        config={config}
        loading={loading}
        onRefresh={() => fetchUsage({ refresh: true, index: keyIndex })}
      />
    </div>
  );
};

export const openChannelQuotaUsageModal = ({ t, record }) => {
  const layout = getUsageModalLayout();

  Modal.info({
    title: t('Upstream plan usage'),
    centered: false,
    width: layout.width,
    style: layout.style,
    bodyStyle: layout.bodyStyle,
    content: <QuotaUsageLoader t={t} record={record} />,
    footer: (
      <div className='flex justify-end gap-2'>
        <Button type='primary' theme='solid' onClick={() => Modal.destroyAll()}>
          {t('Close')}
        </Button>
      </div>
    ),
  });
};
