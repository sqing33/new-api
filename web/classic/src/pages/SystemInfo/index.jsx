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

import React from 'react';
import { Button, Card, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import SystemInstancesPanel from '../../components/table/system-info/SystemInstancesPanel';
import SystemTasksPanel from '../../components/table/system-info/SystemTasksPanel';
import { useSystemInfoData } from '../../hooks/system-info/useSystemInfoData';

const { Title } = Typography;

const SystemInfoPage = () => {
  const data = useSystemInfoData();
  const { t } = data;

  return (
    <div className='px-2 space-y-4'>
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
        <div>
          <Title heading={4} className='!mb-1'>
            {t('系统信息')}
          </Title>
          <div
            className='text-sm'
            style={{ color: 'var(--semi-color-text-1)' }}
          >
            {t('上报心跳的本部署节点及其最新状态')}
          </div>
        </div>
        <Button
          type='tertiary'
          icon={<RefreshCw size={16} />}
          loading={data.instancesRefreshing}
          onClick={() => data.loadInstances(true)}
          className='bg-blue-500 hover:bg-blue-600'
        />
      </div>
      <Card className='!rounded-xl'>
        <SystemInstancesPanel data={data} t={t} />
      </Card>
      <Card className='!rounded-xl'>
        <SystemTasksPanel data={data} t={t} />
      </Card>
    </div>
  );
};

export default SystemInfoPage;
