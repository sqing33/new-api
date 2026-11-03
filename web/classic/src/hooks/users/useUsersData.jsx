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
import { API, showError, showSuccess } from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';

// 用户页使用独立的分页存储键，避免与 /channel、/log 共用的 page-size 互相串扰
const USER_PAGE_SIZE_KEY = 'user-page-size';
// 排序开关：并发排序与最后登录排序互斥，各自持久化
const USER_SORT_BY_CONCURRENCY_KEY = 'user-sort-by-concurrency';
const USER_SORT_BY_LAST_LOGIN_KEY = 'user-sort-by-last-login';
// 列设置持久化键
const USERS_COLUMNS_STORAGE_KEY = 'users-table-columns';

const USER_COLUMN_KEYS = {
  ID: 'id',
  USERNAME: 'username',
  INFO: 'info',
  QUOTA_USAGE: 'quota_usage',
  GROUP: 'group',
  CONCURRENCY: 'current_concurrency',
  ROLE: 'role',
  INVITE: 'invite',
  CREATED_AT: 'created_at',
  LAST_LOGIN_AT: 'last_login_at',
  OPERATE: 'operate',
};

// 默认展示的列；邀请信息与创建时间信息量较低，默认隐藏
const getDefaultUserColumnVisibility = () => ({
  [USER_COLUMN_KEYS.ID]: false,
  [USER_COLUMN_KEYS.USERNAME]: true,
  [USER_COLUMN_KEYS.INFO]: true,
  [USER_COLUMN_KEYS.QUOTA_USAGE]: true,
  [USER_COLUMN_KEYS.GROUP]: true,
  [USER_COLUMN_KEYS.CONCURRENCY]: true,
  [USER_COLUMN_KEYS.ROLE]: true,
  [USER_COLUMN_KEYS.INVITE]: false,
  [USER_COLUMN_KEYS.CREATED_AT]: false,
  [USER_COLUMN_KEYS.LAST_LOGIN_AT]: true,
  [USER_COLUMN_KEYS.OPERATE]: true,
});

export const useUsersData = () => {
  const { t } = useTranslation();
  const [compactMode, setCompactMode] = useTableCompactMode('users');

  // State management
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(
    () => parseInt(localStorage.getItem(USER_PAGE_SIZE_KEY)) || ITEMS_PER_PAGE,
  );
  // Column visibility
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const defaults = getDefaultUserColumnVisibility();
    try {
      const saved = localStorage.getItem(USERS_COLUMNS_STORAGE_KEY);
      // 用默认值兜底，新增列在旧存档里缺失时仍能获得默认值
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch (_) {}
    return defaults;
  });

  useEffect(() => {
    if (Object.keys(visibleColumns).length > 0) {
      localStorage.setItem(
        USERS_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    }
  }, [visibleColumns]);

  const handleColumnVisibilityChange = (columnKey, checked) => {
    // 操作列不允许隐藏，否则管理员无法编辑或删除用户
    if (columnKey === USER_COLUMN_KEYS.OPERATE) return;
    setVisibleColumns((prev) => ({ ...prev, [columnKey]: checked }));
  };

  const handleSelectAllColumns = (checked) => {
    const next = {};
    Object.keys(USER_COLUMN_KEYS).forEach((k) => {
      const key = USER_COLUMN_KEYS[k];
      next[key] = key === USER_COLUMN_KEYS.OPERATE ? true : checked;
    });
    setVisibleColumns(next);
  };

  const initDefaultColumns = () => {
    setVisibleColumns(getDefaultUserColumnVisibility());
  };

  // 排序开关：两个互斥，都关闭时走后端默认的 id desc
  const [sortByConcurrency, setSortByConcurrencyState] = useState(
    () => localStorage.getItem(USER_SORT_BY_CONCURRENCY_KEY) === 'true',
  );
  const [sortByLastLogin, setSortByLastLoginState] = useState(
    () => localStorage.getItem(USER_SORT_BY_LAST_LOGIN_KEY) === 'true',
  );
  const sortByConcurrencyRef = useRef(sortByConcurrency);
  const sortByLastLoginRef = useRef(sortByLastLogin);
  sortByConcurrencyRef.current = sortByConcurrency;
  sortByLastLoginRef.current = sortByLastLogin;

  const setSortByConcurrency = (value) => {
    localStorage.setItem(USER_SORT_BY_CONCURRENCY_KEY, value + '');
    setSortByConcurrencyState(value);
    if (value) {
      localStorage.setItem(USER_SORT_BY_LAST_LOGIN_KEY, 'false');
      setSortByLastLoginState(false);
    }
  };
  const setSortByLastLogin = (value) => {
    localStorage.setItem(USER_SORT_BY_LAST_LOGIN_KEY, value + '');
    setSortByLastLoginState(value);
    if (value) {
      localStorage.setItem(USER_SORT_BY_CONCURRENCY_KEY, 'false');
      setSortByConcurrencyState(false);
    }
  };

  // 供请求 URL 使用：并发优先，其次最后登录，都没有则不传排序参数
  const buildUserSortParam = () => {
    if (sortByConcurrencyRef.current) return '&sort_by=concurrency';
    if (sortByLastLoginRef.current) return '&sort_by=last_login_at';
    return '';
  };
  const [searching, setSearching] = useState(false);
  const [groupOptions, setGroupOptions] = useState([]);
  const [userCount, setUserCount] = useState(0);

  // Modal states
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUser, setEditingUser] = useState({
    id: undefined,
  });

  // Form initial values
  const formInitValues = {
    searchKeyword: '',
    searchGroup: '',
  };

  // Form API reference
  const [formApi, setFormApi] = useState(null);

  // Get form values helper function
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};
    return {
      searchKeyword: formValues.searchKeyword || '',
      searchGroup: formValues.searchGroup || '',
    };
  };

  // Set user format with key field
  const setUserFormat = (users) => {
    for (let i = 0; i < users.length; i++) {
      users[i].key = users[i].id;
    }
    setUsers(users);
  };

  // Load users data
  const loadUsers = async (startIdx, pageSize) => {
    setLoading(true);
    const res = await API.get(
      `/api/user/?p=${startIdx}&page_size=${pageSize}${buildUserSortParam()}`,
    );
    const { success, message, data } = res.data;
    if (success) {
      const newPageData = data.items;
      setActivePage(data.page);
      setUserCount(data.total);
      setUserFormat(newPageData);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  // Search users with keyword and group
  const searchUsers = async (
    startIdx,
    pageSize,
    searchKeyword = null,
    searchGroup = null,
  ) => {
    // If no parameters passed, get values from form
    if (searchKeyword === null || searchGroup === null) {
      const formValues = getFormValues();
      searchKeyword = formValues.searchKeyword;
      searchGroup = formValues.searchGroup;
    }

    if (searchKeyword === '' && searchGroup === '') {
      // If keyword is blank, load files instead
      await loadUsers(startIdx, pageSize);
      return;
    }
    setSearching(true);
    const res = await API.get(
      `/api/user/search?keyword=${searchKeyword}&group=${searchGroup}&p=${startIdx}&page_size=${pageSize}${buildUserSortParam()}`,
    );
    const { success, message, data } = res.data;
    if (success) {
      const newPageData = data.items;
      setActivePage(data.page);
      setUserCount(data.total);
      setUserFormat(newPageData);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  // Manage user operations (promote, demote, enable, disable, delete)
  const manageUser = async (userId, action, record) => {
    // Trigger loading state to force table re-render
    setLoading(true);

    const res = await API.post('/api/user/manage', {
      id: userId,
      action,
    });

    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      const user = res.data.data;

      // Create a new array and new object to ensure React detects changes
      const newUsers = users.map((u) => {
        if (u.id === userId) {
          if (action === 'delete') {
            return { ...u, DeletedAt: new Date() };
          }
          return { ...u, status: user.status, role: user.role };
        }
        return u;
      });

      setUsers(newUsers);
    } else {
      showError(message);
    }

    setLoading(false);
  };

  const resetUserPasskey = async (user) => {
    if (!user) {
      return;
    }
    try {
      const res = await API.delete(`/api/user/${user.id}/reset_passkey`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('Passkey 已重置'));
      } else {
        showError(message || t('操作失败，请重试'));
      }
    } catch (error) {
      showError(t('操作失败，请重试'));
    }
  };

  const resetUserTwoFA = async (user) => {
    if (!user) {
      return;
    }
    try {
      const res = await API.delete(`/api/user/${user.id}/2fa`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('二步验证已重置'));
      } else {
        showError(message || t('操作失败，请重试'));
      }
    } catch (error) {
      showError(t('操作失败，请重试'));
    }
  };

  // Handle page change
  const handlePageChange = (page) => {
    setActivePage(page);
    const { searchKeyword, searchGroup } = getFormValues();
    if (searchKeyword === '' && searchGroup === '') {
      loadUsers(page, pageSize).then();
    } else {
      searchUsers(page, pageSize, searchKeyword, searchGroup).then();
    }
  };

  // Handle page size change
  const handlePageSizeChange = async (size) => {
    localStorage.setItem(USER_PAGE_SIZE_KEY, size + '');
    setPageSize(size);
    setActivePage(1);
    // 改分页后回到第一页，这里传 startIdx=0 而不是旧的 activePage
    loadUsers(0, size)
      .then()
      .catch((reason) => {
        showError(reason);
      });
  };

  // Handle table row styling for disabled/deleted users
  const handleRow = (record, index) => {
    if (record.DeletedAt !== null || record.status !== 1) {
      return {
        style: {
          background: 'var(--semi-color-disabled-border)',
        },
      };
    } else {
      return {};
    }
  };

  // Refresh data
  const refresh = async (page = activePage) => {
    const { searchKeyword, searchGroup } = getFormValues();
    if (searchKeyword === '' && searchGroup === '') {
      await loadUsers(page, pageSize);
    } else {
      await searchUsers(page, pageSize, searchKeyword, searchGroup);
    }
  };

  // Fetch groups data
  const fetchGroups = async () => {
    try {
      let res = await API.get(`/api/group/`);
      if (res === undefined) {
        return;
      }
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

  // Modal control functions
  const closeAddUser = () => {
    setShowAddUser(false);
  };

  const closeEditUser = () => {
    setShowEditUser(false);
    setEditingUser({
      id: undefined,
    });
  };

  // 排序开关变化后回到第一页重新拉取。放在 effect 里而不是 onChange 里，
  // 因为 setState 是异步的，同一事件循环内 ref 还是旧值。
  const sortInitialized = useRef(false);
  useEffect(() => {
    if (!sortInitialized.current) {
      sortInitialized.current = true;
      return;
    }
    loadUsers(0, pageSize)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortByConcurrency, sortByLastLogin]);

  // Initialize data on component mount
  useEffect(() => {
    // 首个请求直接用回读的 pageSize，避免后端按默认值回传把状态打回去
    const localPageSize =
      parseInt(localStorage.getItem(USER_PAGE_SIZE_KEY)) || ITEMS_PER_PAGE;
    setPageSize(localPageSize);
    loadUsers(0, localPageSize)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    fetchGroups().then();
  }, []);

  return {
    // Data state
    users,
    loading,
    activePage,
    pageSize,
    sortByConcurrency,
    setSortByConcurrency,
    sortByLastLogin,
    setSortByLastLogin,
    USER_COLUMN_KEYS,
    showColumnSelector,
    setShowColumnSelector,
    visibleColumns,
    handleColumnVisibilityChange,
    handleSelectAllColumns,
    initDefaultColumns,
    userCount,
    searching,
    groupOptions,

    // Modal state
    showAddUser,
    showEditUser,
    editingUser,
    setShowAddUser,
    setShowEditUser,
    setEditingUser,

    // Form state
    formInitValues,
    formApi,
    setFormApi,

    // UI state
    compactMode,
    setCompactMode,

    // Actions
    loadUsers,
    searchUsers,
    manageUser,
    resetUserPasskey,
    resetUserTwoFA,
    handlePageChange,
    handlePageSizeChange,
    handleRow,
    refresh,
    closeAddUser,
    closeEditUser,
    getFormValues,

    // Translation
    t,
  };
};
