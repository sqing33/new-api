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

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@douyinfe/semi-ui';
import {
  API,
  copy,
  showError,
  showSuccess,
  encodeToBase64,
} from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';
import {
  fetchTokenKey as fetchTokenKeyById,
  fetchTokenKeysBatch,
  getServerAddress,
  encodeChannelConnectionString,
} from '../../helpers/token';

// 令牌页使用独立的分页存储键，避免与 /channel、/user 共用的 page-size 互相串扰
const TOKEN_PAGE_SIZE_KEY = 'token-page-size';

// 列设置持久化键
const TOKENS_COLUMNS_STORAGE_KEY = 'tokens-table-columns';

const TOKEN_COLUMN_KEYS = {
  NAME: 'name',
  STATUS: 'status',
  QUOTA_USAGE: 'quota_usage',
  GROUP: 'group',
  TOKEN_KEY: 'token_key',
  MODEL_LIMITS: 'model_limits',
  ALLOW_IPS: 'allow_ips',
  CREATED_TIME: 'created_time',
  ACCESSED_TIME: 'accessed_time',
  EXPIRED_TIME: 'expired_time',
  OPERATE: 'operate',
};

// 默认展示的列；密钥、IP 限制、过期时间等信息量较低，默认隐藏
const getDefaultTokenColumnVisibility = () => ({
  [TOKEN_COLUMN_KEYS.NAME]: true,
  [TOKEN_COLUMN_KEYS.STATUS]: true,
  [TOKEN_COLUMN_KEYS.QUOTA_USAGE]: true,
  [TOKEN_COLUMN_KEYS.GROUP]: true,
  [TOKEN_COLUMN_KEYS.TOKEN_KEY]: true,
  [TOKEN_COLUMN_KEYS.MODEL_LIMITS]: false,
  [TOKEN_COLUMN_KEYS.ALLOW_IPS]: false,
  [TOKEN_COLUMN_KEYS.CREATED_TIME]: true,
  [TOKEN_COLUMN_KEYS.ACCESSED_TIME]: true,
  [TOKEN_COLUMN_KEYS.EXPIRED_TIME]: false,
  [TOKEN_COLUMN_KEYS.OPERATE]: true,
});

export const useTokensData = (openFluentNotification, openCCSwitchModal) => {
  const { t } = useTranslation();

  // Basic state
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupRatios, setGroupRatios] = useState({});
  const [activePage, setActivePage] = useState(1);
  const [tokenCount, setTokenCount] = useState(0);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState(false); // 是否处于搜索结果视图

  // 列表固定按并发降序、并发相同再按最后使用时间降序
  const buildTokenSortParam = () => '&sort_by=concurrency';

  // Column visibility
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const defaults = getDefaultTokenColumnVisibility();
    try {
      const saved = localStorage.getItem(TOKENS_COLUMNS_STORAGE_KEY);
      // 用默认值兜底，新增列在旧存档里缺失时仍能获得默认值
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (_) {}
    return defaults;
  });

  // Selection state
  const [selectedKeys, setSelectedKeys] = useState([]);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editingToken, setEditingToken] = useState({
    id: undefined,
  });

  // UI state
  const [compactMode, setCompactMode] = useTableCompactMode('tokens');
  const [showKeys, setShowKeys] = useState({});
  const [resolvedTokenKeys, setResolvedTokenKeys] = useState({});
  const [loadingTokenKeys, setLoadingTokenKeys] = useState({});
  const keyRequestsRef = useRef({});

  // Form state
  const [formApi, setFormApi] = useState(null);
  const formInitValues = {
    searchKeyword: '',
    searchToken: '',
  };

  // Get form values helper function
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};
    return {
      searchKeyword: formValues.searchKeyword || '',
      searchToken: formValues.searchToken || '',
    };
  };

  // Close edit modal
  const closeEdit = () => {
    setShowEdit(false);
    setTimeout(() => {
      setEditingToken({
        id: undefined,
      });
    }, 500);
  };

  // Sync page data from API response
  const syncPageData = (payload) => {
    setTokens(payload.items || []);
    setTokenCount(payload.total || 0);
    setActivePage(payload.page || 1);
    // 不把后端回传的 page_size 写回 state：它只是回显请求参数，
    // 缺失时还会回落成默认值，会把用户选的每页条数打回默认。
    setShowKeys({});
  };

  // Load tokens function
  const loadTokens = async (page = 1, size = pageSize) => {
    setLoading(true);
    setSearchMode(false);
    const res = await API.get(
      `/api/token/?p=${page}&size=${size}${buildTokenSortParam()}`,
    );
    const { success, message, data } = res.data;
    if (success) {
      syncPageData(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Refresh function
  const refresh = async (page = activePage) => {
    await loadTokens(page);
    setSelectedKeys([]);
  };

  // Copy text function
  const copyText = async (text) => {
    if (await copy(text)) {
      showSuccess(t('已复制到剪贴板！'));
    } else {
      Modal.error({
        title: t('无法复制到剪贴板，请手动复制'),
        content: text,
        size: 'large',
      });
    }
  };

  const fetchTokenKey = async (tokenOrId, options = {}) => {
    const { suppressError = false } = options;
    const tokenId =
      typeof tokenOrId === 'object' ? tokenOrId?.id : Number(tokenOrId);

    if (!tokenId) {
      const error = new Error(t('令牌不存在'));
      if (!suppressError) {
        showError(error.message);
      }
      throw error;
    }

    if (resolvedTokenKeys[tokenId]) {
      return resolvedTokenKeys[tokenId];
    }

    if (keyRequestsRef.current[tokenId]) {
      return keyRequestsRef.current[tokenId];
    }

    const request = (async () => {
      setLoadingTokenKeys((prev) => ({ ...prev, [tokenId]: true }));
      try {
        const fullKey = await fetchTokenKeyById(tokenId);
        setResolvedTokenKeys((prev) => ({ ...prev, [tokenId]: fullKey }));
        return fullKey;
      } catch (error) {
        const normalizedError = new Error(
          error?.message || t('获取令牌密钥失败'),
        );
        if (!suppressError) {
          showError(normalizedError.message);
        }
        throw normalizedError;
      } finally {
        delete keyRequestsRef.current[tokenId];
        setLoadingTokenKeys((prev) => {
          const next = { ...prev };
          delete next[tokenId];
          return next;
        });
      }
    })();

    keyRequestsRef.current[tokenId] = request;
    return request;
  };

  const toggleTokenVisibility = async (record) => {
    const tokenId = record?.id;
    if (!tokenId) {
      return;
    }

    if (showKeys[tokenId]) {
      setShowKeys((prev) => ({ ...prev, [tokenId]: false }));
      return;
    }

    const fullKey = await fetchTokenKey(record);
    if (fullKey) {
      setShowKeys((prev) => ({ ...prev, [tokenId]: true }));
    }
  };

  const copyTokenKey = async (record) => {
    const fullKey = await fetchTokenKey(record);
    await copyText(`sk-${fullKey}`);
  };

  const copyTokenConnectionString = async (record) => {
    const fullKey = await fetchTokenKey(record);
    const serverUrl = getServerAddress();
    const connStr = encodeChannelConnectionString(`sk-${fullKey}`, serverUrl);
    await copyText(connStr);
  };

  // Open link function for chat integrations
  const onOpenLink = async (type, url, record) => {
    const fullKey = await fetchTokenKey(record);
    if (url && url.startsWith('ccswitch')) {
      openCCSwitchModal(fullKey);
      return;
    }
    if (url && url.startsWith('fluent')) {
      openFluentNotification(fullKey);
      return;
    }
    let status = localStorage.getItem('status');
    let serverAddress = '';
    if (status) {
      status = JSON.parse(status);
      serverAddress = status.server_address;
    }
    if (serverAddress === '') {
      serverAddress = window.location.origin;
    }
    if (url.includes('{cherryConfig}') === true) {
      let cherryConfig = {
        id: 'new-api',
        baseUrl: serverAddress,
        apiKey: `sk-${fullKey}`,
      };
      let encodedConfig = encodeURIComponent(
        encodeToBase64(JSON.stringify(cherryConfig)),
      );
      url = url.replaceAll('{cherryConfig}', encodedConfig);
    } else if (url.includes('{aionuiConfig}') === true) {
      let aionuiConfig = {
        platform: 'new-api',
        baseUrl: serverAddress,
        apiKey: `sk-${fullKey}`,
      };
      let encodedConfig = encodeURIComponent(
        encodeToBase64(JSON.stringify(aionuiConfig)),
      );
      url = url.replaceAll('{aionuiConfig}', encodedConfig);
    } else if (url.includes('{deepchatConfig}') === true) {
      let deepchatConfig = {
        id: 'new-api',
        baseUrl: serverAddress,
        apiKey: `sk-${fullKey}`,
      };
      let encodedConfig = encodeURIComponent(
        encodeToBase64(JSON.stringify(deepchatConfig)),
      );
      url = url.replaceAll('{deepchatConfig}', encodedConfig);
    } else {
      let encodedServerAddress = encodeURIComponent(serverAddress);
      url = url.replaceAll('{address}', encodedServerAddress);
      url = url.replaceAll('{key}', `sk-${fullKey}`);
    }

    window.open(url, '_blank');
  };

  // Manage token function (delete, enable, disable)
  const manageToken = async (id, action, record) => {
    setLoading(true);
    let data = { id };
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/token/${id}/`);
        break;
      case 'enable':
        data.status = 1;
        res = await API.put('/api/token/?status_only=true', data);
        break;
      case 'disable':
        data.status = 2;
        res = await API.put('/api/token/?status_only=true', data);
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      let token = res.data.data;
      let newTokens = [...tokens];
      if (action !== 'delete') {
        record.status = token.status;
      }
      setTokens(newTokens);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Search tokens function
  const searchTokens = async (page = 1, size = pageSize) => {
    const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const normalizedSize =
      Number.isInteger(size) && size > 0 ? size : pageSize;

    const { searchKeyword, searchToken } = getFormValues();
    if (searchKeyword === '' && searchToken === '') {
      setSearchMode(false);
      await loadTokens(1);
      return;
    }
    setSearching(true);
    const res = await API.get(
      `/api/token/search?keyword=${encodeURIComponent(searchKeyword)}&token=${encodeURIComponent(searchToken)}&p=${normalizedPage}&size=${normalizedSize}${buildTokenSortParam()}`,
    );
    const { success, message, data } = res.data;
    if (success) {
      setSearchMode(true);
      syncPageData(data);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  // Sort tokens function
  const sortToken = (key) => {
    if (tokens.length === 0) return;
    setLoading(true);
    let sortedTokens = [...tokens];
    sortedTokens.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedTokens[0].id === tokens[0].id) {
      sortedTokens.reverse();
    }
    setTokens(sortedTokens);
    setLoading(false);
  };

  // Page handlers
  const handlePageChange = (page) => {
    if (searchMode) {
      searchTokens(page, pageSize).then();
    } else {
      loadTokens(page, pageSize).then();
    }
  };

  const handlePageSizeChange = async (size) => {
    localStorage.setItem(TOKEN_PAGE_SIZE_KEY, size + '');
    setPageSize(size);
    if (searchMode) {
      await searchTokens(1, size);
    } else {
      await loadTokens(1, size);
    }
  };

  // Row selection handlers
  const rowSelection = {
    onSelect: (record, selected) => {},
    onSelectAll: (selected, selectedRows) => {},
    onChange: (selectedRowKeys, selectedRows) => {
      setSelectedKeys(selectedRows);
    },
  };

  // Handle row styling
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

  // Batch delete tokens
  const batchDeleteTokens = async () => {
    if (selectedKeys.length === 0) {
      showError(t('请先选择要删除的令牌！'));
      return;
    }
    setLoading(true);
    try {
      const ids = selectedKeys.map((token) => token.id);
      const res = await API.post('/api/token/batch', { ids });
      if (res?.data?.success) {
        const count = res.data.data || 0;
        showSuccess(t('已删除 {{count}} 个令牌！', { count }));
        await refresh();
        setTimeout(() => {
          if (tokens.length === 0 && activePage > 1) {
            refresh(activePage - 1);
          }
        }, 100);
      } else {
        showError(res?.data?.message || t('删除失败'));
      }
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Batch copy tokens
  const batchCopyTokens = async (copyType) => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    try {
      const ids = selectedKeys.map((token) => token.id);
      const keysMap = await fetchTokenKeysBatch(ids);

      setResolvedTokenKeys((prev) => ({ ...prev, ...keysMap }));

      let content = '';
      for (const token of selectedKeys) {
        const fullKey = keysMap[token.id];
        if (!fullKey) continue;
        if (copyType === 'name+key') {
          content += `${token.name}    sk-${fullKey}\n`;
        } else {
          content += `sk-${fullKey}\n`;
        }
      }
      await copyText(content);
    } catch (error) {
      showError(error?.message || t('复制令牌失败'));
    }
  };

  // 持久化列可见性
  useEffect(() => {
    if (Object.keys(visibleColumns).length > 0) {
      localStorage.setItem(
        TOKENS_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    }
  }, [visibleColumns]);

  const handleColumnVisibilityChange = (columnKey, checked) => {
    // 操作列不允许隐藏，否则用户无法编辑或删除令牌
    if (columnKey === TOKEN_COLUMN_KEYS.OPERATE) return;
    setVisibleColumns((prev) => ({ ...prev, [columnKey]: checked }));
  };

  const handleSelectAllColumns = (checked) => {
    const next = {};
    Object.keys(TOKEN_COLUMN_KEYS).forEach((k) => {
      const key = TOKEN_COLUMN_KEYS[k];
      next[key] = key === TOKEN_COLUMN_KEYS.OPERATE ? true : checked;
    });
    setVisibleColumns(next);
  };

  const initDefaultColumns = () => {
    setVisibleColumns(getDefaultTokenColumnVisibility());
  };

  // Initialize data
  useEffect(() => {
    // 首个请求直接用回读的 pageSize，避免后端按默认值回传 page_size 把状态打回去
    const localPageSize =
      parseInt(localStorage.getItem(TOKEN_PAGE_SIZE_KEY)) || ITEMS_PER_PAGE;
    setPageSize(localPageSize);
    loadTokens(1, localPageSize)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    API.get('/api/user/self/groups')
      .then((res) => {
        if (res.data.success && res.data.data) {
          const ratios = {};
          for (const [name, info] of Object.entries(res.data.data)) {
            ratios[name] = info.ratio;
          }
          setGroupRatios(ratios);
        }
      })
      .catch(() => {});
  }, []);

  return {
    // Basic state
    tokens,
    loading,
    activePage,
    tokenCount,
    pageSize,
    searching,

    // Column visibility
    TOKEN_COLUMN_KEYS,
    showColumnSelector,
    setShowColumnSelector,
    visibleColumns,
    handleColumnVisibilityChange,
    handleSelectAllColumns,
    initDefaultColumns,
    groupRatios,

    // Selection state
    selectedKeys,
    setSelectedKeys,

    // Edit state
    showEdit,
    setShowEdit,
    editingToken,
    setEditingToken,
    closeEdit,

    // UI state
    compactMode,
    setCompactMode,
    showKeys,
    setShowKeys,
    resolvedTokenKeys,
    loadingTokenKeys,

    // Form state
    formApi,
    setFormApi,
    formInitValues,
    getFormValues,

    // Functions
    loadTokens,
    refresh,
    copyText,
    fetchTokenKey,
    toggleTokenVisibility,
    copyTokenKey,
    copyTokenConnectionString,
    onOpenLink,
    manageToken,
    searchTokens,
    sortToken,
    handlePageChange,
    handlePageSizeChange,
    rowSelection,
    handleRow,
    batchDeleteTokens,
    batchCopyTokens,
    syncPageData,

    // Translation
    t,
  };
};
