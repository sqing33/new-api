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
import { Button, Switch, Typography } from '@douyinfe/semi-ui';

const UsersActions = ({
  setShowAddUser,
  setShowColumnSelector,
  sortByConcurrency,
  setSortByConcurrency,
  sortByLastLogin,
  setSortByLastLogin,
  t,
}) => {
  // Add new user
  const handleAddUser = () => {
    setShowAddUser(true);
  };

  return (
    <>
      <div className='flex gap-2 w-full md:w-auto order-2 md:order-1'>
        <Button
          className='w-full md:w-auto'
          onClick={handleAddUser}
          size='small'
        >
          {t('添加用户')}
        </Button>
        <Button
          type='secondary'
          className='w-full md:w-auto'
          onClick={() => setShowColumnSelector(true)}
          size='small'
        >
          {t('列设置')}
        </Button>
      </div>

      <div className='flex flex-col md:flex-row items-start md:items-center gap-2 w-full md:w-auto order-1 md:order-2'>
        <div className='flex items-center justify-between w-full md:w-auto'>
          <Typography.Text strong className='mr-2'>
            {t('按并发排序')}
          </Typography.Text>
          <Switch
            size='small'
            checked={sortByConcurrency}
            onChange={(v) => setSortByConcurrency(v)}
          />
        </div>

        <div className='flex items-center justify-between w-full md:w-auto'>
          <Typography.Text strong className='mr-2'>
            {t('按最后登录排序')}
          </Typography.Text>
          <Switch
            size='small'
            checked={sortByLastLogin}
            onChange={(v) => setSortByLastLogin(v)}
          />
        </div>
      </div>
    </>
  );
};

export default UsersActions;
