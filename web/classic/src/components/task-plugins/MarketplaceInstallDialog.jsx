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

import { Banner, Button, Modal, Space, Spin, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import JavaScriptViewer from './JavaScriptViewer';
import SourceDiff from './SourceDiff';
import {
  computeSourceSha256,
  fetchPluginSourceText,
  PluginSourceFetchError,
} from './lib/pluginUrl';
import { findMarketplaceVersion, resolvePluginSourceUrl } from './lib/marketplace';
import { CHANNEL_OPTIONS } from '../../constants/channel.constants';

const getChannelTypeLabel = (type) =>
  CHANNEL_OPTIONS.find((option) => option.value === type)?.label || '';

const MarketplaceInstallDialog = ({
  target,
  onInstall,
  onClose,
}) => {
  const { t } = useTranslation();
  const pluginKey = target?.plugin?.key ?? '';
  const entry = target
    ? findMarketplaceVersion(target.plugin, target.version)
    : undefined;
  const isUpgrade = target
    ? target.installState.status !== 'not_installed'
    : false;

  const [fetching, setFetching] = useState(false);
  const [sourceData, setSourceData] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [installedSource, setInstalledSource] = useState(null);
  const [installedVersion, setInstalledVersion] = useState('');
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const [activeTab, setActiveTab] = useState(isUpgrade ? 'diff' : 'source');

  useEffect(() => {
    setFetching(false);
    setSourceData(null);
    setFetchError('');
    setInstalledSource(null);
    setInstalledVersion('');
    setLoadingInstalled(false);
    setInstalling(false);
    setInstallError('');
    setActiveTab(isUpgrade ? 'diff' : 'source');
    if (!target || !entry) return undefined;

    let cancelled = false;
    (async () => {
      setFetching(true);
      try {
        const url = resolvePluginSourceUrl(
          target.source.index_url,
          entry.path,
        );
        if (!url) {
          throw new Error(
            t('该插件路径无法解析到索引所在 origin 内。'),
          );
        }
        const text = await fetchPluginSourceText(url);
        // 仅用于展示：上传请求携带索引中的哈希，服务端会重新计算校验，
        // 被篡改的浏览器无法把不匹配的源伪装成已验证
        const digest = await computeSourceSha256(text);
        if (!cancelled) setSourceData({ url, text, digest });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PluginSourceFetchError) {
          setFetchError(
            err.reason === 'too_large'
              ? t('插件源码超过 1 MiB 上限。')
              : t('浏览器无法抓取插件源码。托管站点可能屏蔽跨域请求或不可达。'),
          );
        } else {
          setFetchError(err.message);
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    if (isUpgrade) {
      setLoadingInstalled(true);
      API.get(`/api/plugin/task/${encodeURIComponent(pluginKey)}`, {
        skipErrorHandler: true,
      })
        .then((res) => {
          if (cancelled) return;
          if (res.data?.success) {
            setInstalledSource(res.data.data?.source ?? '');
            setInstalledVersion(res.data.data?.meta?.version ?? '');
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoadingInstalled(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [target, entry, isUpgrade, pluginKey, t]);

  const digestMismatch = Boolean(
    entry?.sha256 &&
      sourceData?.digest &&
      sourceData.digest.toLowerCase() !== entry.sha256.toLowerCase(),
  );

  const handleInstall = async () => {
    if (!sourceData) return;
    setInstalling(true);
    setInstallError('');
    try {
      const result = await onInstall({
        plugin: target.plugin,
        sourceText: sourceData.text,
        sourceSha256: entry?.sha256,
      });
      if (result?.success) {
        onClose();
      } else {
        setInstallError(result?.message || t('上传失败'));
      }
    } finally {
      setInstalling(false);
    }
  };

  if (!target) return null;

  const confirmLabel = installing
    ? t('安装中...')
    : isUpgrade
      ? t('升级并启用')
      : t('安装并启用');

  return (
    <Modal
      title={
        isUpgrade
          ? t('升级 {{name}}', { name: target.plugin.name })
          : t('安装 {{name}}', { name: target.plugin.name })
      }
      visible
      onOk={handleInstall}
      onCancel={onClose}
      onMaskClick={onClose}
      width={880}
      okButtonProps={{
        loading: installing,
        disabled: !sourceData || digestMismatch,
        icon: <Download size={14} />,
        children: confirmLabel,
      }}
      cancelButtonProps={{ children: t('取消') }}
    >
      <div className='space-y-4'>
        <p className='text-sm text-gray-400'>
          {t('{{key}} · 版本 {{version}} · 来自 {{source}}', {
            key: pluginKey,
            version: target.version,
            source: target.source.name,
          })}
        </p>

        <Banner
          type='danger'
          title={t('第三方插件风险')}
          description={t('上传插件属于管理员级别的信任决策。插件可以访问渠道凭据并构造上游请求。启用前请审查其源码与差异。')}
        />

        <div className='space-y-2 rounded-md border p-3 text-sm'>
          <p className='font-medium'>{t('声明的能力')}</p>
          <dl className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            <div>
              <dt className='text-xs text-gray-400'>{t('允许的主机')}</dt>
              <dd className='break-all font-mono text-xs'>
                {entry?.allowedHosts?.length
                  ? entry.allowedHosts.join(', ')
                  : t('未声明')}
              </dd>
            </div>
            <div>
              <dt className='text-xs text-gray-400'>
                {t('渠道类型')}
              </dt>
              <dd className='text-xs'>
                {target.plugin.channelTypes?.length
                  ? target.plugin.channelTypes
                      .map(
                        (type) =>
                          `${getChannelTypeLabel(type)} (#${type})`,
                      )
                      .join(', ')
                  : t('未声明')}
              </dd>
            </div>
            <div>
              <dt className='text-xs text-gray-400'>
                {t('认证方式')}
              </dt>
              <dd className='font-mono text-xs'>
                {entry?.auth || t('未声明')}
              </dd>
            </div>
            <div>
              <dt className='text-xs text-gray-400'>
                {t('完整性哈希')}
              </dt>
              <dd className='break-all font-mono text-xs'>
                {entry?.sha256 ?? t('该来源未提供')}
              </dd>
            </div>
          </dl>
          <p className='text-xs text-gray-400'>
            {t('这些值来自来源索引，仅供审查。网关根据从源码编译出的元数据接纳插件。')}
          </p>
        </div>

        {!entry?.sha256 && (
          <Banner
            type='warning'
            title={t('无完整性哈希')}
            description={t('该来源未为这个版本发布 sha256，下载的源码无法固定为来源意图的内容。')}
          />
        )}

        {digestMismatch && (
          <Banner
            type='danger'
            title={t('完整性校验失败')}
            description={t('下载的源码与索引中声明的 sha256 不一致，请勿安装。')}
          />
        )}

        {fetching && (
          <div className='flex items-center gap-2 text-sm'>
            <Spin size='small' />
            {t('正在抓取插件源码...')}
          </div>
        )}

        {fetchError && <p className='text-sm text-red-500'>{fetchError}</p>}

        {sourceData && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type='capsule'
          >
            <TabPane tab={t('来源')} itemKey='source'>
              <JavaScriptViewer value={sourceData.text} className='h-[28rem]' />
            </TabPane>
            {isUpgrade && (
              <TabPane tab={t('源码对比')} itemKey='diff'>
                {loadingInstalled ? (
                  <div className='flex items-center gap-2 text-sm'>
                    <Spin size='small' />
                    {t('正在加载已安装源码...')}
                  </div>
                ) : (
                  <div className='space-y-2'>
                    <p className='text-xs text-gray-400'>
                      {t('已安装 v{{from}} → 市场 v{{to}}', {
                        from: installedVersion,
                        to: target.version,
                      })}
                    </p>
                    <SourceDiff
                      before={installedSource ?? ''}
                      after={sourceData.text}
                    />
                  </div>
                )}
              </TabPane>
            )}
          </Tabs>
        )}

        {target.installState.status === 'diverged' && (
          <Banner
            type='warning'
            title={t('已安装版本不在该索引中')}
            description={t('已安装 v{{installed}}，但该来源未列出该版本。安装将以 v{{target}} 替换。', {
              installed: target.installState.installedVersion,
              target: target.version,
            })}
          />
        )}

        {installError && (
          <div className='space-y-1'>
            <p className='text-sm font-medium text-red-500'>
              {t('网关拒绝了该插件')}
            </p>
            <p className='whitespace-pre-wrap text-sm text-red-500'>
              {installError}
            </p>
            <p className='text-xs text-gray-400'>
              {t('市场安装不会强制跳过冲突。请在任务插件页面解决冲突后重新安装。')}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default MarketplaceInstallDialog;
