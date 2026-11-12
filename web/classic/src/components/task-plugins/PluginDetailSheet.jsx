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
  Banner,
  Button,
  Card,
  Select,
  Skeleton,
  SideSheet,
  Space,
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
          <Typography.Text strong className='text-base'>
            {detail?.meta?.name ?? plugin?.meta?.name}
          </Typography.Text>
          <div>
            <Typography.Text type='tertiary' className='font-mono text-xs'>
              {key}
            </Typography.Text>
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
          {Array.isArray(detail.pricing_issues) &&
            detail.pricing_issues.length > 0 && (
              <Banner
                type='warning'
                bordered
                fullMode={false}
                closeIcon={null}
                title={t('{{count}} 个模型的插件价格需要更新', {
                  count: detail.pricing_issues.length,
                })}
                description={
                  <div className='text-sm'>
                    <div className='mb-2'>
                      {t(
                        '这些模型的插件价格缺失或已过期，请到模型定价页补齐后再启用该插件。',
                      )}
                    </div>
                    <Space wrap>
                      {detail.pricing_issues.slice(0, 10).map((issue) => (
                        <Tag
                          key={`${issue.model_name}-${issue.plugin_key}`}
                          color='orange'
                          size='small'
                        >
                          {issue.model_name}
                        </Tag>
                      ))}
                      {detail.pricing_issues.length > 10 && (
                        <Typography.Text type='tertiary' size='small'>
                          {t('还有 {{count}} 个未展示', {
                            count: detail.pricing_issues.length - 10,
                          })}
                        </Typography.Text>
                      )}
                    </Space>
                  </div>
                }
              />
            )}
          {Array.isArray(detail.skipped_routes) &&
            detail.skipped_routes.length > 0 && (
              <Banner
                type='info'
                bordered
                fullMode={false}
                closeIcon={null}
                title={t('{{count}} 条路由未注册', {
                  count: detail.skipped_routes.length,
                })}
                description={
                  <div className='text-sm'>
                    <div className='mb-2'>
                      {t(
                        '这些路由已被其它插件或宿主占用，本插件不会处理对应请求。',
                      )}
                    </div>
                    <Space wrap>
                      {detail.skipped_routes.map((route) => (
                        <Tag key={route} size='small' className='font-mono'>
                          {route}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                }
              />
            )}
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
