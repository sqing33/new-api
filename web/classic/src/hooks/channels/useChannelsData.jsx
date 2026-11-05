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

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API,
  showError,
  showInfo,
  showSuccess,
  loadChannelModels,
  copy,
  toBoolean,
} from '../../helpers';
import {
  CHANNEL_OPTIONS,
  ITEMS_PER_PAGE,
  MODEL_TABLE_PAGE_SIZE,
} from '../../constants';
import { useIsMobile } from '../common/useIsMobile';
import { useTableCompactMode } from '../common/useTableCompactMode';
import { useChannelUpstreamUpdates } from './useChannelUpstreamUpdates';
import { useChannelUpstreamPricing } from './useChannelUpstreamPricing';
import { parseUpstreamUpdateMeta } from './upstreamUpdateUtils';
import {
  getChannelSortValue,
  getPlanQuotaRegistryVersion,
  subscribePlanQuotaRegistry,
} from './planQuotaRegistry';
import { Modal, Button } from '@douyinfe/semi-ui';
import { openCodexUsageModal } from '../../components/table/channels/modals/CodexUsageModal';

// 名称排序与并发排序各自使用独立 storage key，避免与其他页面的开关互相串扰
const CHANNEL_NAME_SORT_KEY = 'channels-name-sort';
const CHANNEL_CONCURRENCY_SORT_KEY = 'channels-concurrency-sort';
// 排序优先级的顺序单独存一个 key：4 个布尔 key 已被多处读写，
// 只加顺序 key 可以天然兼容老用户（无该 key 时回退默认顺序）。
const CHANNEL_SORT_ORDER_KEY = 'channels-sort-order';

// 排序维度。顺序完全由拖动决定：排在前面的优先参与排序，不再有勾选开关。
export const CHANNEL_SORT_DEFAULT_ORDER = [
  'plan_usage',
  'concurrency',
  'id',
  'name',
];

// 生效的排序级数：拖动顺序的前 N 个维度真正参与排序。
// 与后端 model.ChannelSortMaxLevels 保持一致。
export const CHANNEL_SORT_APPLY_COUNT = 2;

// 读回排序顺序并做容错：元素必须合法、去重、补齐缺失项。
// 顺序被写坏时不能让工具栏整个消失，所以任何异常都回退默认顺序。
export const parseChannelSortOrder = (raw) => {
  if (!raw) return [...CHANNEL_SORT_DEFAULT_ORDER];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...CHANNEL_SORT_DEFAULT_ORDER];
    const seen = new Set();
    const order = [];
    for (const item of parsed) {
      if (
        CHANNEL_SORT_DEFAULT_ORDER.includes(item) &&
        !seen.has(item)
      ) {
        seen.add(item);
        order.push(item);
      }
    }
    for (const item of CHANNEL_SORT_DEFAULT_ORDER) {
      if (!seen.has(item)) {
        order.push(item);
      }
    }
    return order;
  } catch (e) {
    console.error('Failed to parse saved channel sort order', e);
    return [...CHANNEL_SORT_DEFAULT_ORDER];
  }
};

// 排序链 = 拖动顺序的前 N 个维度。不依赖任何勾选状态，
// 所以刷新后只要顺序还在，排序效果就完全恢复。
export const pickActiveChannelSort = (order) =>
  order.slice(0, CHANNEL_SORT_APPLY_COUNT);

// 套餐用量是纯前端页内排序（数据来自异步上报，不在数据库里），
// 无法与任何后端维度叠加：它排在链首时由它完全接管排序。
const isPlanUsageFirst = (chain) => chain[0] === 'plan_usage';

// 把排序链转成后端参数。
// - plan_usage 打头：页内排序，不下发后端参数
// - id：走既有的 id_sort 布尔位，不进 sort_by
// - 其余维度按链顺序拼进 sort_by（后端支持多级 ORDER BY）
const buildChannelSortParam = (chain) => {
  if (chain.length === 0 || isPlanUsageFirst(chain)) return '';
  const levels = chain.filter((key) => key !== 'plan_usage' && key !== 'id');
  if (levels.length === 0) return '';
  // 名称是字典序，升序才符合直觉；并发降序（高的在前）更有用。
  const order = levels.every((key) => key === 'name') ? 'asc' : 'desc';
  return `&sort_by=${levels.join(',')}&sort_order=${order}`;
};

// 排序链里是否用到了 ID 维度（决定 id_sort 布尔位）。
const chainUsesIdSort = (chain) =>
  !isPlanUsageFirst(chain) && chain.includes('id');

export const useChannelsData = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Basic states
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  // 排序顺序：拖动后写回 localStorage，刷新后保持。
  // 这是排序的唯一状态来源——不再有 id/name/concurrency 三个勾选布尔位。
  const [sortOrder, setSortOrder] = useState(() =>
    parseChannelSortOrder(localStorage.getItem(CHANNEL_SORT_ORDER_KEY)),
  );
  // 请求构造函数通过位置参数传递排序，这里用 ref 让 URL 始终读到最新值。
  const activeSortRef = useRef([]);
  const [searching, setSearching] = useState(false);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [channelCount, setChannelCount] = useState(0);
  const [groupOptions, setGroupOptions] = useState([]);

  // UI states
  const [showEdit, setShowEdit] = useState(false);
  const [enableBatchDelete, setEnableBatchDelete] = useState(false);
  const [editingChannel, setEditingChannel] = useState({ id: undefined });
  const [showEditTag, setShowEditTag] = useState(false);
  const [editingTag, setEditingTag] = useState('');
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [enableTagMode, setEnableTagMode] = useState(false);
  const [showBatchSetTag, setShowBatchSetTag] = useState(false);
  const [batchSetTagValue, setBatchSetTagValue] = useState('');
  const [compactMode, setCompactMode] = useTableCompactMode('channels');

  // Column visibility states
  const [visibleColumns, setVisibleColumns] = useState({});
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Status filter
  const [statusFilter, setStatusFilter] = useState(
    localStorage.getItem('channel-status-filter') || 'all',
  );

  // Type tabs states
  const [activeTypeKey, setActiveTypeKey] = useState('all');
  const [typeCounts, setTypeCounts] = useState({});

  const [planQuotaRegistryVersion, setPlanQuotaRegistryVersion] = useState(
    getPlanQuotaRegistryVersion(),
  );
  useEffect(() => {
    // The registry notifies without arguments; passing setState directly
    // would set the version state to undefined, so re-read it explicitly.
    return subscribePlanQuotaRegistry(() =>
      setPlanQuotaRegistryVersion(getPlanQuotaRegistryVersion()),
    );
  }, []);

  // 排序链 = 拖动顺序的前 N 个维度。顺序是唯一状态来源：不再有勾选开关，
  // 所以刷新后只要 localStorage 里的顺序还在，排序效果就完全恢复。
  //
  // 这个派生值必须声明在所有使用点之前：挂载 effect 与 reload effect 都依赖
  // activeSort，同一函数作用域内提前引用会触发 TDZ（Cannot access before
  // initialization），整个页面直接白屏。
  const activeSort = pickActiveChannelSort(sortOrder);
  activeSortRef.current = activeSort;

  // Model test states
  const [showModelTestModal, setShowModelTestModal] = useState(false);
  const [currentTestChannel, setCurrentTestChannel] = useState(null);
  const [modelSearchKeyword, setModelSearchKeyword] = useState('');
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModels, setTestingModels] = useState(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState([]);
  const [isBatchTesting, setIsBatchTesting] = useState(false);
  const [modelTablePage, setModelTablePage] = useState(1);
  const [selectedEndpointType, setSelectedEndpointType] = useState('');
  const [isStreamTest, setIsStreamTest] = useState(false);
  const [globalPassThroughEnabled, setGlobalPassThroughEnabled] =
    useState(false);

  const fetchGlobalPassThroughEnabled = async () => {
    try {
      const res = await API.get('/api/option/');
      const { success, data } = res?.data || {};
      if (!success || !Array.isArray(data)) {
        return;
      }
      const option = data.find(
        (item) => item?.key === 'global.pass_through_request_enabled',
      );
      if (option) {
        setGlobalPassThroughEnabled(toBoolean(option.value));
      }
    } catch (error) {
      setGlobalPassThroughEnabled(false);
    }
  };

  // 使用 ref 来避免闭包问题，类似旧版实现
  const shouldStopBatchTestingRef = useRef(false);

  // Multi-key management states
  const [showMultiKeyManageModal, setShowMultiKeyManageModal] = useState(false);
  const [currentMultiKeyChannel, setCurrentMultiKeyChannel] = useState(null);

  // Refs
  const requestCounter = useRef(0);
  const allSelectingRef = useRef(false);
  const [formApi, setFormApi] = useState(null);

  const formInitValues = {
    searchKeyword: '',
    searchGroup: '',
    searchModel: '',
  };

  // Column keys
  const COLUMN_KEYS = {
    ID: 'id',
    NAME: 'name',
    GROUP: 'group',
    TYPE: 'type',
    STATUS: 'status',
    RESPONSE_TIME: 'response_time',
    CONCURRENCY: 'current_concurrency',
    BALANCE: 'balance',
    PLAN_QUOTA: 'plan_quota',
    PRIORITY: 'priority',
    WEIGHT: 'weight',
    OPERATE: 'operate',
  };

  // Initialize from localStorage
  useEffect(() => {
    const localPageSize =
      parseInt(localStorage.getItem('page-size')) || ITEMS_PER_PAGE;
    const localEnableTagMode =
      localStorage.getItem('enable-tag-mode') === 'true';
    const localEnableBatchDelete =
      localStorage.getItem('enable-batch-delete') === 'true';
    const localSortOrder = parseChannelSortOrder(
      localStorage.getItem(CHANNEL_SORT_ORDER_KEY),
    );

    setSortOrder(localSortOrder);
    setPageSize(localPageSize);
    setEnableTagMode(localEnableTagMode);
    setEnableBatchDelete(localEnableBatchDelete);

    // 首次请求必须直接带上回读的排序链，否则会用默认排序发一次再被 effect 重发。
    activeSortRef.current = pickActiveChannelSort(localSortOrder);

    loadChannels(1, localPageSize, localEnableTagMode)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    fetchGroups().then();
    loadChannelModels().then();
    fetchGlobalPassThroughEnabled().then();
  }, []);

  // 排序链变化后重新拉取。必须放在 effect 里而不是 onChange 里直接调用：
  // setState 是异步的，同一事件循环内 ref 还是旧值，请求会带上旧排序。
  const sortInitialized = useRef(false);
  useEffect(() => {
    if (!sortInitialized.current) {
      sortInitialized.current = true;
      return;
    }
    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    if (searchKeyword === '' && searchGroup === '' && searchModel === '') {
      loadChannels(1, pageSize, enableTagMode).then();
    } else {
      searchChannels(enableTagMode, activeTypeKey, statusFilter, 1, pageSize).then();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSort.join(',')]);

  // Column visibility management
  const getDefaultColumnVisibility = () => {
    return {
      [COLUMN_KEYS.ID]: true,
      [COLUMN_KEYS.NAME]: true,
      [COLUMN_KEYS.GROUP]: true,
      [COLUMN_KEYS.TYPE]: true,
      [COLUMN_KEYS.STATUS]: true,
      [COLUMN_KEYS.RESPONSE_TIME]: true,
      [COLUMN_KEYS.CONCURRENCY]: true,
      [COLUMN_KEYS.BALANCE]: true,
      [COLUMN_KEYS.PLAN_QUOTA]: true,
      [COLUMN_KEYS.PRIORITY]: true,
      [COLUMN_KEYS.WEIGHT]: true,
      [COLUMN_KEYS.OPERATE]: true,
    };
  };

  const initDefaultColumns = () => {
    const defaults = getDefaultColumnVisibility();
    setVisibleColumns(defaults);
  };

  // Load saved column preferences
  useEffect(() => {
    const savedColumns = localStorage.getItem('channels-table-columns');
    if (savedColumns) {
      try {
        const parsed = JSON.parse(savedColumns);
        const defaults = getDefaultColumnVisibility();
        const merged = { ...defaults, ...parsed };
        setVisibleColumns(merged);
      } catch (e) {
        console.error('Failed to parse saved column preferences', e);
        initDefaultColumns();
      }
    } else {
      initDefaultColumns();
    }
  }, []);

  // Save column preferences
  useEffect(() => {
    if (Object.keys(visibleColumns).length > 0) {
      localStorage.setItem(
        'channels-table-columns',
        JSON.stringify(visibleColumns),
      );
    }
  }, [visibleColumns]);

  const handleColumnVisibilityChange = (columnKey, checked) => {
    const updatedColumns = { ...visibleColumns, [columnKey]: checked };
    setVisibleColumns(updatedColumns);
  };

  const handleSelectAll = (checked) => {
    const allKeys = Object.keys(COLUMN_KEYS).map((key) => COLUMN_KEYS[key]);
    const updatedColumns = {};
    allKeys.forEach((key) => {
      updatedColumns[key] = checked;
    });
    setVisibleColumns(updatedColumns);
  };

  // Data formatting
  const setChannelFormat = (channels, enableTagMode) => {
    let channelDates = [];
    let channelTags = {};

    for (let i = 0; i < channels.length; i++) {
      channels[i].upstreamUpdateMeta = parseUpstreamUpdateMeta(
        channels[i].settings,
      );
      channels[i].key = '' + channels[i].id;
      if (!enableTagMode) {
        channelDates.push(channels[i]);
      } else {
        let tag = channels[i].tag ? channels[i].tag : '';
        let tagIndex = channelTags[tag];
        let tagChannelDates = undefined;

        if (tagIndex === undefined) {
          channelTags[tag] = 1;
          tagChannelDates = {
            key: tag,
            id: tag,
            tag: tag,
            name: '标签：' + tag,
            group: '',
            used_quota: 0,
            response_time: 0,
            priority: -1,
            weight: -1,
          };
          tagChannelDates.children = [];
          channelDates.push(tagChannelDates);
        } else {
          tagChannelDates = channelDates.find((item) => item.key === tag);
        }

        if (tagChannelDates.priority === -1) {
          tagChannelDates.priority = channels[i].priority;
        } else {
          if (tagChannelDates.priority !== channels[i].priority) {
            tagChannelDates.priority = '';
          }
        }

        if (tagChannelDates.weight === -1) {
          tagChannelDates.weight = channels[i].weight;
        } else {
          if (tagChannelDates.weight !== channels[i].weight) {
            tagChannelDates.weight = '';
          }
        }

        if (tagChannelDates.group === '') {
          tagChannelDates.group = channels[i].group;
        } else {
          let channelGroupsStr = channels[i].group;
          channelGroupsStr.split(',').forEach((item, index) => {
            if (tagChannelDates.group.indexOf(item) === -1) {
              tagChannelDates.group += ',' + item;
            }
          });
        }

        tagChannelDates.children.push(channels[i]);
        if (channels[i].status === 1) {
          tagChannelDates.status = 1;
        }
        tagChannelDates.used_quota += channels[i].used_quota;
        tagChannelDates.response_time += channels[i].response_time;
        tagChannelDates.response_time = tagChannelDates.response_time / 2;
      }
    }
    setChannels(channelDates);
  };

  // Get form values helper
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};
    return {
      searchKeyword: formValues.searchKeyword || '',
      searchGroup: formValues.searchGroup || '',
      searchModel: formValues.searchModel || '',
    };
  };

  // 拖拽后重排优先级。排序链取顺序前 N 个，所以重排可能改变生效的排序，
  // 由 activeSort 的 effect 负责重新拉取。
  const reorderSortDimensions = (sourceKey, targetKey, position) => {
    if (!sourceKey || sourceKey === targetKey) return;
    const next = sortOrder.filter((key) => key !== sourceKey);
    const targetIndex = next.indexOf(targetKey);
    if (targetIndex < 0) return;
    next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, sourceKey);
    localStorage.setItem(CHANNEL_SORT_ORDER_KEY, JSON.stringify(next));
    setSortOrder(next);
  };

  // Load channels
  const loadChannels = async (
    page,
    pageSize,
    enableTagMode,
    typeKey = activeTypeKey,
    statusF,
  ) => {
    if (statusF === undefined) statusF = statusFilter;

    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    if (searchKeyword !== '' || searchGroup !== '' || searchModel !== '') {
      setLoading(true);
      await searchChannels(
        enableTagMode,
        typeKey,
        statusF,
        page,
        pageSize,
      );
      setLoading(false);
      return;
    }

    const reqId = ++requestCounter.current;
    setLoading(true);
    const typeParam = typeKey !== 'all' ? `&type=${typeKey}` : '';
    const statusParam = statusF !== 'all' ? `&status=${statusF}` : '';
    const sortChain = activeSortRef.current;
    const sortParam = buildChannelSortParam(sortChain);
    const res = await API.get(
      `/api/channel/?p=${page}&page_size=${pageSize}&id_sort=${chainUsesIdSort(sortChain)}&tag_mode=${enableTagMode}${typeParam}${statusParam}${sortParam}`,
    );

    if (res === undefined || reqId !== requestCounter.current) {
      return;
    }

    const { success, message, data } = res.data;
    if (success) {
      const { items, total, type_counts } = data;
      if (type_counts) {
        const sumAll = Object.values(type_counts).reduce(
          (acc, v) => acc + v,
          0,
        );
        setTypeCounts({ ...type_counts, all: sumAll });
      }
      setChannelFormat(items, enableTagMode);
      setChannelCount(total);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Search channels
  const searchChannels = async (
    enableTagMode,
    typeKey = activeTypeKey,
    statusF = statusFilter,
    page = 1,
    pageSz = pageSize,
  ) => {
    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    setSearching(true);
    try {
      if (searchKeyword === '' && searchGroup === '' && searchModel === '') {
        await loadChannels(
          page,
          pageSz,
          enableTagMode,
          typeKey,
          statusF,
        );
        return;
      }

      const typeParam = typeKey !== 'all' ? `&type=${typeKey}` : '';
      const statusParam = statusF !== 'all' ? `&status=${statusF}` : '';
      const sortChain = activeSortRef.current;
      const sortParam = buildChannelSortParam(sortChain);
      const res = await API.get(
        `/api/channel/search?keyword=${searchKeyword}&group=${searchGroup}&model=${searchModel}&id_sort=${chainUsesIdSort(sortChain)}&tag_mode=${enableTagMode}&p=${page}&page_size=${pageSz}${typeParam}${statusParam}${sortParam}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        const { items = [], total = 0, type_counts = {} } = data;
        const sumAll = Object.values(type_counts).reduce(
          (acc, v) => acc + v,
          0,
        );
        setTypeCounts({ ...type_counts, all: sumAll });
        setChannelFormat(items, enableTagMode);
        setChannelCount(total);
        setActivePage(page);
      } else {
        showError(message);
      }
    } finally {
      setSearching(false);
    }
  };

  // Refresh
  const refresh = async (page = activePage) => {
    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    if (searchKeyword === '' && searchGroup === '' && searchModel === '') {
      await loadChannels(page, pageSize, enableTagMode);
    } else {
      await searchChannels(
        enableTagMode,
        activeTypeKey,
        statusFilter,
        page,
        pageSize,
      );
    }
  };

  const upstreamUpdates = useChannelUpstreamUpdates({ t, refresh });
  const upstreamPricing = useChannelUpstreamPricing({ t, refresh });

  // Channel management
  const manageChannel = async (id, action, record, value) => {
    let data = { id };
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/channel/${id}/`);
        break;
      case 'enable':
        res = await API.post(`/api/channel/${id}/status`, { status: 1 });
        break;
      case 'disable':
        res = await API.post(`/api/channel/${id}/status`, { status: 2 });
        break;
      case 'priority':
        if (value === '') return;
        data.priority = parseInt(value);
        res = await API.put('/api/channel/', data);
        break;
      case 'weight':
        if (value === '') return;
        data.weight = parseInt(value);
        if (data.weight < 0) data.weight = 0;
        res = await API.put('/api/channel/', data);
        break;
      case 'enable_all':
        data.channel_info = record.channel_info;
        data.channel_info.multi_key_status_list = {};
        res = await API.put('/api/channel/', data);
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      let channel = res.data.data;
      let newChannels = [...channels];
      if (action === 'enable' || action === 'disable') {
        // 状态接口只返回是否发生变更,不回传渠道对象,直接更新本地状态。
        record.status = action === 'enable' ? 1 : 2;
      } else if (action !== 'delete') {
        record.status = channel.status;
      }
      setChannels(newChannels);
    } else {
      showError(message);
    }
  };

  // Tag management
  const manageTag = async (tag, action) => {
    let res;
    switch (action) {
      case 'enable':
        res = await API.post('/api/channel/tag/enabled', { tag: tag });
        break;
      case 'disable':
        res = await API.post('/api/channel/tag/disabled', { tag: tag });
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      let newChannels = [...channels];
      for (let i = 0; i < newChannels.length; i++) {
        if (newChannels[i].tag === tag) {
          let status = action === 'enable' ? 1 : 2;
          newChannels[i]?.children?.forEach((channel) => {
            channel.status = status;
          });
          newChannels[i].status = status;
        }
      }
      setChannels(newChannels);
    } else {
      showError(message);
    }
  };

  // Page handlers
  const handlePageChange = (page) => {
    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    setActivePage(page);
    if (searchKeyword === '' && searchGroup === '' && searchModel === '') {
      loadChannels(page, pageSize, enableTagMode).then(() => {});
    } else {
      searchChannels(
        enableTagMode,
        activeTypeKey,
        statusFilter,
        page,
        pageSize,
      );
    }
  };

  const handlePageSizeChange = async (size) => {
    localStorage.setItem('page-size', size + '');
    setPageSize(size);
    setActivePage(1);
    const { searchKeyword, searchGroup, searchModel } = getFormValues();
    if (searchKeyword === '' && searchGroup === '' && searchModel === '') {
      loadChannels(1, size, enableTagMode)
        .then()
        .catch((reason) => {
          showError(reason);
        });
    } else {
      searchChannels(
        enableTagMode,
        activeTypeKey,
        statusFilter,
        1,
        size,
      );
    }
  };

  // Fetch groups
  const fetchGroups = async () => {
    try {
      let res = await API.get(`/api/group/`);
      if (res === undefined) return;
      setGroupOptions(
        res.data.data.map((group) => ({
          label: group,
          value: group,
        })),
      );
    } catch (error) {
      showError(error.message);
    }
  };

  // Copy channel
  const copySelectedChannel = async (record) => {
    try {
      const res = await API.post(`/api/channel/copy/${record.id}`);
      if (res?.data?.success) {
        showSuccess(t('渠道复制成功'));
        await refresh();
      } else {
        showError(res?.data?.message || t('渠道复制失败'));
      }
    } catch (error) {
      showError(
        t('渠道复制失败: ') +
          (error?.response?.data?.message || error?.message || error),
      );
    }
  };

  // Update channel property
  const updateChannelProperty = (channelId, updateFn) => {
    const newChannels = [...channels];
    let updated = false;

    newChannels.forEach((channel) => {
      if (channel.children !== undefined) {
        channel.children.forEach((child) => {
          if (child.id === channelId) {
            updateFn(child);
            updated = true;
          }
        });
      } else if (channel.id === channelId) {
        updateFn(channel);
        updated = true;
      }
    });

    if (updated) {
      setChannels(newChannels);
    }
  };

  // Tag edit
  const submitTagEdit = async (type, data) => {
    switch (type) {
      case 'priority':
        if (data.priority === undefined || data.priority === '') {
          showInfo('优先级必须是整数！');
          return;
        }
        data.priority = parseInt(data.priority);
        break;
      case 'weight':
        if (
          data.weight === undefined ||
          data.weight < 0 ||
          data.weight === ''
        ) {
          showInfo('权重必须是非负整数！');
          return;
        }
        data.weight = parseInt(data.weight);
        break;
    }

    try {
      const res = await API.put('/api/channel/tag', data);
      if (res?.data?.success) {
        showSuccess('更新成功！');
        await refresh();
      }
    } catch (error) {
      showError(error);
    }
  };

  // Close edit
  const closeEdit = () => {
    setShowEdit(false);
  };

  // Row style
  const handleRow = (record, index) => {
    if (record.status !== 1) {
      return {
        style: {
          background: 'var(--semi-color-disabled-border)',
        },
      };
    } else {
      return {};
    }
  };

  // Batch operations
  const batchSetChannelTag = async () => {
    if (selectedChannels.length === 0) {
      showError(t('请先选择要设置标签的渠道！'));
      return;
    }
    if (batchSetTagValue === '') {
      showError(t('标签不能为空！'));
      return;
    }
    let ids = selectedChannels.map((channel) => channel.id);
    const res = await API.post('/api/channel/batch/tag', {
      ids: ids,
      tag: batchSetTagValue === '' ? null : batchSetTagValue,
    });
    if (res.data.success) {
      showSuccess(
        t('已为 ${count} 个渠道设置标签！').replace('${count}', res.data.data),
      );
      await refresh();
      setShowBatchSetTag(false);
    } else {
      showError(res.data.message);
    }
  };

  const batchDeleteChannels = async () => {
    if (selectedChannels.length === 0) {
      showError(t('请先选择要删除的通道！'));
      return;
    }
    setLoading(true);
    let ids = [];
    selectedChannels.forEach((channel) => {
      ids.push(channel.id);
    });
    const res = await API.post(`/api/channel/batch`, { ids: ids });
    const { success, message, data } = res.data;
    if (success) {
      showSuccess(t('已删除 ${data} 个通道！').replace('${data}', data));
      await refresh();
      setTimeout(() => {
        if (channels.length === 0 && activePage > 1) {
          refresh(activePage - 1);
        }
      }, 100);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Channel operations
  const testAllChannels = async () => {
    const res = await API.get(`/api/channel/test`);
    const { success, message } = res.data;
    if (success) {
      showInfo(t('已成功开始测试所有已启用通道，请刷新页面查看结果。'));
    } else {
      showError(message);
    }
  };

  const deleteAllDisabledChannels = async () => {
    const res = await API.delete(`/api/channel/disabled`);
    const { success, message, data } = res.data;
    if (success) {
      showSuccess(
        t('已删除所有禁用渠道，共计 ${data} 个').replace('${data}', data),
      );
      await refresh();
    } else {
      showError(message);
    }
  };

  const updateAllChannelsBalance = async () => {
    const res = await API.get(`/api/channel/update_balance`);
    const { success, message } = res.data;
    if (success) {
      showInfo(t('已更新完毕所有已启用通道余额！'));
    } else {
      showError(message);
    }
  };

  const updateChannelBalance = async (record) => {
    if (record?.type === 57) {
      openCodexUsageModal({
        t,
        record,
        onCopy: async (text) => {
          const ok = await copy(text);
          if (ok) showSuccess(t('已复制'));
          else showError(t('复制失败'));
        },
      });
      return;
    }

    const res = await API.get(`/api/channel/update_balance/${record.id}/`);
    const { success, message, balance } = res.data;
    if (success) {
      updateChannelProperty(record.id, (channel) => {
        channel.balance = balance;
        channel.balance_updated_time = Date.now() / 1000;
      });
      showInfo(
        t('通道 ${name} 余额更新成功！').replace('${name}', record.name),
      );
    } else {
      showError(message);
    }
  };

  const fixChannelsAbilities = async () => {
    const res = await API.post(`/api/channel/fix`);
    const { success, message, data } = res.data;
    if (success) {
      showSuccess(
        t('已修复 ${success} 个通道，失败 ${fails} 个通道。')
          .replace('${success}', data.success)
          .replace('${fails}', data.fails),
      );
      await refresh();
    } else {
      showError(message);
    }
  };

  const checkOllamaVersion = async (record) => {
    try {
      const res = await API.get(`/api/channel/ollama/version/${record.id}`);
      const { success, message, data } = res.data;

      if (success) {
        const version = data?.version || '-';
        const infoMessage = t('当前 Ollama 版本为 ${version}').replace(
          '${version}',
          version,
        );

        const handleCopyVersion = async () => {
          if (!version || version === '-') {
            showInfo(t('暂无可复制的版本信息'));
            return;
          }

          const copied = await copy(version);
          if (copied) {
            showSuccess(t('已复制版本号'));
          } else {
            showError(t('复制失败，请手动复制'));
          }
        };

        Modal.info({
          title: t('Ollama 版本信息'),
          content: infoMessage,
          centered: true,
          footer: (
            <div className='flex justify-end gap-2'>
              <Button type='tertiary' onClick={handleCopyVersion}>
                {t('复制版本号')}
              </Button>
              <Button
                type='primary'
                theme='solid'
                onClick={() => Modal.destroyAll()}
              >
                {t('关闭')}
              </Button>
            </div>
          ),
          hasCancel: false,
          hasOk: false,
          closable: true,
          maskClosable: true,
        });
      } else {
        showError(message || t('获取 Ollama 版本失败'));
      }
    } catch (error) {
      const errMsg =
        error?.response?.data?.message ||
        error?.message ||
        t('获取 Ollama 版本失败');
      showError(errMsg);
    }
  };

  // Test channel - 单个模型测试，参考旧版实现
  const testChannel = async (
    record,
    model,
    endpointType = '',
    stream = false,
  ) => {
    const testKey = `${record.id}-${model}`;

    // 检查是否应该停止批量测试
    if (shouldStopBatchTestingRef.current && isBatchTesting) {
      return Promise.resolve();
    }

    // 添加到正在测试的模型集合
    setTestingModels((prev) => new Set([...prev, model]));

    try {
      let url = `/api/channel/test/${record.id}?model=${model}`;
      if (endpointType) {
        url += `&endpoint_type=${endpointType}`;
      }
      if (stream) {
        url += `&stream=true`;
      }
      const res = await API.get(url);

      // 检查是否在请求期间被停止
      if (shouldStopBatchTestingRef.current && isBatchTesting) {
        return Promise.resolve();
      }

      const { success, message, time, error_code } = res.data;

      // 更新测试结果
      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success,
          message,
          time: time || 0,
          timestamp: Date.now(),
          errorCode: error_code || null,
        },
      }));

      if (success) {
        // 更新渠道响应时间
        updateChannelProperty(record.id, (channel) => {
          channel.response_time = time * 1000;
          channel.test_time = Date.now() / 1000;
        });

        if (!model || model === '') {
          showInfo(
            t('通道 ${name} 测试成功，耗时 ${time.toFixed(2)} 秒。')
              .replace('${name}', record.name)
              .replace('${time.toFixed(2)}', time.toFixed(2)),
          );
        } else {
          showInfo(
            t(
              '通道 ${name} 测试成功，模型 ${model} 耗时 ${time.toFixed(2)} 秒。',
            )
              .replace('${name}', record.name)
              .replace('${model}', model)
              .replace('${time.toFixed(2)}', time.toFixed(2)),
          );
        }
      } else {
        showError(message);
      }
    } catch (error) {
      // 处理网络错误
      const testKey = `${record.id}-${model}`;
      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success: false,
          message: error.message || t('网络错误'),
          time: 0,
          timestamp: Date.now(),
          errorCode: null,
        },
      }));
      showError(error.message || t('测试失败'));
    } finally {
      // 从正在测试的模型集合中移除
      setTestingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(model);
        return newSet;
      });
    }
  };

  // 批量测试单个渠道的所有模型，参考旧版实现
  const batchTestModels = async () => {
    if (!currentTestChannel || !currentTestChannel.models) {
      showError(t('渠道模型信息不完整'));
      return;
    }

    const models = currentTestChannel.models
      .split(',')
      .filter((model) =>
        model.toLowerCase().includes(modelSearchKeyword.toLowerCase()),
      );

    if (models.length === 0) {
      showError(t('没有找到匹配的模型'));
      return;
    }

    setIsBatchTesting(true);
    shouldStopBatchTestingRef.current = false; // 重置停止标志

    // 清空该渠道之前的测试结果
    setModelTestResults((prev) => {
      const newResults = { ...prev };
      models.forEach((model) => {
        const testKey = `${currentTestChannel.id}-${model}`;
        delete newResults[testKey];
      });
      return newResults;
    });

    try {
      showInfo(
        t('开始批量测试 ${count} 个模型，已清空上次结果...').replace(
          '${count}',
          models.length,
        ),
      );

      // 提高并发数量以加快测试速度，参考旧版的并发限制
      const concurrencyLimit = 5;
      const results = [];

      for (let i = 0; i < models.length; i += concurrencyLimit) {
        // 检查是否应该停止
        if (shouldStopBatchTestingRef.current) {
          showInfo(t('批量测试已停止'));
          break;
        }

        const batch = models.slice(i, i + concurrencyLimit);
        showInfo(
          t('正在测试第 ${current} - ${end} 个模型 (共 ${total} 个)')
            .replace('${current}', i + 1)
            .replace('${end}', Math.min(i + concurrencyLimit, models.length))
            .replace('${total}', models.length),
        );

        const batchPromises = batch.map((model) =>
          testChannel(
            currentTestChannel,
            model,
            selectedEndpointType,
            isStreamTest,
          ),
        );
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        // 再次检查是否应该停止
        if (shouldStopBatchTestingRef.current) {
          showInfo(t('批量测试已停止'));
          break;
        }

        // 短暂延迟避免过于频繁的请求
        if (i + concurrencyLimit < models.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      if (!shouldStopBatchTestingRef.current) {
        // 等待一小段时间确保所有结果都已更新
        await new Promise((resolve) => setTimeout(resolve, 300));

        // 使用当前状态重新计算结果统计
        setModelTestResults((currentResults) => {
          let successCount = 0;
          let failCount = 0;

          models.forEach((model) => {
            const testKey = `${currentTestChannel.id}-${model}`;
            const result = currentResults[testKey];
            if (result && result.success) {
              successCount++;
            } else {
              failCount++;
            }
          });

          // 显示完成消息
          setTimeout(() => {
            showSuccess(
              t('批量测试完成！成功: ${success}, 失败: ${fail}, 总计: ${total}')
                .replace('${success}', successCount)
                .replace('${fail}', failCount)
                .replace('${total}', models.length),
            );
          }, 100);

          return currentResults; // 不修改状态，只是为了获取最新值
        });
      }
    } catch (error) {
      showError(t('批量测试过程中发生错误: ') + error.message);
    } finally {
      setIsBatchTesting(false);
    }
  };

  // 停止批量测试
  const stopBatchTesting = () => {
    shouldStopBatchTestingRef.current = true;
    setIsBatchTesting(false);
    setTestingModels(new Set());
    showInfo(t('已停止批量测试'));
  };

  // 清空测试结果
  const clearTestResults = () => {
    setModelTestResults({});
    showInfo(t('已清空测试结果'));
  };

  // Handle close modal
  const handleCloseModal = () => {
    // 如果正在批量测试，先停止测试
    if (isBatchTesting) {
      shouldStopBatchTestingRef.current = true;
      showInfo(t('关闭弹窗，已停止批量测试'));
    }

    setShowModelTestModal(false);
    setModelSearchKeyword('');
    setIsBatchTesting(false);
    setTestingModels(new Set());
    setSelectedModelKeys([]);
    setModelTablePage(1);
    setSelectedEndpointType('');
    setIsStreamTest(false);
    // 可选择性保留测试结果，这里不清空以便用户查看
  };

  // Type counts
  const channelTypeCounts = useMemo(() => {
    if (Object.keys(typeCounts).length > 0) return typeCounts;
    const counts = { all: channels.length };
    channels.forEach((channel) => {
      const collect = (ch) => {
        const type = ch.type;
        counts[type] = (counts[type] || 0) + 1;
      };
      if (channel.children !== undefined) {
        channel.children.forEach(collect);
      } else {
        collect(channel);
      }
    });
    return counts;
  }, [typeCounts, channels]);

  const availableTypeKeys = useMemo(() => {
    const keys = ['all'];
    Object.entries(channelTypeCounts).forEach(([k, v]) => {
      if (k !== 'all' && v > 0) keys.push(String(k));
    });
    return keys;
  }, [channelTypeCounts]);

  // Client-side reorder of the displayed channels by plan usage remaining
  // (five-hour window, most remaining first). The channels list is the
  // server-paginated current page, so this sort never reorders beyond it —
  // rows without a reported value keep their relative order at the end.
  // Values arrive asynchronously from the plan quota cells; the registry
  // version bumps on every report and re-triggers the sort.
  const sortedChannels = useMemo(() => {
    // 套餐用量排在排序链首位时由它完全接管：数据是异步上报的，
    // 不在数据库里，无法与任何后端维度叠加。
    if (activeSort[0] !== 'plan_usage') {
      return channels;
    }
    const withValue = [];
    const withoutValue = [];
    channels.forEach((channel) => {
      const value = getChannelSortValue(channel?.id);
      if (value == null) {
        withoutValue.push(channel);
      } else {
        withValue.push([value, channel]);
      }
    });
    withValue.sort((a, b) => b[0] - a[0]);
    return [...withValue.map(([, channel]) => channel), ...withoutValue];
  }, [channels, activeSort, planQuotaRegistryVersion]);

  return {
    // Basic states
    channels: sortedChannels,
    loading,
    searching,
    activePage,
    pageSize,
    channelCount,
    groupOptions,
    // 排序：拖动顺序 + 当前生效的排序链
    sortOrder,
    activeSort,
    enableTagMode,
    enableBatchDelete,
    statusFilter,
    compactMode,
    globalPassThroughEnabled,

    // UI states
    showEdit,
    setShowEdit,
    editingChannel,
    setEditingChannel,
    showEditTag,
    setShowEditTag,
    editingTag,
    setEditingTag,
    selectedChannels,
    setSelectedChannels,
    showBatchSetTag,
    setShowBatchSetTag,
    batchSetTagValue,
    setBatchSetTagValue,

    // Column states
    visibleColumns,
    showColumnSelector,
    setShowColumnSelector,
    COLUMN_KEYS,

    // Type tab states
    activeTypeKey,
    setActiveTypeKey,
    typeCounts,
    channelTypeCounts,
    availableTypeKeys,

    // Model test states
    showModelTestModal,
    setShowModelTestModal,
    currentTestChannel,
    setCurrentTestChannel,
    modelSearchKeyword,
    setModelSearchKeyword,
    modelTestResults,
    testingModels,
    selectedModelKeys,
    setSelectedModelKeys,
    isBatchTesting,
    modelTablePage,
    setModelTablePage,
    selectedEndpointType,
    setSelectedEndpointType,
    isStreamTest,
    setIsStreamTest,
    allSelectingRef,

    // Multi-key management states
    showMultiKeyManageModal,
    setShowMultiKeyManageModal,
    currentMultiKeyChannel,
    setCurrentMultiKeyChannel,
    ...upstreamUpdates,
    ...upstreamPricing,

    // Form
    formApi,
    setFormApi,
    formInitValues,

    // Helpers
    t,
    isMobile,

    // Functions
    loadChannels,
    searchChannels,
    refresh,
    manageChannel,
    manageTag,
    handlePageChange,
    handlePageSizeChange,
    copySelectedChannel,
    updateChannelProperty,
    submitTagEdit,
    closeEdit,
    handleRow,
    batchSetChannelTag,
    batchDeleteChannels,
    testAllChannels,
    deleteAllDisabledChannels,
    updateAllChannelsBalance,
    updateChannelBalance,
    fixChannelsAbilities,
    checkOllamaVersion,
    testChannel,
    batchTestModels,
    handleCloseModal,
    getFormValues,

    // Column functions
    handleColumnVisibilityChange,
    handleSelectAll,
    initDefaultColumns,
    getDefaultColumnVisibility,

    // Setters
    reorderSortDimensions,
    setEnableTagMode,
    setEnableBatchDelete,
    setStatusFilter,
    setCompactMode,
    setActivePage,
  };
};
