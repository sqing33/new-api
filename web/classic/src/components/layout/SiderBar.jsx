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

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLucideIcon, renderQuota } from '../../helpers/render';
import { ChevronLeft, LogIn } from 'lucide-react';
import { useSidebarCollapsed } from '../../hooks/common/useSidebarCollapsed';
import { useSidebar } from '../../hooks/common/useSidebar';
import { useMinimumLoadingTime } from '../../hooks/common/useMinimumLoadingTime';
import {
  API,
  getLogo,
  getSystemName,
  isAdmin,
  isRoot,
  showError,
  stringToColor,
} from '../../helpers';
import { StatusContext } from '../../context/Status';
import { UserContext } from '../../context/User';
import { normalizeLanguage } from '../../i18n/language';
import { useNotifications } from '../../hooks/common/useNotifications';
import NoticeModal from './NoticeModal';
import LanguageSelector from './headerbar/LanguageSelector';
import NotificationButton from './headerbar/NotificationButton';
import SkeletonWrapper from './components/SkeletonWrapper';

import { Nav, Divider, Button, Avatar, Typography } from '@douyinfe/semi-ui';

const routerMap = {
  home: '/',
  channel: '/channel',
  token: '/token',
  redemption: '/redemption',
  topup: '/topup',
  user: '/user',
  subscription: '/subscription',
  log: '/log',
  midjourney: '/midjourney',
  'image-log': '/image-logs',
  setting: '/setting',
  about: '/about',
  detail: '/dashboard',
  pricing: '/pricing',
  task: '/task',
  models: '/models',
  deployment: '/deployment',
  'tool-install-setting': '/tool-install-setting',
  playground: '/playground',
  'image-studio': '/image-studio',
  'image-presets': '/image-presets',
  'video-studio': '/video-studio',
  tools: '/tools',
  personal: '/personal',
};

const SiderBar = ({ onNavigate = () => {} }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [statusState] = useContext(StatusContext);
  const [userState, userDispatch] = useContext(UserContext);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const {
    isModuleVisible,
    hasSectionVisibleModules,
    loading: sidebarLoading,
  } = useSidebar();
  const {
    noticeVisible,
    unreadCount,
    handleNoticeOpen,
    handleNoticeClose,
    getUnreadKeys,
  } = useNotifications(statusState);

  const showSkeleton = useMinimumLoadingTime(sidebarLoading, 200);

  const [selectedKeys, setSelectedKeys] = useState(['home']);
  const [chatItems, setChatItems] = useState([]);
  const [openedKeys, setOpenedKeys] = useState([]);
  const location = useLocation();
  const [routerMapState, setRouterMapState] = useState(routerMap);
  const systemName = statusState?.status?.system_name || getSystemName();
  const logo = statusState?.status?.logo || getLogo();
  const docsLink = statusState?.status?.docs_link || '';
  const showDocsEntry = useMemo(() => {
    if (!docsLink) return false;

    const headerNavModulesConfig = statusState?.status?.HeaderNavModules;
    if (!headerNavModulesConfig) return true;

    try {
      const modules = JSON.parse(headerNavModulesConfig);
      return modules.docs !== false;
    } catch {
      return true;
    }
  }, [docsLink, statusState?.status?.HeaderNavModules]);
  const currentLang = normalizeLanguage(i18n.language);

  useEffect(() => {
    let cancelled = false;
    if (!userState?.user?.id) return undefined;

    API.get('/api/user/self')
      .then((res) => {
        const nextUser = res?.data?.success ? res.data.data : null;
        if (!nextUser || cancelled) return;
        userDispatch({ type: 'login', payload: nextUser });
        localStorage.setItem('user', JSON.stringify(nextUser));
      })
      .catch(() => {
        // Best effort refresh only; stale local balance is still usable.
      });

    return () => {
      cancelled = true;
    };
  }, [userDispatch, userState?.user?.id]);

  const handleLanguageChange = useCallback(
    async (lang) => {
      const previousLang = normalizeLanguage(i18n.language);
      i18n.changeLanguage(lang);
      localStorage.setItem('i18nextLng', lang);

      if (userState?.user?.id) {
        try {
          const res = await API.put('/api/user/self', { language: lang });
          if (res.data.success) {
            let settings = {};
            if (userState?.user?.setting) {
              try {
                settings = JSON.parse(userState.user.setting) || {};
              } catch (e) {
                settings = {};
              }
            }

            settings.language = lang;
            const nextUser = {
              ...userState.user,
              setting: JSON.stringify(settings),
            };

            userDispatch({ type: 'login', payload: nextUser });
            localStorage.setItem('user', JSON.stringify(nextUser));
          }
        } catch (error) {
          if (previousLang) {
            i18n.changeLanguage(previousLang);
            localStorage.setItem('i18nextLng', previousLang);
          }
        }
      }
    },
    [i18n, userDispatch, userState?.user],
  );

  const workspaceItems = useMemo(() => {
    const items = [
      {
        text: t('数据看板'),
        itemKey: 'detail',
        to: '/dashboard',
        className:
          localStorage.getItem('enable_data_export') === 'true'
            ? ''
            : 'tableHiddle',
      },
      {
        text: t('清荫日志'),
        itemKey: 'image-log',
        to: '/image-logs',
      },
      {
        text: t('使用日志'),
        itemKey: 'log',
        to: '/log',
      },
      {
        text: t('令牌管理'),
        itemKey: 'token',
        to: '/token',
      },
      {
        text: t('绘图日志'),
        itemKey: 'midjourney',
        to: '/midjourney',
        className:
          localStorage.getItem('enable_drawing') === 'true'
            ? ''
            : 'tableHiddle',
      },
      {
        text: t('任务日志'),
        itemKey: 'task',
        to: '/task',
        className:
          localStorage.getItem('enable_task') === 'true' ? '' : 'tableHiddle',
      },
    ];

    // 根据配置过滤项目
    const filteredItems = items.filter((item) => {
      const configVisible = isModuleVisible('console', item.itemKey);
      return configVisible;
    });

    return filteredItems;
  }, [
    localStorage.getItem('enable_data_export'),
    localStorage.getItem('enable_drawing'),
    localStorage.getItem('enable_task'),
    t,
    isModuleVisible,
  ]);

  const financeItems = useMemo(() => {
    const items = [
      {
        text: t('钱包管理'),
        itemKey: 'topup',
        to: '/topup',
      },
      {
        text: t('个人设置'),
        itemKey: 'personal',
        to: '/personal',
      },
    ];

    // 根据配置过滤项目
    const filteredItems = items.filter((item) => {
      const configVisible = isModuleVisible('personal', item.itemKey);
      return configVisible;
    });

    return filteredItems;
  }, [t, isModuleVisible]);

  const adminItems = useMemo(() => {
    const items = [
      {
        text: t('渠道管理'),
        itemKey: 'channel',
        to: '/channel',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('订阅管理'),
        itemKey: 'subscription',
        to: '/subscription',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('模型管理'),
        itemKey: 'models',
        to: '/models',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('模型部署'),
        itemKey: 'deployment',
        to: '/deployment',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('兑换码管理'),
        itemKey: 'redemption',
        to: '/redemption',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('用户管理'),
        itemKey: 'user',
        to: '/user',
        className: isAdmin() ? '' : 'tableHiddle',
      },
      {
        text: t('工具管理'),
        itemKey: 'tool-install-setting',
        to: '/tool-install-setting',
        className: isRoot() ? '' : 'tableHiddle',
      },
      {
        text: t('系统设置'),
        itemKey: 'setting',
        to: '/setting',
        className: isRoot() ? '' : 'tableHiddle',
      },
    ];

    // 根据配置过滤项目
    const filteredItems = items.filter((item) => {
      const configVisible = isModuleVisible('admin', item.itemKey);
      return configVisible;
    });

    return filteredItems;
  }, [isAdmin(), isRoot(), t, isModuleVisible]);

  const chatMenuItems = useMemo(() => {
    const items = [
      {
        text: t('操练场'),
        itemKey: 'playground',
        to: '/playground',
      },
      {
        text: t('清荫工作台'),
        itemKey: 'image-studio',
        to: '/image-studio',
      },
      {
        text: t('清荫展览馆'),
        itemKey: 'image-presets',
        to: '/image-presets',
      },
      {
        text: t('视频'),
        itemKey: 'video-studio',
        to: '/video-studio',
      },
      {
        text: t('清荫模型馆'),
        itemKey: 'pricing',
        to: '/pricing',
      },
      {
        text: t('清荫手册'),
        itemKey: 'tools',
        to: '/tools',
      },
      {
        text: t('关于'),
        itemKey: 'about',
        to: '/about',
      },
      ...(showDocsEntry
        ? [
            {
              text: t('文档'),
              itemKey: 'docs',
              externalLink: docsLink,
            },
          ]
        : []),
      {
        text: t('聊天'),
        itemKey: 'chat',
        items: chatItems,
      },
    ];

    // 根据配置过滤项目
    const filteredItems = items.filter((item) => {
      const configVisible = isModuleVisible('chat', item.itemKey);
      return configVisible;
    });

    return filteredItems;
  }, [chatItems, showDocsEntry, t, isModuleVisible]);

  // 更新路由映射，添加聊天路由
  const updateRouterMapWithChats = (chats) => {
    const newRouterMap = { ...routerMap };

    if (Array.isArray(chats) && chats.length > 0) {
      for (let i = 0; i < chats.length; i++) {
        newRouterMap['chat' + i] = '/chat/' + i;
      }
    }

    setRouterMapState(newRouterMap);
    return newRouterMap;
  };

  // 加载聊天项
  useEffect(() => {
    let chats = localStorage.getItem('chats');
    if (chats) {
      try {
        chats = JSON.parse(chats);
        if (Array.isArray(chats)) {
          let chatItems = [];
          for (let i = 0; i < chats.length; i++) {
            let shouldSkip = false;
            let chat = {};
            for (let key in chats[i]) {
              let link = chats[i][key];
              if (typeof link !== 'string') continue; // 确保链接是字符串
              if (
                link.startsWith('fluent') ||
                link.startsWith('ccswitch') ||
                link.startsWith('deepchat')
              ) {
                shouldSkip = true;
                break;
              }
              chat.text = key;
              chat.itemKey = 'chat' + i;
              chat.to = '/chat/' + i;
            }
            if (shouldSkip || !chat.text) continue; // 避免推入空项
            chatItems.push(chat);
          }
          setChatItems(chatItems);
          updateRouterMapWithChats(chats);
        }
      } catch (e) {
        showError('聊天数据解析失败');
      }
    }
  }, []);

  // 根据当前路径设置选中的菜单项
  useEffect(() => {
    const currentPath = location.pathname;
    let matchingKey = Object.keys(routerMapState).find(
      (key) => routerMapState[key] === currentPath,
    );

    // 处理聊天路由
    if (!matchingKey && currentPath.startsWith('/chat/')) {
      const chatIndex = currentPath.split('/').pop();
      if (!isNaN(chatIndex)) {
        matchingKey = 'chat' + chatIndex;
      } else {
        matchingKey = 'chat';
      }
    }

    // 如果找到匹配的键，更新选中的键
    if (matchingKey) {
      setSelectedKeys([matchingKey]);
    }
  }, [location.pathname, routerMapState]);

  // 监控折叠状态变化以更新 body class
  useEffect(() => {
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  }, [collapsed]);

  const renderBrand = () => (
    <Link
      to='/'
      className='sidebar-brand-link'
      onClick={onNavigate}
      title={systemName}
    >
      <div className='sidebar-brand-logo'>
        {logo ? <img src={logo} alt='logo' /> : null}
      </div>
      {!collapsed && (
        <span className='sidebar-brand-title truncate'>{systemName}</span>
      )}
    </Link>
  );

  const renderUserMenu = () => {
    const user = userState?.user;
    if (!user) {
      return (
        <Button
          theme='solid'
          type='primary'
          size='small'
          className='sidebar-user-button'
          icon={collapsed ? <LogIn size={16} /> : null}
          icononly={collapsed}
          onClick={() => navigate('/login')}
        >
          {!collapsed ? t('登录') : null}
        </Button>
      );
    }

    const username = user.username || '';
    const balance = renderQuota(user.quota || 0);

    return (
      <div className='sidebar-user-menu'>
        <Button
          theme='borderless'
          type='tertiary'
          className='sidebar-user-button'
          icon={
            <Avatar size='extra-small' color={stringToColor(username)}>
              {username?.[0]?.toUpperCase()}
            </Avatar>
          }
          onClick={() => navigate('/personal')}
        >
          {!collapsed && (
            <span className='sidebar-user-copy'>
              <Typography.Text
                ellipsis
                className='!text-xs !font-medium !text-semi-color-text-1'
              >
                {username}
              </Typography.Text>
              <Typography.Text
                ellipsis
                className='!text-[11px] !text-semi-color-text-2'
              >
                {t('当前余额')}：{balance}
              </Typography.Text>
            </span>
          )}
        </Button>
      </div>
    );
  };

  const renderSidebarFooter = () => (
    <div className='sidebar-footer-actions'>
      <div className='sidebar-footer-tools'>
        <NotificationButton
          unreadCount={unreadCount}
          onNoticeOpen={handleNoticeOpen}
          t={t}
        />
        <LanguageSelector
          currentLang={currentLang}
          onLanguageChange={handleLanguageChange}
          t={t}
        />
      </div>
      {renderUserMenu()}
    </div>
  );

  // 选中高亮颜色（统一）
  const SELECTED_COLOR = 'var(--semi-color-primary)';

  // 渲染自定义菜单项
  const renderNavItem = (item) => {
    // 跳过隐藏的项目
    if (item.className === 'tableHiddle') return null;

    const isSelected = selectedKeys.includes(item.itemKey);
    const textColor = isSelected ? SELECTED_COLOR : 'inherit';

    return (
      <Nav.Item
        key={item.itemKey}
        itemKey={item.itemKey}
        text={
          <span
            className='truncate font-medium text-sm'
            style={{ color: textColor }}
          >
            {item.text}
          </span>
        }
        icon={
          <div className='sidebar-icon-container flex-shrink-0'>
            {getLucideIcon(item.itemKey, isSelected)}
          </div>
        }
        className={item.className}
      />
    );
  };

  // 渲染子菜单项
  const renderSubItem = (item) => {
    if (item.items && item.items.length > 0) {
      const isSelected = selectedKeys.includes(item.itemKey);
      const textColor = isSelected ? SELECTED_COLOR : 'inherit';

      return (
        <Nav.Sub
          key={item.itemKey}
          itemKey={item.itemKey}
          text={
            <span
              className='truncate font-medium text-sm'
              style={{ color: textColor }}
            >
              {item.text}
            </span>
          }
          icon={
            <div className='sidebar-icon-container flex-shrink-0'>
              {getLucideIcon(item.itemKey, isSelected)}
            </div>
          }
        >
          {item.items.map((subItem) => {
            const isSubSelected = selectedKeys.includes(subItem.itemKey);
            const subTextColor = isSubSelected ? SELECTED_COLOR : 'inherit';

            return (
              <Nav.Item
                key={subItem.itemKey}
                itemKey={subItem.itemKey}
                text={
                  <span
                    className='truncate font-medium text-sm'
                    style={{ color: subTextColor }}
                  >
                    {subItem.text}
                  </span>
                }
              />
            );
          })}
        </Nav.Sub>
      );
    } else {
      return renderNavItem(item);
    }
  };

  return (
    <>
      <NoticeModal
        visible={noticeVisible}
        onClose={handleNoticeClose}
        isMobile={false}
        defaultTab={unreadCount > 0 ? 'system' : 'inApp'}
        unreadKeys={getUnreadKeys()}
      />
      <div
        className='sidebar-container'
        style={{
          width: 'var(--sidebar-current-width)',
        }}
      >
        {renderBrand()}
        <SkeletonWrapper
          loading={showSkeleton}
          type='sidebar'
          className=''
          collapsed={collapsed}
          showAdmin={isAdmin()}
        >
          <Nav
            className='sidebar-nav'
            defaultIsCollapsed={collapsed}
            isCollapsed={collapsed}
            onCollapseChange={toggleCollapsed}
            selectedKeys={selectedKeys}
            itemStyle='sidebar-nav-item'
            hoverStyle='sidebar-nav-item:hover'
            selectedStyle='sidebar-nav-item-selected'
            renderWrapper={({ itemElement, props }) => {
              const to =
                routerMapState[props.itemKey] || routerMap[props.itemKey];

              if (props.itemKey === 'docs' && showDocsEntry) {
                return (
                  <a
                    style={{ textDecoration: 'none' }}
                    href={docsLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={onNavigate}
                  >
                    {itemElement}
                  </a>
                );
              }

              // 如果没有路由，直接返回元素
              if (!to) return itemElement;

              return (
                <Link
                  style={{ textDecoration: 'none' }}
                  to={to}
                  onClick={onNavigate}
                >
                  {itemElement}
                </Link>
              );
            }}
            onSelect={(key) => {
              // 如果点击的是已经展开的子菜单的父项，则收起子菜单
              if (openedKeys.includes(key.itemKey)) {
                setOpenedKeys(openedKeys.filter((k) => k !== key.itemKey));
              }

              setSelectedKeys([key.itemKey]);
            }}
            openKeys={openedKeys}
            onOpenChange={(data) => {
              setOpenedKeys(data.openKeys);
            }}
          >
            {/* 工作台区域 */}
            {hasSectionVisibleModules('chat') && (
              <div className='sidebar-section'>
                {!collapsed && (
                  <div className='sidebar-group-label'>{t('工作台')}</div>
                )}
                {chatMenuItems.map((item) => renderSubItem(item))}
              </div>
            )}

            {/* 控制台区域 */}
            {hasSectionVisibleModules('console') && (
              <>
                <Divider className='sidebar-divider' />
                <div>
                  {!collapsed && (
                    <div className='sidebar-group-label'>{t('控制台')}</div>
                  )}
                  {workspaceItems.map((item) => renderNavItem(item))}
                </div>
              </>
            )}

            {/* 个人中心区域 */}
            {hasSectionVisibleModules('personal') && (
              <>
                <Divider className='sidebar-divider' />
                <div>
                  {!collapsed && (
                    <div className='sidebar-group-label'>{t('个人中心')}</div>
                  )}
                  {financeItems.map((item) => renderNavItem(item))}
                </div>
              </>
            )}

            {/* 管理员区域 - 只在管理员时显示且配置允许时显示 */}
            {isAdmin() && hasSectionVisibleModules('admin') && (
              <>
                <Divider className='sidebar-divider' />
                <div>
                  {!collapsed && (
                    <div className='sidebar-group-label'>{t('管理员')}</div>
                  )}
                  {adminItems.map((item) => renderNavItem(item))}
                </div>
              </>
            )}
          </Nav>
        </SkeletonWrapper>

        {renderSidebarFooter()}
        <div className='sidebar-collapse-button'>
          <SkeletonWrapper
            loading={showSkeleton}
            type='button'
            width={collapsed ? 36 : 156}
            height={24}
            className='w-full'
          >
            <Button
              theme='outline'
              type='tertiary'
              size='small'
              icon={
                <ChevronLeft
                  size={16}
                  strokeWidth={2.5}
                  color='var(--semi-color-text-2)'
                  style={{
                    transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              }
              onClick={toggleCollapsed}
              icononly={collapsed}
              style={
                collapsed
                  ? { width: 36, height: 24, padding: 0 }
                  : { padding: '4px 12px', width: '100%' }
              }
            >
              {!collapsed ? t('收起侧边栏') : null}
            </Button>
          </SkeletonWrapper>
        </div>
      </div>
    </>
  );
};

export default SiderBar;
