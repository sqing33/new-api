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

import { Table, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { resolveLocalizedText } from './lib/localizedText';

const formatUsageUnit = (unit, t) => {
  if (unit === 'second') return t('秒');
  if (unit === 'count') return t('次');
  if (unit === 'token') return t('token（单位）');
  if (unit === 'credit') return t('credit');
  return '—';
};

const UsageSchemaTable = ({ schema }) => {
  const { t, i18n } = useTranslation();
  const entries = Object.entries(schema || {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const columns = [
    {
      title: t('名称'),
      dataIndex: 'field',
      render: (text) => (
        <Typography.Text className='font-mono text-xs'>{text}</Typography.Text>
      ),
    },
    {
      title: t('类型'),
      render: (value, record) => {
        const type = record.definition.type;
        if (type === 'number') return t('数字');
        if (type === 'boolean') return t('布尔');
        return t('枚举');
      },
    },
    {
      title: t('单位'),
      render: (value, record) => formatUsageUnit(record.definition.unit, t),
    },
    {
      title: t('枚举值'),
      render: (value, record) =>
        record.definition.enum?.join(', ') || '—',
    },
    {
      title: t('描述'),
      render: (value, record) =>
        resolveLocalizedText(record.definition.description, i18n.language) ||
        '—',
    },
  ];
  return (
    <Table
      columns={columns}
      dataSource={entries.map(([field, definition]) => ({
        field,
        definition,
      }))}
      rowKey='field'
      pagination={false}
    />
  );
};

export default UsageSchemaTable;
