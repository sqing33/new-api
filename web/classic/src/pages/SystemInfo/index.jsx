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
import { Card, Typography } from '@douyinfe/semi-ui';
import SystemInstancesPanel from '../../components/table/system-info/SystemInstancesPanel';
import SystemTasksPanel from '../../components/table/system-info/SystemTasksPanel';
import { useSystemInfoData } from '../../hooks/system-info/useSystemInfoData';

const { Title } = Typography;

const SystemInfoPage = () => {
  const data = useSystemInfoData();

  return (
    <div className='mt-[60px] px-2 space-y-4'>
      <Title heading={4} className='!mb-0'>
        {data.t('系统信息')}
      </Title>
      <Card className='!rounded-xl'>
        <SystemInstancesPanel data={data} t={data.t} />
      </Card>
      <Card className='!rounded-xl'>
        <SystemTasksPanel data={data} t={data.t} />
      </Card>
    </div>
  );
};

export default SystemInfoPage;
