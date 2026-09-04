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

import React, { useState } from 'react';
import {
  Button,
  Modal,
  Popover,
  Space,
  Switch,
  Tabs,
  TabPane,
  Typography,
} from '@douyinfe/semi-ui';
import { CircleHelp, Upload } from 'lucide-react';
import PluginsTable from '../../components/task-plugins/PluginsTable';
import MarketplacePanel from '../../components/task-plugins/MarketplacePanel';
import PluginDetailSheet from '../../components/task-plugins/PluginDetailSheet';
import UploadDialog from '../../components/task-plugins/UploadDialog';
import { useTaskPluginsData } from '../../hooks/task-plugins/useTaskPluginsData';
import { API } from '../../helpers';

const { Title } = Typography;

const TaskPluginsPage = () => {
  const data = useTaskPluginsData();
  const { t } = data;
  const [tab, setTab] = useState('installed');
  const [detailPlugin, setDetailPlugin] = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const handleDetailClose = () => {
    setDetailPlugin(null);
    data.closeDetail();
  };

  const handleCompareVersion = (key, version) =>
    API.get(`/api/plugin/task/${key}`, { params: { version } });

  const overridePlugins = data.plugins.filter(
    (plugin) => plugin.source === 'override',
  );

  return (
    <div className='mt-[60px] px-2 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Title heading={4} className='!mb-0'>
          {t('任务插件')}
        </Title>
        <Space>
          <Switch
            checked={data.enabled}
            disabled={data.enabledLoading}
            onChange={(checked) => {
              if (checked) {
                data.setGlobalEnabled(true);
              } else {
                setConfirmDisable(true);
              }
            }}
          />
          <span className='hidden text-sm sm:inline'>
            {t('启用任务插件')}
          </span>
          <Popover
            content={
              <div className='max-w-[320px] space-y-2 text-sm'>
                <p className='font-medium'>{t('启用任务插件')}</p>
                <p className='text-gray-400'>
                  {t('关闭后，整个任务插件系统停止提供服务，包括内置插件与自定义插件。')}
                </p>
                <p className='font-medium'>
                  {t('内置插件与自定义插件行为')}
                </p>
                <p className='text-gray-400'>
                  {t('内置插件不能单独删除或禁用。自定义版本可以覆盖内置插件；删除或禁用该版本后会恢复内置插件。仅由第三方插件提供的平台，在其插件被删除或禁用后将不可用。')}
                </p>
              </div>
            }
            position='bottom'
          >
            <Button type='tertiary' size='small' icon={<CircleHelp size={14} />} aria-label={t('内置插件与自定义插件行为')} />
          </Popover>
          {tab === 'installed' && (
            <Button icon={<Upload size={14} />} onClick={() => data.openUpload()}>
              {t('上传插件')}
            </Button>
          )}
        </Space>
      </div>

      <Tabs activeKey={tab} onChange={setTab} type='capsule'>
        <TabPane tab={t('已安装')} itemKey='installed'>
          <PluginsTable
            plugins={data.plugins}
            loading={data.pluginsLoading}
            onDetails={(plugin) => {
              setDetailPlugin(plugin);
              data.openDetail(plugin.meta?.key);
            }}
            onUpload={(key) => data.openUpload(key)}
            pluginsData={data}
          />
        </TabPane>
        <TabPane tab={t('插件市场')} itemKey='marketplace'>
          <MarketplacePanel
            sources={data.sources}
            sourcesLoading={data.sourcesLoading}
            saveSources={data.saveSources}
            plugins={data.plugins}
            onInstall={data.installMarketplacePlugin}
          />
        </TabPane>
      </Tabs>

      <PluginDetailSheet
        plugin={detailPlugin}
        detail={data.detail}
        detailLoading={data.detailLoading}
        versions={data.versions}
        onActivateVersion={data.activateVersion}
        onCompareVersion={handleCompareVersion}
        onDryRun={data.dryRun}
        visible={Boolean(detailPlugin)}
        onClose={handleDetailClose}
      />

      <UploadDialog
        visible={data.uploadVisible}
        initialKey={data.uploadKey}
        onUpload={(payload) => data.uploadPlugin(payload)}
        onClose={data.closeUpload}
      />

      <Modal
        title={t('禁用任务插件？')}
        visible={confirmDisable}
        onOk={() => {
          data
            .setGlobalEnabled(false)
            .then((ok) => {
              if (ok) setConfirmDisable(false);
            });
        }}
        onCancel={() => setConfirmDisable(false)}
        onMaskClick={() => setConfirmDisable(false)}
        okButtonProps={{ type: 'danger', children: t('禁用') }}
        cancelButtonProps={{ children: t('取消') }}
      >
        <div className='space-y-2 text-sm'>
          <p>
            {t('所有内置与自定义插件将立即停止提供服务。进行中的任务将由超时清理机制处理。')}
          </p>
          {overridePlugins.length > 0 && (
            <ul className='list-disc pl-5'>
              {overridePlugins.map((plugin) => (
                <li key={plugin.meta?.key}>
                  {plugin.meta?.name} ({plugin.meta?.key}):{' '}
                  {t('{{channels}} 个渠道，{{tasks}} 个进行中任务', {
                    channels: plugin.channel_count,
                    tasks: plugin.in_flight_count,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default TaskPluginsPage;
