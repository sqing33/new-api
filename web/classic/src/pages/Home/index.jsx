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

import React, { useContext, useEffect, useState } from 'react';
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
  ArrowRight,
  Image as ImageIcon,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import NoticeModal from '../../components/layout/NoticeModal';
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

const DEFAULT_GALLERY_IMAGES = [
  {
    imageUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=85',
    title: '城市黄昏',
    prompt: '金色夕阳下的未来城市天际线，电影感光影',
    model: 'GPT Image',
    tag: '电影感',
    aspect: 'landscape',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85',
    title: '霓虹雨夜',
    prompt: '赛博朋克街区，湿润路面反射霓虹灯牌',
    model: 'Flux',
    tag: '赛博朋克',
    aspect: 'portrait',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fit=crop&w=900&q=85',
    title: '沙丘日出',
    prompt: '极简沙漠与柔和日出，低饱和高级配色',
    model: 'Imagen',
    tag: '极简',
    aspect: 'square',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=85',
    title: '山谷晨雾',
    prompt: '高山森林、晨雾、自然纪录片式构图',
    model: 'GPT Image',
    tag: '自然',
    aspect: 'landscape',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=900&q=85',
    title: '柔和彩纸',
    prompt: '彩色纸艺装置，干净背景，商业海报质感',
    model: 'Flux',
    tag: '商业',
    aspect: 'square',
  },
  {
    imageUrl:
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=85',
    title: '湖畔光影',
    prompt: '静谧湖泊与远山，柔和自然光，宽幅构图',
    model: 'Imagen',
    tag: '风景',
    aspect: 'landscape',
  },
];

const aspectClassName = {
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
  landscape: 'aspect-[4/3]',
};

const normalizeGalleryItem = (item = {}, index = 0) => ({
  imageUrl: String(item.imageUrl || item.url || '').trim(),
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

const Home = () => {
  const { t, i18n } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [homePageMode, setHomePageMode] = useState('image_showcase');
  const [galleryImages, setGalleryImages] = useState(DEFAULT_GALLERY_IMAGES);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const isMobile = useIsMobile();
  const isDemoSiteMode = statusState?.status?.demo_site_enabled || false;
  const docsLink = statusState?.status?.docs_link || '';
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;
  const endpointItems = API_ENDPOINTS.map((e) => ({ value: e }));
  const [endpointIndex, setEndpointIndex] = useState(0);
  const isChinese = i18n.language.startsWith('zh');

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_settings');
    const { success, message, data } = res.data;
    if (success) {
      const mode = data?.mode || 'image_showcase';
      const rawContent = data?.content || '';
      const parsedGallery = parseGalleryImages(data?.gallery_images);
      setHomePageMode(mode);
      setGalleryImages(
        parsedGallery.length > 0 ? parsedGallery : DEFAULT_GALLERY_IMAGES,
      );

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
    <div className='mt-[60px] h-[calc(100vh-64px)] overflow-y-auto bg-semi-color-bg-0'>
      <section className='px-4 py-10 md:px-8 lg:px-12'>
        <div className='mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center'>
          <div className='flex flex-col gap-6'>
            <div className='inline-flex w-fit items-center gap-2 rounded-full border border-semi-color-border bg-semi-color-bg-1 px-3 py-1 text-sm text-semi-color-text-1'>
              <Sparkles size={15} />
              <span>{t('AI 生图创作平台')}</span>
            </div>
            <div className='flex flex-col gap-4'>
              <h1 className='m-0 text-4xl font-bold leading-tight text-semi-color-text-0 md:text-5xl lg:text-6xl'>
                {t('把灵感变成可用的视觉作品')}
              </h1>
              <p className='m-0 max-w-2xl text-base leading-7 text-semi-color-text-1 md:text-lg'>
                {t(
                  '从提示词、参考图到商品图工作流，用统一模型与分组能力完成创意生成。',
                )}
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <Link to='/image-studio'>
                <Button
                  icon={<WandSparkles size={16} />}
                  size={isMobile ? 'default' : 'large'}
                  theme='solid'
                  type='primary'
                >
                  {t('开始生图')}
                </Button>
              </Link>
              <Link to='/console'>
                <Button
                  icon={<ArrowRight size={16} />}
                  size={isMobile ? 'default' : 'large'}
                  theme='outline'
                >
                  {t('进入控制台')}
                </Button>
              </Link>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3 md:grid-cols-3'>
            {galleryImages.slice(0, 6).map((item, index) => (
              <div
                className={`group relative overflow-hidden rounded-lg border border-semi-color-border bg-semi-color-bg-1 ${
                  aspectClassName[item.aspect] || aspectClassName.square
                } ${index === 1 || index === 4 ? 'md:translate-y-8' : ''}`}
                key={`${item.imageUrl}-${index}`}
              >
                <img
                  alt={item.title}
                  className='h-full w-full object-cover transition duration-300 group-hover:scale-105'
                  loading={index > 1 ? 'lazy' : 'eager'}
                  src={item.imageUrl}
                />
                <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 text-white'>
                  <div className='flex items-center gap-2 text-xs'>
                    {item.tag && (
                      <span className='rounded-full bg-white/18 px-2 py-0.5'>
                        {item.tag}
                      </span>
                    )}
                    {item.model && (
                      <span className='opacity-80'>{item.model}</span>
                    )}
                  </div>
                  <div className='mt-2 line-clamp-1 text-sm font-semibold'>
                    {item.title}
                  </div>
                  {item.prompt && (
                    <div className='mt-1 line-clamp-2 text-xs opacity-80'>
                      {item.prompt}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='border-t border-semi-color-border px-4 py-8 md:px-8 lg:px-12'>
        <div className='mx-auto grid max-w-7xl grid-cols-1 gap-3 md:grid-cols-3'>
          {[
            [t('多模型统一'), t('复用现有用户模型、分组和余额逻辑')],
            [t('参考图编辑'), t('支持上传参考图并自动切换编辑模式')],
            [t('商品图工作流'), t('一键生成主图、封面、海报和头图')],
          ].map(([title, desc]) => (
            <div
              className='rounded-lg border border-semi-color-border bg-semi-color-bg-1 p-5'
              key={title}
            >
              <ImageIcon className='mb-4 text-semi-color-primary' size={22} />
              <div className='text-base font-semibold text-semi-color-text-0'>
                {title}
              </div>
              <div className='mt-2 text-sm leading-6 text-semi-color-text-2'>
                {desc}
              </div>
            </div>
          ))}
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
                  <Link to='/console'>
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
            <div
              className='mt-[60px]'
              dangerouslySetInnerHTML={{ __html: homePageContent }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
