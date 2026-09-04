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

import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Switch,
  Table,
  Tag,
} from '@douyinfe/semi-ui';
import { IconMore } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { CHANNEL_OPTIONS } from '../../constants/channel.constants';
import PluginIcon from './PluginIcon';
import { isStaleFactoryOverride } from './lib/marketplace';
import { resolveLocalizedText } from './lib/localizedText';

const getChannelTypeLabel = (type) =>
  CHANNEL_OPTIONS.find((option) => option.value === type)?.label || '';

const SourceCell = ({ plugin, t }) => {
  if (plugin.source === 'factory') {
    return <Tag color='grey'>{t('内置')}</Tag>;
  }
  if (plugin.source === 'override_over_factory') {
    const factoryVersion = plugin.factory_meta?.version;
    const staleHint = isStaleFactoryOverride(plugin)
      ? t('内置版本为 v{{factory}}；删除自定义版本即可恢复', {
          factory: factoryVersion,
        })
      : null;
    return (
      <div className='flex min-w-0 flex-col gap-0.5' title={staleHint || undefined}>
        <Tag color='blue'>
          {t('自定义（覆盖内置 v{{version}}）', {
            version: factoryVersion,
          })}
        </Tag>
        {staleHint ? (
          <span className='text-xs text-gray-400'>{staleHint}</span>
        ) : null}
      </div>
    );
  }
  return <Tag color='blue'>{t('第三方')}</Tag>;
};

const RuntimeStatusCell = ({ plugin, t }) => {
  const status = plugin.runtime_status;
  if (status === 'registered') {
    return <Tag color='grey' size='small'>{t('已注册')}</Tag>;
  }
  if (status === 'compile_failed') {
    return (
      <Tag color='red' size='small' className='cursor-help' title={plugin.runtime_error}>
        {t('编译失败')}
      </Tag>
    );
  }
  if (status === 'disabled') {
    return <Tag color='grey' size='small'>{t('已禁用')}</Tag>;
  }
  if (status === 'disabled_fallback') {
    return (
      <Tag color='orange' size='small'>
        {plugin.factory_meta
          ? t('已禁用；已回退到内置')
          : t('已禁用；平台不可用')}
      </Tag>
    );
  }
  return <Tag color='grey' size='small'>{t('未注册')}</Tag>;
};

const PluginsTable = ({ plugins, loading, onDetails, onUpload, pluginsData }) => {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [blockedUsage, setBlockedUsage] = useState(null);
  const [blockedAction, setBlockedAction] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [statusPending, setStatusPending] = useState(false);

  const filtered = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return plugins;
    return plugins.filter((plugin) => {
      const haystack = `${plugin.meta?.name ?? ''} ${plugin.meta?.key ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [plugins, filter]);

  const handleToggle = async (plugin, checked) => {
    setStatusTarget(plugin);
    setStatusPending(true);
    try {
      const result = await pluginsData.setPluginStatus(plugin.meta.key, checked);
      if (result.blocked) {
        setBlockedUsage(result);
        setBlockedAction('disable');
      }
    } finally {
      setStatusPending(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      const result = await pluginsData.deleteVersion(
        deleteTarget.meta.key,
        deleteTarget.meta.version,
      );
      if (result.blocked) {
        setBlockedUsage(result);
        setBlockedAction('delete');
        return;
      }
      setDeleteTarget(null);
    } finally {
      setDeletePending(false);
    }
  };

  const closeBlocked = () => {
    setBlockedAction(null);
    setBlockedUsage(null);
  };

  const handleBlockedCascade = async () => {
    if (!statusTarget) return;
    setStatusPending(true);
    try {
      const result = await pluginsData.setPluginStatus(
        statusTarget.meta.key,
        false,
        { cascade: true },
      );
      if (!result.blocked) closeBlocked();
    } finally {
      setStatusPending(false);
    }
  };

  const handleBlockedForce = async () => {
    if (blockedAction === 'delete' && deleteTarget) {
      setDeletePending(true);
      try {
        const result = await pluginsData.deleteVersion(
          deleteTarget.meta.key,
          deleteTarget.meta.version,
          true,
        );
        if (!result.blocked) {
          setDeleteTarget(null);
          closeBlocked();
        }
      } finally {
        setDeletePending(false);
      }
      return;
    }
    if (blockedAction === 'disable' && statusTarget) {
      setStatusPending(true);
      try {
        const result = await pluginsData.setPluginStatus(
          statusTarget.meta.key,
          false,
          { cascade: true, force: true },
        );
        if (!result.blocked) closeBlocked();
      } finally {
        setStatusPending(false);
      }
    }
  };

  const columns = [
    {
      title: t('插件'),
      render: (value, plugin) => {
        const description = resolveLocalizedText(
          plugin.meta?.description,
          i18n.language,
        );
        return (
          <div
            className='flex min-w-0 items-center gap-2'
            title={description || undefined}
          >
            <span className='shrink-0'>
              <PluginIcon plugin={plugin.meta} size={18} />
            </span>
            <div className='min-w-0'>
              <div className='truncate text-sm font-medium'>
                {plugin.meta?.name}
              </div>
              <div className='truncate font-mono text-xs text-gray-400'>
                {plugin.meta?.key}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: t('生效版本'),
      width: 110,
      render: (value, plugin) => (
        <span className='font-mono text-xs'>{plugin.meta?.version}</span>
      ),
    },
    {
      title: t('来源'),
      width: 180,
      render: (value, plugin) => <SourceCell plugin={plugin} t={t} />,
    },
    {
      title: t('渠道类型'),
      width: 140,
      render: (value, plugin) => {
        const channelTypes = plugin.meta?.channelTypes ?? [];
        if (channelTypes.length === 0) {
          return <span className='text-xs text-gray-400'>—</span>;
        }
        return (
          <span className='text-xs'>
            {getChannelTypeLabel(channelTypes[0])}
            <span className='ml-1 text-gray-400'>
              {channelTypes.map((type) => `#${type}`).join(' ')}
            </span>
          </span>
        );
      },
    },
    {
      title: t('API 版本'),
      width: 90,
      render: (value, plugin) => (
        <span className='font-mono text-xs'>v{plugin.meta?.apiVersion}</span>
      ),
    },
    {
      title: t('模型'),
      width: 70,
      render: (value, plugin) => plugin.meta?.models?.length ?? 0,
    },
    {
      title: t('已启用'),
      width: 80,
      render: (value, plugin) => (
        <Switch
          checked={plugin.enabled}
          disabled={statusPending}
          onChange={(checked) => handleToggle(plugin, checked)}
        />
      ),
    },
    {
      title: t('运行状态'),
      width: 160,
      render: (value, plugin) => (
        <RuntimeStatusCell plugin={plugin} t={t} />
      ),
    },
    {
      title: t('操作'),
      width: 56,
      render: (value, plugin) => (
        <Dropdown
          trigger='click'
          position='bottomRight'
          menu={[
            {
              node: 'item',
              name: t('详情'),
              onClick: () => onDetails?.(plugin),
            },
            {
              node: 'item',
              name: t('上传新版本'),
              onClick: () => onUpload?.(plugin.meta?.key),
            },
            {
              node: 'item',
              name: t('删除当前自定义版本'),
              disabled: plugin.source === 'factory',
              onClick: () => setDeleteTarget(plugin),
            },
          ]}
        >
          <Button icon={<IconMore />} type='tertiary' size='small' />
        </Dropdown>
      ),
    },
  ];

  return (
    <>
      <div className='mb-3 flex justify-end'>
        <Input
          className='max-w-xs'
          showClear
          value={filter}
          onChange={setFilter}
          placeholder={t('筛选插件...')}
        />
      </div>
      <Table
        columns={columns}
        dataSource={filtered}
        rowKey={(record) => record.meta?.key}
        loading={loading}
        empty={
          <Empty
            title={t('未找到任务插件')}
            description={t('上传任务插件以添加平台。')}
          />
        }
        pagination={false}
      />

      <Modal
        title={t('删除插件版本？')}
        visible={Boolean(deleteTarget)}
        onOk={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        onMaskClick={() => setDeleteTarget(null)}
        okButtonProps={{
          type: 'danger',
          loading: deletePending,
          children: t('删除'),
        }}
        cancelButtonProps={{ disabled: deletePending, children: t('取消') }}
      >
        {deleteTarget?.factory_meta
          ? t('删除此自定义版本不会禁用平台，同名内置插件将自动恢复。')
          : t('该插件没有内置回退版本，删除或禁用后此平台将不可用。')}
      </Modal>

      <Modal
        title={t('插件仍在使用中')}
        visible={Boolean(blockedAction)}
        onOk={closeBlocked}
        onCancel={closeBlocked}
        onMaskClick={closeBlocked}
        cancelButtonProps={{ disabled: statusPending || deletePending }}
        footer={
          <div className='flex flex-wrap gap-2'>
            {blockedAction === 'disable' &&
            blockedUsage?.channels?.length ? (
              <Button
                type='tertiary'
                loading={statusPending}
                onClick={handleBlockedCascade}
              >
                {t('级联禁用渠道')}
              </Button>
            ) : null}
            <Button
              type='danger'
              loading={statusPending || deletePending}
              onClick={handleBlockedForce}
            >
              {t('强制操作')}
            </Button>
          </div>
        }
      >
        <div className='space-y-2 text-sm'>
          <p>
            {t('{{count}} 个已启用渠道和 {{tasks}} 个进行中任务仍在使用此插件。', {
              count: blockedUsage?.channels?.length ?? 0,
              tasks: blockedUsage?.inFlightCount ?? 0,
            })}
          </p>
          {blockedUsage?.channels?.length > 0 && (
            <ul className='list-disc pl-5'>
              {blockedUsage.channels.map((channel) => (
                <li key={channel.id}>
                  #{channel.id} {channel.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
};

export default PluginsTable;
