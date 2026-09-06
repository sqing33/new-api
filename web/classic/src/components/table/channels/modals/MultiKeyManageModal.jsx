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

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Button,
  Table,
  Tag,
  Typography,
  Space,
  Tooltip,
  Popconfirm,
  Empty,
  Spin,
  Select,
  Badge,
  Progress,
  InputNumber,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import {
  API,
  showError,
  showSuccess,
  timestamp2string,
} from '../../../../helpers';
import { useChannelKeysPlanQuota } from '../../../../hooks/channels/useChannelKeysPlanQuota';
import { PlanQuotaWindowLine } from '../PlanQuotaCell';
import {
  STATUS_TAG_KEYS,
  getDisplayText,
} from '../../../../hooks/channels/planQuotaFormat';

const { Text } = Typography;

// The channel's settings JSON carries the quota-query binding; an absent,
// empty or "disabled" preset means per-key plan usage can never resolve, so
// the modal shows the same unbound tag as the outer cell and does not query.
const channelPresetBound = (channel) => {
  let presetId = '';
  try {
    presetId = String(
      JSON.parse(channel?.settings || '{}')?.quota_query_preset_id || '',
    ).trim();
  } catch (error) {
    presetId = '';
  }
  return presetId !== '' && presetId !== 'disabled';
};

const MultiKeyManageModal = ({ visible, onCancel, channel, onRefresh }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [keyStatusList, setKeyStatusList] = useState([]);
  const [operationLoading, setOperationLoading] = useState({});
  // key index -> 未提交的优先级草稿；失焦时与服务端值比对后才提交
  const [keyPriorityDrafts, setKeyPriorityDrafts] = useState({});

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Statistics states
  const [enabledCount, setEnabledCount] = useState(0);
  const [manualDisabledCount, setManualDisabledCount] = useState(0);
  const [autoDisabledCount, setAutoDisabledCount] = useState(0);

  // Filter states
  const [statusFilter, setStatusFilter] = useState(null); // null=all, 1=enabled, 2=manual_disabled, 3=auto_disabled

  // Load key status data
  const loadKeyStatus = async (
    page = currentPage,
    size = pageSize,
    status = statusFilter,
  ) => {
    if (!channel?.id) return;

    setLoading(true);
    try {
      const requestData = {
        channel_id: channel.id,
        action: 'get_key_status',
        page: page,
        page_size: size,
      };

      // Add status filter if specified
      if (status !== null) {
        requestData.status = status;
      }

      const res = await API.post('/api/channel/multi_key/manage', requestData);

      if (res.data.success) {
        const data = res.data.data;
        setKeyStatusList(data.keys || []);
        setTotal(data.total || 0);
        setCurrentPage(data.page || 1);
        setPageSize(data.page_size || 10);
        setTotalPages(data.total_pages || 0);

        // Update statistics (these are always the overall statistics)
        setEnabledCount(data.enabled_count || 0);
        setManualDisabledCount(data.manual_disabled_count || 0);
        setAutoDisabledCount(data.auto_disabled_count || 0);
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      console.error(error);
      showError(t('获取密钥状态失败'));
    } finally {
      setLoading(false);
    }
  };

  // Disable a specific key
  const handleDisableKey = async (keyIndex) => {
    const operationId = `disable_${keyIndex}`;
    setOperationLoading((prev) => ({ ...prev, [operationId]: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'disable_key',
        key_index: keyIndex,
      });

      if (res.data.success) {
        showSuccess(t('密钥已禁用'));
        await loadKeyStatus(currentPage, pageSize); // Reload current page
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('禁用密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  // Enable a specific key
  const handleEnableKey = async (keyIndex) => {
    const operationId = `enable_${keyIndex}`;
    setOperationLoading((prev) => ({ ...prev, [operationId]: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'enable_key',
        key_index: keyIndex,
      });

      if (res.data.success) {
        showSuccess(t('密钥已启用'));
        await loadKeyStatus(currentPage, pageSize); // Reload current page
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('启用密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  // Set strict priority of a key (0 = default tier). Larger numbers win;
  // keys of the highest tier serve traffic, lower tiers take over when the
  // whole tier above is disabled.
  const handleSetPriority = async (keyIndex, priority) => {
    const normalized = Math.max(
      0,
      Math.min(100, Math.round(Number(priority) || 0)),
    );
    const operationId = `priority_${keyIndex}`;
    setOperationLoading((prev) => ({ ...prev, [operationId]: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'set_key_priority',
        key_index: keyIndex,
        priority: normalized,
      });

      if (res.data.success) {
        showSuccess(t('密钥优先级已更新'));
        await loadKeyStatus(currentPage, pageSize);
        onRefresh && onRefresh();
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('更新优先级失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  // Enable all disabled keys
  const handleEnableAll = async () => {
    setOperationLoading((prev) => ({ ...prev, enable_all: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'enable_all_keys',
      });

      if (res.data.success) {
        showSuccess(res.data.message || t('已启用所有密钥'));
        // Reset to first page after bulk operation
        setCurrentPage(1);
        await loadKeyStatus(1, pageSize);
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('启用所有密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, enable_all: false }));
    }
  };

  // Disable all enabled keys
  const handleDisableAll = async () => {
    setOperationLoading((prev) => ({ ...prev, disable_all: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'disable_all_keys',
      });

      if (res.data.success) {
        showSuccess(res.data.message || t('已禁用所有密钥'));
        // Reset to first page after bulk operation
        setCurrentPage(1);
        await loadKeyStatus(1, pageSize);
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('禁用所有密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, disable_all: false }));
    }
  };

  // Delete all disabled keys
  const handleDeleteDisabledKeys = async () => {
    setOperationLoading((prev) => ({ ...prev, delete_disabled: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'delete_disabled_keys',
      });

      if (res.data.success) {
        showSuccess(res.data.message);
        // Reset to first page after deletion as data structure might change
        setCurrentPage(1);
        await loadKeyStatus(1, pageSize);
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('删除禁用密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, delete_disabled: false }));
    }
  };

  // Delete a specific key
  const handleDeleteKey = async (keyIndex) => {
    const operationId = `delete_${keyIndex}`;
    setOperationLoading((prev) => ({ ...prev, [operationId]: true }));

    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: channel.id,
        action: 'delete_key',
        key_index: keyIndex,
      });

      if (res.data.success) {
        showSuccess(t('密钥已删除'));
        await loadKeyStatus(currentPage, pageSize); // Reload current page
        onRefresh && onRefresh(); // Refresh parent component
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('删除密钥失败'));
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page);
    loadKeyStatus(page, pageSize);
  };

  // Handle page size change
  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setCurrentPage(1); // Reset to first page
    loadKeyStatus(1, size);
  };

  // Handle status filter change
  const handleStatusFilterChange = (status) => {
    setStatusFilter(status);
    setCurrentPage(1); // Reset to first page when filter changes
    loadKeyStatus(1, pageSize, status);
  };

  // Effect to load data when modal opens
  useEffect(() => {
    if (visible && channel?.id) {
      setCurrentPage(1); // Reset to first page when opening
      loadKeyStatus(1, pageSize);
    }
  }, [visible, channel?.id]);

  // Reset pagination when modal closes
  useEffect(() => {
    if (!visible) {
      setCurrentPage(1);
      setKeyStatusList([]);
      setTotal(0);
      setTotalPages(0);
      setEnabledCount(0);
      setManualDisabledCount(0);
      setAutoDisabledCount(0);
      setStatusFilter(null); // Reset filter
    }
  }, [visible]);

  // Measured height of the table scroll region. The Table component renders a
  // sticky header (~38px) and a bottom pagination (min-height 60px) inside its
  // own wrapper, so the rows area = measured height - 100 (with a 2px safety
  // buffer to guarantee no overflow into the modal max-height). A callback ref
  // wires the ResizeObserver to the actual mount/unmount of the table area,
  // since the Semi Modal only mounts its body while `visible` is true.
  const TABLE_OFFSET = 100;
  const TABLE_BODY_MIN = 120;
  const [tableBodyHeight, setTableBodyHeight] = useState(TABLE_BODY_MIN);
  const measureTableAreaRef = (el) => {
    if (el && typeof ResizeObserver !== 'undefined') {
      const measure = () => {
        const h = el.getBoundingClientRect().height;
        setTableBodyHeight(
          Math.max(TABLE_BODY_MIN, Math.floor(h - TABLE_OFFSET)),
        );
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      el.__resizeObserver = ro;
    } else if (el && el.__resizeObserver) {
      el.__resizeObserver.disconnect();
      el.__resizeObserver = null;
    }
  };

  // Percentages for progress display
  const enabledPercent =
    total > 0 ? Math.round((enabledCount / total) * 100) : 0;
  const manualDisabledPercent =
    total > 0 ? Math.round((manualDisabledCount / total) * 100) : 0;
  const autoDisabledPercent =
    total > 0 ? Math.round((autoDisabledCount / total) * 100) : 0;

  // 取消饼图：不再需要图表数据与配置

  // Get status tag component
  const renderStatusTag = (status) => {
    switch (status) {
      case 1:
        return (
          <Tag color='green' shape='circle' size='small'>
            {t('已启用')}
          </Tag>
        );
      case 2:
        return (
          <Tag color='red' shape='circle' size='small'>
            {t('已禁用')}
          </Tag>
        );
      case 3:
        return (
          <Tag color='orange' shape='circle' size='small'>
            {t('自动禁用')}
          </Tag>
        );
      default:
        return (
          <Tag color='grey' shape='circle' size='small'>
            {t('未知状态')}
          </Tag>
        );
    }
  };

  // Per-key plan usage: requested once for the current page's key indexes
  // via the shared hook (no polling). The request is skipped entirely when
  // no queryable preset is bound — the same unbound tag as the outer cell
  // shows instead, and pagination never retries.
  const presetBound = useMemo(
    () => channelPresetBound(channel),
    [channel?.id, channel?.settings],
  );
  const visibleKeyIndexes = useMemo(
    () =>
      keyStatusList
        .map((key) => Number(key.index))
        .filter((idx) => Number.isInteger(idx) && idx >= 0),
    [keyStatusList],
  );
  const { state: keysUsageState } = useChannelKeysPlanQuota({
    channelId: channel?.id,
    keyIndexes: visibleKeyIndexes,
    enabled: visible && presetBound && visibleKeyIndexes.length > 0,
  });
  const keysUsageByKeyIndex = useMemo(() => {
    const map = new Map();
    const keys = keysUsageState?.data?.keys;
    if (Array.isArray(keys)) {
      keys.forEach((key) => map.set(Number(key.key_index), key));
    }
    return map;
  }, [keysUsageState]);

  const renderPlanUsage = (record) => {
    if (!presetBound) {
      return (
        <Tag color='amber' shape='circle' size='small'>
          {t('No preset bound')}
        </Tag>
      );
    }
    const usage = keysUsageByKeyIndex.get(Number(record.index));
    if (!usage) {
      return keysUsageState.loading ? (
        <Spin size='small' />
      ) : (
        <Text type='quaternary'>-</Text>
      );
    }
    if (usage.status !== 'ok') {
      return (
        <Tag color='red' shape='circle' size='small'>
          {t(STATUS_TAG_KEYS[usage.status] || usage.status || 'Unknown status')}
        </Tag>
      );
    }
    const items = Array.isArray(usage.items) ? usage.items : [];
    if (items.length === 0) {
      return <Text type='quaternary'>-</Text>;
    }
    return (
      <div className='flex flex-col gap-1'>
        {items.map((item, idx) => (
          <PlanQuotaWindowLine
            key={`${getDisplayText(item?.name)}-${idx}`}
            t={t}
            item={item}
          />
        ))}
      </div>
    );
  };

  // Table columns definition
  const columns = [
    {
      title: t('索引'),
      dataIndex: 'index',
      width: 64,
      render: (text) => `#${Number(text) + 1}`,
    },
    // {
    //   title: t('密钥预览'),
    //   dataIndex: 'key_preview',
    //   render: (text) => (
    //     <Text code style={{ fontSize: '12px' }}>
    //       {text}
    //     </Text>
    //   ),
    // },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 90,
      render: (status) => renderStatusTag(status),
    },
    {
      title: t('Plan usage'),
      dataIndex: 'plan_usage',
      width: 180,
      render: (_, record) => renderPlanUsage(record),
    },
    {
      title: t('禁用原因'),
      dataIndex: 'reason',
      width: 200,
      render: (reason, record) => {
        if (record.status === 1 || !reason) {
          return <Text type='quaternary'>-</Text>;
        }
        return (
          <Tooltip content={reason}>
            <Text style={{ maxWidth: '200px', display: 'block' }} ellipsis>
              {reason}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('禁用时间'),
      dataIndex: 'disabled_time',
      width: 110,
      render: (time, record) => {
        if (record.status === 1 || !time) {
          return <Text type='quaternary'>-</Text>;
        }
        const str = timestamp2string(time);
        const datePart = str.slice(0, 10);
        const timePart = str.slice(11);
        return (
          <Tooltip content={str}>
            <div style={{ fontSize: 12, lineHeight: '18px' }}>
              <div>{datePart}</div>
              <div style={{ color: 'var(--semi-color-text-2)' }}>
                {timePart}
              </div>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: t('优先级'),
      dataIndex: 'priority',
      width: 120,
      render: (priority, record) => (
        <Tooltip content={t('数字越大越优先；同优先级随机/轮询；0 为默认')}>
          <InputNumber
            size='small'
            min={0}
            max={100}
            precision={0}
            style={{ width: 90 }}
            value={Number(record.priority) || 0}
            disabled={operationLoading[`priority_${record.index}`]}
            onNumberChange={(value) => {
              // 本地即时暂存，失焦提交见 onBlur
              setKeyPriorityDrafts((prev) => ({
                ...prev,
                [record.index]: value,
              }));
            }}
            onBlur={() => {
              const draft = keyPriorityDrafts[record.index];
              if (draft === undefined) return;
              if ((Number(record.priority) || 0) === draft) return;
              handleSetPriority(record.index, draft);
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: t('操作'),
      key: 'action',
      fixed: 'right',
      width: 150,
      render: (_, record) => (
        <Space>
          {record.status === 1 ? (
            <Button
              type='danger'
              size='small'
              loading={operationLoading[`disable_${record.index}`]}
              onClick={() => handleDisableKey(record.index)}
            >
              {t('禁用')}
            </Button>
          ) : (
            <Button
              type='primary'
              size='small'
              loading={operationLoading[`enable_${record.index}`]}
              onClick={() => handleEnableKey(record.index)}
            >
              {t('启用')}
            </Button>
          )}
          <Popconfirm
            title={t('确定要删除此密钥吗？')}
            content={t('此操作不可撤销，将永久删除该密钥')}
            onConfirm={() => handleDeleteKey(record.index)}
            okType={'danger'}
            position={'topRight'}
          >
            <Button
              type='danger'
              size='small'
              loading={operationLoading[`delete_${record.index}`]}
            >
              {t('删除')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <Text>{t('多密钥管理')}</Text>
          {channel?.name && (
            <Tag size='small' shape='circle' color='white'>
              {channel.name}
            </Tag>
          )}
          <Tag size='small' shape='circle' color='white'>
            {t('总密钥数')}: {total}
          </Tag>
          {channel?.channel_info?.multi_key_mode && (
            <Tag size='small' shape='circle' color='white'>
              {channel.channel_info.multi_key_mode === 'random'
                ? t('随机模式')
                : t('轮询模式')}
            </Tag>
          )}
        </Space>
      }
      visible={visible}
      onCancel={onCancel}
      width={1100}
      style={{ maxHeight: 'calc(100vh - 160px)' }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      footer={null}
    >
      <div className='flex flex-col h-full min-h-0'>
        {/* Compact stats bar: label + progress + fraction on one line, three items in a single bordered bar */}
        <div
          className='rounded-lg mb-2 px-3'
          style={{
            flexShrink: 0,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--semi-color-bg-1)',
            border: '1px solid var(--semi-color-border)',
          }}
        >
          <div className='flex items-center gap-2 flex-1 min-w-0'>
            <Badge dot type='success' />
            <Text
              type='tertiary'
              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {t('已启用')}
            </Text>
            <Progress
              percent={enabledPercent}
              showInfo={false}
              size='small'
              stroke='#22c55e'
              style={{ flex: 1, height: 6, minWidth: 40, marginBottom: 0 }}
            />
            <Text
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#22c55e',
                whiteSpace: 'nowrap',
              }}
            >
              {enabledCount}
            </Text>
            <Text
              type='tertiary'
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              / {total}
            </Text>
          </div>
          <div
            className='flex items-center gap-2 flex-1 min-w-0'
            style={{
              borderLeft: '1px solid var(--semi-color-border)',
              paddingLeft: 12,
            }}
          >
            <Badge dot type='danger' />
            <Text
              type='tertiary'
              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {t('手动禁用')}
            </Text>
            <Progress
              percent={manualDisabledPercent}
              showInfo={false}
              size='small'
              stroke='#ef4444'
              style={{ flex: 1, height: 6, minWidth: 40, marginBottom: 0 }}
            />
            <Text
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#ef4444',
                whiteSpace: 'nowrap',
              }}
            >
              {manualDisabledCount}
            </Text>
            <Text
              type='tertiary'
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              / {total}
            </Text>
          </div>
          <div
            className='flex items-center gap-2 flex-1 min-w-0'
            style={{
              borderLeft: '1px solid var(--semi-color-border)',
              paddingLeft: 12,
            }}
          >
            <Badge dot type='warning' />
            <Text
              type='tertiary'
              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {t('自动禁用')}
            </Text>
            <Progress
              percent={autoDisabledPercent}
              showInfo={false}
              size='small'
              stroke='#f59e0b'
              style={{ flex: 1, height: 6, minWidth: 40, marginBottom: 0 }}
            />
            <Text
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#f59e0b',
                whiteSpace: 'nowrap',
              }}
            >
              {autoDisabledCount}
            </Text>
            <Text
              type='tertiary'
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              / {total}
            </Text>
          </div>
        </div>

        {/* Bordered container: filter/action bar on top, table scroll area below */}
        <div
          className='flex-1 min-h-0 flex flex-col rounded-lg overflow-hidden'
          style={{ border: '1px solid var(--semi-color-border)' }}
        >
          <div
            className='flex items-center justify-between gap-3 px-3'
            style={{
              flexShrink: 0,
              height: 40,
              borderBottom: '1px solid var(--semi-color-border)',
            }}
          >
            <Select
              value={statusFilter}
              onChange={handleStatusFilterChange}
              size='small'
              placeholder={t('全部状态')}
            >
              <Select.Option value={null}>{t('全部状态')}</Select.Option>
              <Select.Option value={1}>{t('已启用')}</Select.Option>
              <Select.Option value={2}>{t('手动禁用')}</Select.Option>
              <Select.Option value={3}>{t('自动禁用')}</Select.Option>
            </Select>
            <Space>
              <Button
                size='small'
                type='tertiary'
                onClick={() => loadKeyStatus(currentPage, pageSize)}
                loading={loading}
              >
                {t('刷新')}
              </Button>
              {manualDisabledCount + autoDisabledCount > 0 && (
                <Popconfirm
                  title={t('确定要启用所有密钥吗？')}
                  onConfirm={handleEnableAll}
                  position={'topRight'}
                >
                  <Button
                    size='small'
                    type='primary'
                    loading={operationLoading.enable_all}
                  >
                    {t('启用全部')}
                  </Button>
                </Popconfirm>
              )}
              {enabledCount > 0 && (
                <Popconfirm
                  title={t('确定要禁用所有的密钥吗？')}
                  onConfirm={handleDisableAll}
                  okType={'danger'}
                  position={'topRight'}
                >
                  <Button
                    size='small'
                    type='danger'
                    loading={operationLoading.disable_all}
                  >
                    {t('禁用全部')}
                  </Button>
                </Popconfirm>
              )}
              <Popconfirm
                title={t('确定要删除所有已自动禁用的密钥吗？')}
                content={t('此操作不可撤销，将永久删除已自动禁用的密钥')}
                onConfirm={handleDeleteDisabledKeys}
                okType={'danger'}
                position={'topRight'}
              >
                <Button
                  size='small'
                  type='warning'
                  loading={operationLoading.delete_disabled}
                >
                  {t('删除自动禁用密钥')}
                </Button>
              </Popconfirm>
            </Space>
          </div>

          <div ref={measureTableAreaRef} className='flex-1 min-h-0'>
            <Table
              columns={columns}
              dataSource={keyStatusList}
              pagination={{
                currentPage: currentPage,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showQuickJumper: true,
                pageSizeOpts: [10, 20, 50, 100],
                onChange: (page, size) => {
                  setCurrentPage(page);
                  loadKeyStatus(page, size);
                },
                onShowSizeChange: (current, size) => {
                  setCurrentPage(1);
                  handlePageSizeChange(size);
                },
              }}
              size='small'
              bordered={false}
              rowKey='index'
              className='flex-1'
              loading={loading}
              scroll={{ x: 'max-content', y: tableBodyHeight }}
              empty={
                <Empty
                  image={
                    <IllustrationNoResult style={{ width: 140, height: 140 }} />
                  }
                  darkModeImage={
                    <IllustrationNoResultDark
                      style={{ width: 140, height: 140 }}
                    />
                  }
                  title={t('暂无密钥数据')}
                  description={t('请检查渠道配置或刷新重试')}
                  style={{ padding: 30 }}
                />
              }
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default MultiKeyManageModal;
