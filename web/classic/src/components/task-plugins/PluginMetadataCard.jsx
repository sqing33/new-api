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

import { Card, Tag } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { HOST_PROTOCOL_ENDPOINTS } from './lib/hostProtocols';

const ModelScopeHint = ({ models }) => {
  const { t } = useTranslation();
  return (
    <span className='text-xs text-gray-400' title={models.join(', ')}>
      {t('模型范围')}
    </span>
  );
};

const EndpointRow = ({ method, path, children }) => (
  <li className='flex flex-wrap items-center gap-x-2 gap-y-1'>
    <Tag color='grey' size='small' className='shrink-0 font-mono'>
      {method}
    </Tag>
    <span className='break-all font-mono text-xs' title={path}>
      {path}
    </span>
    {children}
  </li>
);

// 插件暴露的端点：先按 `meta.protocols` 声明推导宿主协议端点，
// 再列插件自声明的原生路由
const PluginEndpoints = ({ protocols, routes }) => {
  const { t } = useTranslation();
  const claims = protocols ?? [];
  const routeList = routes ?? [];

  return (
    <div className='space-y-3'>
      <p className='text-xs font-medium text-gray-400'>{t('端点')}</p>
      {claims.length === 0 && routeList.length === 0 && (
        <p className='text-xs text-gray-400'>—</p>
      )}
      {claims.map((claim) => {
        const name = typeof claim === 'string' ? claim : claim.name;
        const supports =
          typeof claim === 'string' ? undefined : claim.supports;
        const models = typeof claim === 'string' ? undefined : claim.models;
        const endpoints = HOST_PROTOCOL_ENDPOINTS[name] ?? [];
        const chips = supports?.map((mode) => (
          <Tag key={mode} size='small' className='font-mono'>
            {mode}
          </Tag>
        ));
        const hasCreateRow = endpoints.some(
          (endpoint) => endpoint.modeBearing,
        );
        return (
          <div key={name} className='space-y-1.5'>
            <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
              <span className='font-mono text-xs text-gray-400'>
                {name}
              </span>
              {models?.length ? <ModelScopeHint models={models} /> : null}
              {hasCreateRow ? null : chips}
            </div>
            <ul className='space-y-1.5 pl-3'>
              {endpoints.map((endpoint) => (
                <EndpointRow
                  key={`${endpoint.method} ${endpoint.path}`}
                  method={endpoint.method}
                  path={endpoint.path}
                >
                  {endpoint.modeBearing ? chips : null}
                </EndpointRow>
              ))}
            </ul>
          </div>
        );
      })}
      {routeList.length > 0 ? (
        <div className='space-y-1.5'>
          <p className='text-xs text-gray-400'>{t('原生路由')}</p>
          <ul className='space-y-1.5 pl-3'>
            {routeList.map((route) => (
              <EndpointRow
                key={`${route.method} ${route.path}`}
                method={route.method}
                path={route.path}
              >
                <span className='font-mono text-[11px] text-gray-400'>
                  {route.type}
                </span>
                {route.models?.length ? (
                  <ModelScopeHint models={route.models} />
                ) : null}
              </EndpointRow>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

const PluginMetadataCard = ({ meta }) => {
  const { t } = useTranslation();
  const fields = [
    { label: t('版本'), value: meta.version },
    { label: t('API 版本'), value: String(meta.apiVersion) },
    {
      label: t('渠道类型'),
      value: meta.channelTypes?.join(', ') ?? '',
    },
    { label: t('获取模式'), value: meta.fetchMode },
    {
      label: t('模型'),
      value: meta.models?.join(', ') ?? '',
      wide: true,
    },
  ];

  return (
    <Card title={t('插件元数据')} bodyStyle={{ padding: 16 }}>
      <dl className='grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2'>
        {fields.map((field) => (
          <div key={field.label} className={field.wide ? 'sm:col-span-2' : ''}>
            <dt className='text-xs text-gray-400'>{field.label}</dt>
            <dd className='break-words font-mono text-xs'>
              {field.value || '—'}
            </dd>
          </div>
        ))}
      </dl>
      <div className='mt-4 border-t pt-4'>
        <PluginEndpoints protocols={meta.protocols} routes={meta.routes} />
      </div>
    </Card>
  );
};

export default PluginMetadataCard;
