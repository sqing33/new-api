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

import { Button, Tag } from '@douyinfe/semi-ui';
import { ArrowUpCircle, CheckCircle2, Download, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CHANNEL_OPTIONS } from '../../constants/channel.constants';
import PluginIcon from './PluginIcon';
import {
  findMarketplaceVersion,
  marketplaceBuiltInVersion,
  resolveMarketplaceActionPolicy,
} from './lib/marketplace';
import { resolveLocalizedText } from './lib/localizedText';

const getChannelTypeLabel = (type) =>
  CHANNEL_OPTIONS.find((option) => option.value === type)?.label || '';

const InstallStateBadge = ({ state, t }) => {
  if (state.status === 'not_installed') {
    return <Tag size='small'>{t('未安装')}</Tag>;
  }
  if (state.status === 'up_to_date') {
    return (
      <Tag color='green' size='small'>
        <CheckCircle2 size={12} className='mr-1 inline' />
        {t('已是最新')}
      </Tag>
    );
  }
  if (state.status === 'upgradable') {
    return (
      <Tag
        color='blue'
        size='small'
        title={t('可升级：v{{installed}} → v{{latest}}', {
          installed: state.installedVersion,
          latest: state.latestVersion,
        })}
      >
        <ArrowUpCircle size={12} className='mr-1 inline' />
        <span className='font-mono'>
          v{state.installedVersion} → v{state.latestVersion}
        </span>
      </Tag>
    );
  }
  return (
    <Tag color='red' size='small'>
      {t('已安装 v{{installed}} 不在列表中', {
        installed: state.installedVersion,
      })}
    </Tag>
  );
};

const getActionLabel = (state, t) => {
  if (state.status === 'not_installed') return t('安装');
  if (state.status === 'up_to_date') return t('重装最新版');
  return t('审查并升级');
};

const MarketplacePluginCard = ({
  plugin,
  installState,
  installed,
  onInstall,
}) => {
  const { t, i18n } = useTranslation();
  const description = resolveLocalizedText(plugin.description, i18n.language);
  const channelTypes = plugin.channelTypes ?? [];
  const latestEntry = findMarketplaceVersion(plugin, plugin.latest);
  const actionPolicy = resolveMarketplaceActionPolicy(installed);
  const builtInVersion = marketplaceBuiltInVersion(installed);

  return (
    <div className='flex h-full flex-col gap-2.5 rounded-xl border p-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <span className='mt-0.5 shrink-0'>
            <PluginIcon plugin={plugin} size={20} />
          </span>
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium'>{plugin.name}</div>
            <div className='truncate font-mono text-xs text-gray-400'>
              {plugin.key}
            </div>
          </div>
        </div>
        <InstallStateBadge state={installState} t={t} />
      </div>

      {description ? (
        <p className='line-clamp-2 text-xs text-gray-400'>{description}</p>
      ) : null}

      <div className='grid grid-cols-3 gap-x-3 gap-y-1'>
        <div className='min-w-0'>
          <div className='select-none text-[11px] font-medium text-gray-400'>
            {t('最新版本')}
          </div>
          <div className='truncate font-mono text-xs'>{plugin.latest}</div>
        </div>
        <div className='min-w-0'>
          <div className='select-none text-[11px] font-medium text-gray-400'>
            {t('渠道类型')}
          </div>
          <div className='truncate text-xs'>
            {channelTypes.length > 0
              ? getChannelTypeLabel(channelTypes[0])
              : '—'}
          </div>
        </div>
        <div className='min-w-0'>
          <div className='select-none text-[11px] font-medium text-gray-400'>
            {t('模型')}
          </div>
          <div className='truncate text-xs'>{plugin.models?.length ?? 0}</div>
        </div>
      </div>

      {builtInVersion && (
        <div className='text-xs'>
          <span className='select-none text-[11px] font-medium text-gray-400'>
            {t('版本')}
          </span>{' '}
          <span className='font-mono'>
            {t('内置 v{{factory}} / 市场 v{{market}}', {
              factory: builtInVersion,
              market: plugin.latest,
            })}
          </span>
        </div>
      )}

      {!latestEntry?.sha256 && (
        <div className='flex items-center gap-1 text-xs text-red-500'>
          <TriangleAlert size={12} className='shrink-0' />
          {t('无完整性哈希')}
        </div>
      )}

      <div className='mt-auto border-t pt-2'>
        {actionPolicy.kind === 'system_update' ? (
          <Tag color='grey'>{t('随系统更新')}</Tag>
        ) : (
          <Button
            className='w-full'
            size='small'
            type={installState.status === 'up_to_date' ? 'tertiary' : 'primary'}
            icon={<Download size={14} />}
            onClick={onInstall}
          >
            {getActionLabel(installState, t)}
          </Button>
        )}
      </div>
    </div>
  );
};

export default MarketplacePluginCard;
