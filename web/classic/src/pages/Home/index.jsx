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

import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Typography,
  Input,
  ScrollList,
  ScrollItem,
} from '@douyinfe/semi-ui';
import { API, showError, copy, showSuccess } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { API_ENDPOINTS } from '../../constants/common.constant';
import { StatusContext } from '../../context/Status';
import { UserContext } from '../../context/User';
import { useActualTheme } from '../../context/Theme';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import {
  IconGithubLogo,
  IconPlay,
  IconFile,
  IconCopy,
} from '@douyinfe/semi-icons';
import {
  BookOpen,
  Compass,
  ImageIcon,
  Info,
  LayoutDashboard,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import NoticeModal from '../../components/layout/NoticeModal';
import { getLogo, getSystemName } from '../../helpers';
import {
  Moonshot,
  OpenAI,
  XAI,
  Zhipu,
  Volcengine,
  Cohere,
  Claude,
  Gemini,
  Suno,
  Minimax,
  Wenxin,
  Spark,
  Qingyan,
  DeepSeek,
  Qwen,
  Midjourney,
  Grok,
  AzureAI,
  Hunyuan,
  Xinference,
} from '@lobehub/icons';

const { Text } = Typography;

const CARD_LAYOUTS = [
  { rotate: -6.8, x: 6, y: 0, z: 3, deco: 'tape-top' },
  { rotate: 4.6, x: -8, y: -6, z: 1, deco: 'clip' },
  { rotate: -2.4, x: 8, y: 4, z: 4, deco: 'tape-corner' },
  { rotate: 5.8, x: -5, y: -10, z: 2, deco: 'tape-top' },
  { rotate: -4.2, x: 10, y: -18, z: 5, deco: 'clip' },
  { rotate: 2.8, x: -10, y: -8, z: 1, deco: 'tape-corner' },
];

const ASPECT_HEIGHT_WEIGHTS = {
  landscape: 0.68,
  square: 1,
  portrait: 1.34,
};
const PROMPT_PRESETS_OPTION_KEY = 'ImagePromptPresets';

const getGalleryItemHeightWeight = (item) => {
  if (item.width > 0 && item.height > 0) {
    return item.height / item.width;
  }
  return ASPECT_HEIGHT_WEIGHTS[item.aspect] || ASPECT_HEIGHT_WEIGHTS.square;
};

const buildMasonryColumns = (items, columnCount) => {
  const safeColumnCount = Math.max(
    1,
    Math.min(columnCount, items.length || columnCount),
  );
  const columns = Array.from({ length: safeColumnCount }, () => []);
  const columnHeights = Array.from({ length: safeColumnCount }, () => 0);

  items.forEach((item, index) => {
    const shortestColumnIndex = columnHeights.indexOf(
      Math.min(...columnHeights),
    );
    const layout = CARD_LAYOUTS[index % CARD_LAYOUTS.length];
    const heightWeight = getGalleryItemHeightWeight(item);

    columns[shortestColumnIndex].push({
      ...item,
      originalIndex: index,
      layout,
    });
    columnHeights[shortestColumnIndex] += heightWeight;
  });

  return columns;
};

const normalizeGalleryItem = (item = {}, index = 0) => ({
  imageUrl: String(item.imageUrl || item.url || '').trim(),
  width: Number(item.width || item.w || 0),
  height: Number(item.height || item.h || 0),
  title: String(item.title || `Image ${index + 1}`).trim(),
  prompt: String(item.prompt || '').trim(),
  model: String(item.model || '').trim(),
  tag: String(item.tag || '').trim(),
  aspect: ['square', 'portrait', 'landscape'].includes(item.aspect)
    ? item.aspect
    : 'square',
});

const parseGalleryImages = (value) => {
  try {
    const parsed =
      typeof value === 'string' ? JSON.parse(value || '[]') : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeGalleryItem).filter((item) => item.imageUrl);
  } catch {
    return [];
  }
};

const normalizePromptPresetGalleryItem = (item = {}, index = 0) => ({
  imageUrl: String(item.image || item.imageUrl || '').trim(),
  width: Number(item.width || item.w || 0),
  height: Number(item.height || item.h || 0),
  title: String(item.name || `Preset ${index + 1}`).trim(),
  prompt: String(item.prompt || '').trim(),
  model: '',
  tag: '',
  aspect: 'square',
});

const parsePromptPresetImages = (value) => {
  try {
    const parsed =
      typeof value === 'string' ? JSON.parse(value || '[]') : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePromptPresetGalleryItem)
      .filter((item) => item.imageUrl);
  } catch {
    return [];
  }
};

const Home = () => {
  const { t, i18n } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const [userState] = useContext(UserContext);
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [homePageMode, setHomePageMode] = useState('image_showcase');
  const [galleryImages, setGalleryImages] = useState([]);
  const [galleryImageSizes, setGalleryImageSizes] = useState({});
  const [noticeVisible, setNoticeVisible] = useState(false);
  const isMobile = useIsMobile();
  const masonryColumnCount = isMobile ? 2 : 3;
  const isDemoSiteMode = statusState?.status?.demo_site_enabled || false;
  const docsLink = statusState?.status?.docs_link || '';
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;
  const logo = statusState?.status?.logo || getLogo();
  const systemName = statusState?.status?.system_name || getSystemName();
  const endpointItems = API_ENDPOINTS.map((e) => ({ value: e }));
  const [endpointIndex, setEndpointIndex] = useState(0);
  const isChinese = i18n.language.startsWith('zh');
  const defaultHeaderNavModules = {
    console: true,
    imageStudio: true,
    pricing: true,
    docs: true,
    about: true,
  };
  let headerNavModules = defaultHeaderNavModules;
  let pricingRequireAuth = true;
  if (statusState?.status?.HeaderNavModules) {
    try {
      headerNavModules = JSON.parse(statusState.status.HeaderNavModules);
      if (typeof headerNavModules.pricing === 'boolean') {
        headerNavModules.pricing = {
          enabled: headerNavModules.pricing,
          requireAuth: false,
        };
      }
      if (headerNavModules.imageStudio === undefined) {
        headerNavModules.imageStudio = true;
      }
      pricingRequireAuth = true;
    } catch {
      pricingRequireAuth = true;
    }
  }
  const cabinNavItems = [
    {
      text: t('创作台'),
      description: t('进入生图工作流'),
      to: '/image-studio',
      icon: ImageIcon,
      visible: headerNavModules.imageStudio === true,
    },
    {
      text: t('模型馆'),
      description: t('查看模型与价格'),
      to: pricingRequireAuth && !userState.user ? '/login' : '/pricing',
      icon: Compass,
      visible:
        typeof headerNavModules.pricing === 'object'
          ? headerNavModules.pricing.enabled
          : headerNavModules.pricing === true,
    },
    {
      text: t('工作台'),
      description: t('管理密钥和任务'),
      to: userState.user ? '/dashboard' : '/login',
      icon: LayoutDashboard,
      visible: headerNavModules.console === true,
    },
    ...(docsLink
      ? [
          {
            text: t('指南'),
            description: t('查看使用说明'),
            externalLink: docsLink,
            icon: BookOpen,
            visible: headerNavModules.docs === true,
          },
        ]
      : []),
    {
      text: t('关于'),
      description: t('了解平台信息'),
      to: '/about',
      icon: Info,
      visible: headerNavModules.about === true,
    },
  ].filter((item) => item.visible);
  const masonryColumns = useMemo(
    () =>
      buildMasonryColumns(
        galleryImages.map((item) => ({
          ...item,
          ...(galleryImageSizes[item.imageUrl] || {}),
        })),
        masonryColumnCount,
      ),
    [galleryImages, galleryImageSizes, masonryColumnCount],
  );

  const handleGalleryImageLoad = (item, event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    setGalleryImageSizes((prev) => {
      const current = prev[item.imageUrl];
      if (
        current?.width === naturalWidth &&
        current?.height === naturalHeight
      ) {
        return prev;
      }
      return {
        ...prev,
        [item.imageUrl]: {
          width: naturalWidth,
          height: naturalHeight,
        },
      };
    });
  };

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_settings');
    const { success, message, data } = res.data;
    if (success) {
      const mode = data?.mode || 'image_showcase';
      const rawContent = data?.content || '';
      const parsedGallery = parseGalleryImages(data?.gallery_images);
      setHomePageMode(mode);
      if (parsedGallery.length > 0 || mode !== 'image_showcase') {
        setGalleryImages(parsedGallery);
      } else {
        const optionsRes = await API.get('/api/option/');
        const presetOption = optionsRes.data?.data?.find(
          (item) => item.key === PROMPT_PRESETS_OPTION_KEY,
        );
        setGalleryImages(parsePromptPresetImages(presetOption?.value));
      }

      let content = rawContent;
      if (mode === 'custom_content' && !rawContent.startsWith('https://')) {
        content = marked.parse(rawContent);
      }
      setHomePageContent(content);
      localStorage.setItem('home_page_content', content);

      // 如果内容是 URL，则发送主题模式
      if (mode === 'custom_content' && rawContent.startsWith('https://')) {
        const iframe = document.querySelector('iframe');
        if (iframe) {
          iframe.onload = () => {
            iframe.contentWindow.postMessage({ themeMode: actualTheme }, '*');
            iframe.contentWindow.postMessage({ lang: i18n.language }, '*');
          };
        }
      }
    } else {
      showError(message);
      setHomePageContent('加载首页内容失败...');
    }
    setHomePageContentLoaded(true);
  };

  const renderImageShowcaseHome = () => (
    <div className='home-showcase-page h-screen overflow-hidden bg-semi-color-bg-0'>
      <div className='home-showcase-forest' aria-hidden='true' />
      <section className='grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5 px-4 py-5 md:grid-cols-[minmax(300px,38%)_minmax(0,1fr)] md:grid-rows-1 md:gap-8 md:px-8 md:py-8 lg:px-12'>
        <div className='flex min-h-0 flex-col items-center justify-center text-center md:items-start md:text-left'>
          <div className='home-showcase-copy flex w-full max-w-lg flex-col items-center gap-6 md:items-start'>
            <div className='flex items-center gap-4'>
              <div className='home-showcase-logo flex h-48 w-48 items-center justify-center overflow-hidden rounded-2xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm md:h-60 md:w-60'>
                {logo ? (
                  <img
                    alt={systemName}
                    className='h-full w-full object-contain p-2'
                    src={logo}
                  />
                ) : (
                  <Sparkles className='text-semi-color-primary' size={30} />
                )}
              </div>
              <div className='home-showcase-brand hidden flex-col md:flex'>
                <span className='text-sm text-semi-color-text-2'>
                  {t('AI 生图创作平台')}
                </span>
                <span className='max-w-[240px] truncate text-lg font-semibold text-semi-color-text-0'>
                  {systemName}
                </span>
              </div>
            </div>

            <div className='home-showcase-text flex flex-col gap-4'>
              <div className='home-showcase-pill inline-flex w-fit items-center gap-2 rounded-full border border-semi-color-border bg-semi-color-bg-1 px-3 py-1 text-sm text-semi-color-text-1 md:hidden'>
                <Sparkles size={15} />
                <span>{t('AI 生图创作平台')}</span>
              </div>
              <h1 className='m-0 text-3xl font-bold leading-tight text-semi-color-text-0 md:text-4xl lg:text-5xl'>
                {t('把灵感变成可用的视觉作品')}
              </h1>
              <p className='m-0 max-w-md text-base leading-7 text-semi-color-text-1 md:text-lg'>
                {t(
                  '从灵感描述、参考图到商品图工作流，让每一次创作都更快更好看。',
                )}
              </p>
            </div>

            <div
              className='home-showcase-entry-board'
              aria-label={t('首页入口')}
            >
              {cabinNavItems.map((item) => {
                const Icon = item.icon;
                const content = (
                  <>
                    <span className='home-showcase-entry-icon'>
                      <Icon size={18} />
                    </span>
                    <span className='min-w-0'>
                      <span className='home-showcase-entry-title'>
                        {item.text}
                      </span>
                      <span className='home-showcase-entry-desc'>
                        {item.description}
                      </span>
                    </span>
                  </>
                );

                return item.externalLink ? (
                  <a
                    className='home-showcase-entry'
                    href={item.externalLink}
                    key={item.text}
                    rel='noopener noreferrer'
                    target='_blank'
                  >
                    {content}
                  </a>
                ) : (
                  <Link
                    className='home-showcase-entry'
                    key={item.text}
                    to={item.to}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className='home-showcase-marquee min-h-0 overflow-hidden rounded-xl border border-semi-color-border bg-semi-color-bg-1 px-3 py-4 md:px-5 md:py-6'>
          {galleryImages.length > 0 ? (
            <div className='home-showcase-track'>
              {[0, 1].map((copyIndex) => (
                <div className='home-showcase-masonry' key={copyIndex}>
                  {masonryColumns.map((column, columnIndex) => (
                    <div
                      className='home-showcase-masonry-column'
                      key={`${copyIndex}-${columnIndex}`}
                    >
                      {column.map((item) => {
                        const cardTransform = item.layout;
                        return (
                          <div
                            className={`home-showcase-card home-showcase-card-${cardTransform.deco}`}
                            key={`${copyIndex}-${item.imageUrl}-${item.originalIndex}`}
                            style={{
                              '--home-card-rotate': `${cardTransform.rotate}deg`,
                              '--home-card-x': `${cardTransform.x}px`,
                              '--home-card-y': `${cardTransform.y}px`,
                              '--home-card-z': cardTransform.z,
                            }}
                          >
                            <img
                              alt={item.title}
                              className='block h-auto w-full rounded-sm'
                              decoding='async'
                              height={item.height > 0 ? item.height : undefined}
                              loading='eager'
                              onLoad={(event) =>
                                handleGalleryImageLoad(item, event)
                              }
                              src={item.imageUrl}
                              width={item.width > 0 ? item.width : undefined}
                            />
                            <span
                              className='home-showcase-card-deco'
                              aria-hidden='true'
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className='flex h-full min-h-[320px] items-center justify-center text-center text-semi-color-text-2'>
              {t('暂无预设提示词')}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const handleCopyBaseURL = async () => {
    const ok = await copy(serverAddress);
    if (ok) {
      showSuccess(t('已复制到剪切板'));
    }
  };

  useEffect(() => {
    const checkNoticeAndShow = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      const today = new Date().toDateString();
      if (lastCloseDate !== today) {
        try {
          const res = await API.get('/api/notice');
          const { success, data } = res.data;
          if (success && data && data.trim() !== '') {
            setNoticeVisible(true);
          }
        } catch (error) {
          console.error('获取公告失败:', error);
        }
      }
    };

    checkNoticeAndShow();
  }, []);

  useEffect(() => {
    displayHomePageContent().then();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setEndpointIndex((prev) => (prev + 1) % endpointItems.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [endpointItems.length]);

  return (
    <div className='w-full overflow-x-hidden'>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />
      {homePageContentLoaded && homePageMode === 'image_showcase' ? (
        renderImageShowcaseHome()
      ) : homePageContentLoaded && homePageContent === '' ? (
        <div className='w-full overflow-x-hidden'>
          {/* Banner 部分 */}
          <div className='w-full border-b border-semi-color-border min-h-[500px] md:min-h-[600px] lg:min-h-[700px] relative overflow-x-hidden'>
            {/* 背景模糊晕染球 */}
            <div className='blur-ball blur-ball-indigo' />
            <div className='blur-ball blur-ball-teal' />
            <div className='flex items-center justify-center h-full px-4 py-20 md:py-24 lg:py-32 mt-10'>
              {/* 居中内容区 */}
              <div className='flex flex-col items-center justify-center text-center max-w-4xl mx-auto'>
                <div className='flex flex-col items-center justify-center mb-6 md:mb-8'>
                  <h1
                    className={`text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-semi-color-text-0 leading-tight ${isChinese ? 'tracking-wide md:tracking-wider' : ''}`}
                  >
                    <>
                      {t('统一的')}
                      <br />
                      <span className='shine-text'>{t('大模型接口网关')}</span>
                    </>
                  </h1>
                  <p className='text-base md:text-lg lg:text-xl text-semi-color-text-1 mt-4 md:mt-6 max-w-xl'>
                    {t('更好的价格，更好的稳定性，只需要将模型基址替换为：')}
                  </p>
                  {/* BASE URL 与端点选择 */}
                  <div className='flex flex-col md:flex-row items-center justify-center gap-4 w-full mt-4 md:mt-6 max-w-md'>
                    <Input
                      readonly
                      value={serverAddress}
                      className='flex-1 !rounded-full'
                      size={isMobile ? 'default' : 'large'}
                      suffix={
                        <div className='flex items-center gap-2'>
                          <ScrollList
                            bodyHeight={32}
                            style={{ border: 'unset', boxShadow: 'unset' }}
                          >
                            <ScrollItem
                              mode='wheel'
                              cycled={true}
                              list={endpointItems}
                              selectedIndex={endpointIndex}
                              onSelect={({ index }) => setEndpointIndex(index)}
                            />
                          </ScrollList>
                          <Button
                            type='primary'
                            onClick={handleCopyBaseURL}
                            icon={<IconCopy />}
                            className='!rounded-full'
                          />
                        </div>
                      }
                    />
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex flex-row gap-4 justify-center items-center'>
                  <Link to={userState.user ? '/dashboard' : '/login'}>
                    <Button
                      theme='solid'
                      type='primary'
                      size={isMobile ? 'default' : 'large'}
                      className='!rounded-3xl px-8 py-2'
                      icon={<IconPlay />}
                    >
                      {t('获取密钥')}
                    </Button>
                  </Link>
                  {isDemoSiteMode && statusState?.status?.version ? (
                    <Button
                      size={isMobile ? 'default' : 'large'}
                      className='flex items-center !rounded-3xl px-6 py-2'
                      icon={<IconGithubLogo />}
                      onClick={() =>
                        window.open(
                          'https://github.com/QuantumNous/new-api',
                          '_blank',
                        )
                      }
                    >
                      {statusState.status.version}
                    </Button>
                  ) : (
                    docsLink && (
                      <Button
                        size={isMobile ? 'default' : 'large'}
                        className='flex items-center !rounded-3xl px-6 py-2'
                        icon={<IconFile />}
                        onClick={() => window.open(docsLink, '_blank')}
                      >
                        {t('文档')}
                      </Button>
                    )
                  )}
                </div>

                {/* 框架兼容性图标 */}
                <div className='mt-12 md:mt-16 lg:mt-20 w-full'>
                  <div className='flex items-center mb-6 md:mb-8 justify-center'>
                    <Text
                      type='tertiary'
                      className='text-lg md:text-xl lg:text-2xl font-light'
                    >
                      {t('支持众多的大模型供应商')}
                    </Text>
                  </div>
                  <div className='flex flex-wrap items-center justify-center gap-3 sm:gap-4 md:gap-6 lg:gap-8 max-w-5xl mx-auto px-4'>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Moonshot size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <OpenAI size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <XAI size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Zhipu.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Volcengine.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Cohere.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Claude.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Gemini.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Suno size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Minimax.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Wenxin.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Spark.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Qingyan.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <DeepSeek.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Qwen.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Midjourney size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Grok size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <AzureAI.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Hunyuan.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Xinference.Color size={40} />
                    </div>
                    <div className='w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center'>
                      <Typography.Text className='!text-lg sm:!text-xl md:!text-2xl lg:!text-3xl font-bold'>
                        30+
                      </Typography.Text>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className='overflow-x-hidden w-full'>
          {homePageContent.startsWith('https://') ? (
            <iframe
              src={homePageContent}
              className='w-full h-screen border-none'
            />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: homePageContent }} />
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
