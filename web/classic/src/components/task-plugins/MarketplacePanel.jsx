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

import { Banner, Button, Select, Skeleton, Tag, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Settings2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveInstallState,
  indexHasIntegrityHashes,
  isDefaultMarketplaceSource,
  parseMarketplaceIndex,
} from './lib/marketplace';
import MarketplacePluginCard from './MarketplacePluginCard';
import MarketplaceInstallDialog from './MarketplaceInstallDialog';
import MarketplaceSourcesDialog from './MarketplaceSourcesDialog';

const MarketplacePanel = ({
  sources,
  sourcesLoading,
  saveSources,
  plugins,
  onInstall,
}) => {
  const { t } = useTranslation();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState('');
  const [installTarget, setInstallTarget] = useState(null);
  const [index, setIndex] = useState(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState('');

  const sourcesList = sources ?? [];
  const selectedSource =
    sourcesList.find((source) => source.index_url === selectedSourceUrl) ??
    sourcesList[0];

  const loadIndex = useCallback(
    async (sourceUrl) => {
      if (!sourceUrl) return;
      setIndexLoading(true);
      setIndexError('');
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error(
            t('索引请求返回 HTTP {{status}}', {
              status: response.status,
            }),
          );
        }
        setIndex(parseMarketplaceIndex(await response.json()));
      } catch (err) {
        setIndex(null);
        setIndexError(err.message);
      } finally {
        setIndexLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    setIndex(null);
    if (selectedSource) {
      loadIndex(selectedSource.index_url);
    }
  }, [selectedSource?.index_url, loadIndex]);

  const handleSaveSources = async (nextSources) => {
    const saved = await saveSources(nextSources);
    if (saved) {
      setSourcesOpen(false);
      setSelectedSourceUrl('');
    }
  };

  const handleInstall = async ({ plugin, sourceText, sourceSha256 }) => {
    const result = await onInstall({
      plugin,
      sourceText,
      sourceSha256,
    });
    if (result?.success) {
      setInstallTarget(null);
      loadIndex(selectedSource?.index_url);
    }
    return result;
  };

  const isOfficial = selectedSource
    ? isDefaultMarketplaceSource(selectedSource.index_url)
    : false;
  const missingHashes = index ? !indexHasIntegrityHashes(index) : false;

  return (
    <>
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <p className='text-sm text-gray-400'>
            {t('插件索引由浏览器抓取。安装走与手动上传相同的审查与准入流程。')}
          </p>
          <div className='flex shrink-0 gap-2'>
            <Button
              size='small'
              type='tertiary'
              icon={<RefreshCw size={14} />}
              disabled={!selectedSource || indexLoading}
              onClick={() => loadIndex(selectedSource?.index_url)}
            >
              {t('刷新')}
            </Button>
            <Button
              size='small'
              type='tertiary'
              icon={<Settings2 size={14} />}
              onClick={() => setSourcesOpen(true)}
            >
              {t('管理来源')}
            </Button>
          </div>
        </div>

        {sourcesLoading ? (
          <Skeleton active className='h-24 w-full' />
        ) : (
          <>
            {sourcesList.length > 0 ? (
              <div className='flex flex-wrap items-center gap-2'>
                {sourcesList.length > 1 && (
                  <Select
                    className='w-64'
                    value={selectedSource?.index_url}
                    optionList={sourcesList.map((source) => ({
                      label: t(source.name),
                      value: source.index_url,
                    }))}
                    onChange={(value) => setSelectedSourceUrl(value || '')}
                  />
                )}
                {selectedSource && (
                  <>
                    <Typography.Text strong>
                      {index?.name || t(selectedSource.name)}
                    </Typography.Text>
                    {isOfficial ? (
                      <Tag color='grey' size='small'>{t('官方')}</Tag>
                    ) : (
                      <Tag color='red' size='small'>
                        {t('第三方 — 风险自担')}
                      </Tag>
                    )}
                    {missingHashes && (
                      <Tag color='red' size='small'>
                        <TriangleAlert size={12} className='mr-1 inline' />
                        {t('无完整性校验')}
                      </Tag>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className='rounded-md border p-6 text-center'>
                <p className='text-sm font-medium'>
                  {t('未配置市场来源。')}
                </p>
                <p className='mb-3 text-xs text-gray-400'>
                  {t('添加索引 URL 以浏览可安装插件。')}
                </p>
                <Button size='small' onClick={() => setSourcesOpen(true)}>
                  {t('管理来源')}
                </Button>
              </div>
            )}
          </>
        )}

        {selectedSource && indexLoading && (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            <Skeleton active className='h-40 w-full' />
            <Skeleton active className='h-40 w-full' />
            <Skeleton active className='h-40 w-full' />
          </div>
        )}

        {selectedSource && indexError && !indexLoading && (
          <Banner
            type='danger'
            title={t('无法加载此来源')}
            description={t('索引无法抓取或解析：{{message}}。托管站点可能屏蔽跨域请求。', {
              message: indexError,
            })}
          />
        )}

        {selectedSource && index && !indexLoading && (
          <>
            {index.plugins.length === 0 && (
              <p className='text-sm text-gray-400'>
                {t('该来源未列出可安装的任务插件。')}
              </p>
            )}
            {index.plugins.length > 0 && (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3'>
                {index.plugins.map((plugin) => {
                  const installState = deriveInstallState(plugin, plugins);
                  return (
                    <MarketplacePluginCard
                      key={plugin.key}
                      plugin={plugin}
                      installState={installState}
                      installed={plugins.find(
                        (item) => item.meta?.key === plugin.key,
                      )}
                      onInstall={() =>
                        setInstallTarget({
                          source: selectedSource,
                          plugin,
                          version: plugin.latest,
                          installState,
                        })
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <MarketplaceSourcesDialog
        visible={sourcesOpen}
        sources={sourcesList}
        onSave={handleSaveSources}
        onClose={() => setSourcesOpen(false)}
      />
      <MarketplaceInstallDialog
        target={installTarget}
        onInstall={handleInstall}
        onClose={() => setInstallTarget(null)}
      />
    </>
  );
};

export default MarketplacePanel;
