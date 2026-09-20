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

import HeaderBar from './headerbar';
import { Layout } from '@douyinfe/semi-ui';
import SiderBar from './SiderBar';
import App from '../../App';
import FooterBar from './Footer';
import { ToastContainer } from 'react-toastify';
import ErrorBoundary from '../common/ErrorBoundary';
import React, { useContext, useEffect, useState } from 'react';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { useSidebarCollapsed } from '../../hooks/common/useSidebarCollapsed';
import { useTranslation } from 'react-i18next';
import {
  API,
  getLogo,
  getSystemName,
  showError,
  setStatusData,
} from '../../helpers';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import { useLocation } from 'react-router-dom';
import { normalizeLanguage } from '../../i18n/language';
import { isWorkbenchLikePath } from '../../constants/workbenchRoutes';
import clsx from 'clsx';
const { Sider, Content, Header } = Layout;

const PageLayout = () => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState, statusDispatch] = useContext(StatusContext);
  const isMobile = useIsMobile();
  const [collapsed, , setCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { i18n } = useTranslation();
  const location = useLocation();

  const isWorkbenchRoute = isWorkbenchLikePath(location.pathname);

  const shouldHideFooter =
    isWorkbenchRoute ||
    location.pathname === '/login' ||
    location.pathname === '/register' ||
    (location.pathname === '/' &&
      statusState?.status?.HomePageMode !== 'custom_content');

  const shouldInnerPadding =
    isWorkbenchRoute &&
    !location.pathname.startsWith('/chat') &&
    location.pathname !== '/playground';

  const showSider = isWorkbenchRoute && (!isMobile || drawerOpen);
  const hideHeader =
    location.pathname === '/' ||
    isWorkbenchRoute ||
    location.pathname === '/login' ||
    location.pathname === '/register';

  useEffect(() => {
    if (isMobile && drawerOpen && collapsed) {
      setCollapsed(false);
    }
  }, [isMobile, drawerOpen, collapsed, setCollapsed]);

  const loadUser = () => {
    let user = localStorage.getItem('user');
    if (user) {
      let data = JSON.parse(user);
      userDispatch({ type: 'login', payload: data });
    }
  };

  const loadStatus = async () => {
    try {
      const res = await API.get('/api/status');
      const { success, data } = res.data;
      if (success) {
        statusDispatch({ type: 'set', payload: data });
        setStatusData(data);
      } else {
        showError('Unable to connect to server');
      }
    } catch (error) {
      showError('Failed to load status');
    }
  };

  useEffect(() => {
    loadUser();
    loadStatus().catch(console.error);
    let systemName = getSystemName();
    if (systemName) {
      document.title = systemName;
    }
    let logo = getLogo();
    if (logo) {
      let linkElement = document.querySelector("link[rel~='icon']");
      if (linkElement) {
        linkElement.href = logo;
      }
    }
  }, []);

  useEffect(() => {
    let preferredLang;

    if (userState?.user?.setting) {
      try {
        const settings = JSON.parse(userState.user.setting);
        preferredLang = normalizeLanguage(settings.language);
      } catch (e) {
        // Ignore parse errors
      }
    }

    if (!preferredLang) {
      const savedLang = localStorage.getItem('i18nextLng');
      if (savedLang) {
        preferredLang = normalizeLanguage(savedLang);
      }
    }

    if (preferredLang) {
      localStorage.setItem('i18nextLng', preferredLang);
      if (preferredLang !== i18n.language) {
        i18n.changeLanguage(preferredLang);
      }
    }
  }, [i18n, userState?.user?.setting]);

  // 管理员可在设置里配置控制台背景图 URL(ConsoleBackgroundURL),
  // 非空时覆盖默认的打包背景;CSS 中 ::before 使用固定 layered 背景,
  // 这里通过 CSS 变量把自定义 URL 传入,优先级高于默认图层。
  const consoleBackgroundURL =
    statusState?.status?.ConsoleBackgroundURL &&
    typeof statusState.status.ConsoleBackgroundURL === 'string'
      ? statusState.status.ConsoleBackgroundURL.trim()
      : '';

  useEffect(() => {
    const styleId = 'console-custom-background';
    let styleEl = document.getElementById(styleId);
    if (consoleBackgroundURL) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `.console-bg-shell::before {
  background-image:
    linear-gradient(90deg, rgba(255,255,255,0.34), rgba(255,255,255,0.16) 22%, rgba(255,255,255,0.08)),
    url('${consoleBackgroundURL.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-color: var(--semi-color-bg-0);
}`;
    } else if (styleEl) {
      styleEl.remove();
    }
    return () => {
      const existing = document.getElementById(styleId);
      if (existing && !consoleBackgroundURL) existing.remove();
    };
  }, [consoleBackgroundURL]);

  return (
    <Layout
      className={clsx('app-layout', isWorkbenchRoute && 'console-bg-layout')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: isMobile ? 'visible' : 'hidden',
      }}
    >
      {!hideHeader && (
        <Header
          style={{
            padding: 0,
            height: 'auto',
            lineHeight: 'normal',
            position: 'fixed',
            width: '100%',
            top: 0,
            zIndex: 100,
          }}
        >
          <HeaderBar
            onMobileMenuToggle={() => setDrawerOpen((prev) => !prev)}
            drawerOpen={drawerOpen}
          />
        </Header>
      )}
      <Layout
        className={clsx(
          isWorkbenchRoute && 'console-bg-shell',
          location.pathname === '/pricing' && 'pricing-bg-shell',
        )}
        style={{
          overflow: isMobile ? 'visible' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {showSider && (
          <Sider
            className='app-sider console-bg-sider'
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              zIndex: 99,
              border: 'none',
              paddingRight: '0',
              width: 'var(--sidebar-current-width)',
            }}
          >
            <SiderBar
              onNavigate={() => {
                if (isMobile) setDrawerOpen(false);
              }}
            />
          </Sider>
        )}
        <Layout
          className={clsx(isWorkbenchRoute && 'console-bg-main')}
          style={{
            marginLeft: isMobile
              ? '0'
              : showSider
                ? 'var(--sidebar-current-width)'
                : '0',
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Content
            className={clsx(isWorkbenchRoute && 'console-bg-content')}
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: isMobile
                ? 'visible'
                : isWorkbenchRoute
                  ? 'auto'
                  : 'hidden',
              WebkitOverflowScrolling: 'touch',
              padding: shouldInnerPadding ? (isMobile ? '5px' : '24px') : '0',
              position: 'relative',
            }}
          >
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </Content>
          {!shouldHideFooter && (
            <Layout.Footer
              style={{
                flex: '0 0 auto',
                width: '100%',
              }}
            >
              <FooterBar />
            </Layout.Footer>
          )}
        </Layout>
      </Layout>
      <ToastContainer />
    </Layout>
  );
};

export default PageLayout;
