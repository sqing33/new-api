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
  Card,
  Select,
  Skeleton,
  SideSheet,
  Spin,
  Table,
  Tabs,
  TabPane,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import PluginMetadataCard from './PluginMetadataCard';
import UsageSchemaTable from './UsageSchemaTable';
import JavaScriptViewer from './JavaScriptViewer';
import SourceDiff from './SourceDiff';
import PluginSandbox from './PluginSandbox';
import { resolveLocalizedText } from './lib/localizedText';

const { Text } = Typography;

const PluginDetailSheet = ({
  plugin,
  detail,
  detailLoading,
  versions,
  onActivateVersion,
  onCompareVersion,
  onDryRun,
  visible,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('source');
  const [compareVersion, setCompareVersion] = useState('');
  const [compareSource, setCompareSource] = useState(null);
  const [comparing, setComparing] = useState(false);

  const key = plugin?.meta?.key ?? '';
  const description = resolveLocalizedText(
    detail?.meta?.description ?? plugin?.meta?.description,
    i18n.language,
  );

  const handleCompareChange = async (value) => {
    setCompareVersion(value || '');
    setCompareSource(null);
    if (!value || !onCompareVersion) return;
    setComparing(true);
    try {
      const res = await onCompareVersion(key, value);
      if (res?.data?.success) {
        setCompareSource(res.data.data?.source ?? '');
      }
    } finally {
      setComparing(false);
    }
  };

  const versionColumns = [
    { title: t('版本'), dataIndex: 'version' },
    { title: t('备注'), dataIndex: 'remark', render: (v) => v || '—' },
    {
      title: t('状态'),
      dataIndex: 'active',
      render: (active) =>
        active ? <Tag color='green'>{t('生效中')}</Tag> : '—',
    },
    {
      title: t('操作'),
      width: 140,
      render: (value, record) => (
        <Button
          size='small'
          type='tertiary'
          disabled={record.active || detailLoading}
          onClick={() => onActivateVersion?.(key, record.version)}
        >
          {t('启用 / 回滚')}
        </Button>
      ),
    },
  ];

  const versionOptions = versions
    .filter((version) => version.version !== detail?.meta?.version)
    .map((version) => ({ label: version.version, value: version.version }));

  return (
    <SideSheet
      placement='right'
      title={
        <div>
          <Text strong className='text-base'>
            {detail?.meta?.name ?? plugin?.meta?.name}
          </Text>
          <div>
            <Text type='tertiary' className='font-mono text-xs'>
              {key}
            </Text>
            {description ? (
              <div className='mt-1 text-xs text-gray-500'>{description}</div>
            ) : null}
          </div>
        </div>
      }
      visible={visible}
      width={960}
      onMaskClick={onClose}
      onCancel={onClose}
      bodyStyle={{ padding: 16 }}
    >
      {detailLoading && !detail ? (
        <Skeleton active />
      ) : detail ? (
        <div className='space-y-4'>
          <PluginMetadataCard meta={detail.meta} />
          <Card title={t('计费参数')} bodyStyle={{ padding: 16 }}>
            {detail.meta.usageSchema &&
            Object.keys(detail.meta.usageSchema).length > 0 ? (
              <UsageSchemaTable schema={detail.meta.usageSchema} />
            ) : (
              <p className='text-sm text-gray-400'>
                {t('未声明计费参数')}
              </p>
            )}
          </Card>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type='capsule'
          >
            <TabPane tab={t('来源')} itemKey='source'>
              <JavaScriptViewer
                value={detail.source ?? ''}
                className='h-[32rem]'
              />
            </TabPane>
            <TabPane tab={t('版本历史')} itemKey='versions'>
              <Table
                columns={versionColumns}
                dataSource={versions}
                rowKey='id'
                pagination={false}
              />
            </TabPane>
            <TabPane tab={t('源码对比')} itemKey='diff'>
              <div className='space-y-3'>
                <Select
                  className='w-full'
                  value={compareVersion}
                  placeholder={t('选择要对比的版本')}
                  optionList={versionOptions}
                  onChange={handleCompareChange}
                  loading={comparing}
                />
                {compareSource != null && (
                  <SourceDiff
                    before={compareSource}
                    after={detail.source ?? ''}
                  />
                )}
              </div>
            </TabPane>
            <TabPane tab={t('沙箱')} itemKey='sandbox'>
              <PluginSandbox pluginKey={key} onDryRun={onDryRun} />
            </TabPane>
          </Tabs>
        </div>
      ) : (
        <Spin />
      )}
    </SideSheet>
  );
};

export default PluginDetailSheet;
