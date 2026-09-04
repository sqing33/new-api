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

import React, { useMemo } from 'react';
import { Empty } from '@douyinfe/semi-ui';
import CardTable from '../../common/ui/CardTable';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { getModelsColumns } from './ModelsColumnDefs';

const ModelsTable = (modelsData) => {
  const {
    models,
    loading,
    activePage,
    pageSize,
    modelCount,
    compactMode,
    handlePageChange,
    handlePageSizeChange,
    rowSelection,
    handleRow,
    manageModel,
    setEditingModel,
    setShowEdit,
    refresh,
    vendorMap,
    imageModelSettingsMap,
    MODEL_COLUMN_KEYS,
    visibleColumns,
    onModelNameClick,
    t,
  } = modelsData;

  // Get all columns
  const columns = useMemo(() => {
    return getModelsColumns({
      t,
      manageModel,
      setEditingModel,
      setShowEdit,
      refresh,
      vendorMap,
      imageModelSettingsMap,
      MODEL_COLUMN_KEYS,
      onModelNameClick,
    });
  }, [
    t,
    manageModel,
    setEditingModel,
    setShowEdit,
    refresh,
    vendorMap,
    imageModelSettingsMap,
    MODEL_COLUMN_KEYS,
    onModelNameClick,
  ]);

  const visibleColumnsList = useMemo(() => {
    if (!visibleColumns || Object.keys(visibleColumns).length === 0) {
      return columns;
    }
    return columns.filter((column) => visibleColumns[column.key]);
  }, [visibleColumns, columns]);

  // Handle compact mode by removing fixed positioning
  const tableColumns = useMemo(() => {
    return compactMode
      ? visibleColumnsList.map((col) => {
          if (col.dataIndex === 'operate') {
            const { fixed, ...rest } = col;
            return rest;
          }
          return col;
        })
      : visibleColumnsList;
  }, [compactMode, visibleColumnsList]);

  return (
    <CardTable
      columns={tableColumns}
      dataSource={models}
      scroll={compactMode ? undefined : { x: 'max-content' }}
      pagination={{
        currentPage: activePage,
        pageSize: pageSize,
        total: modelCount,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        onPageSizeChange: handlePageSizeChange,
        onPageChange: handlePageChange,
      }}
      hidePagination={true}
      loading={loading}
      rowSelection={rowSelection}
      onRow={handleRow}
      empty={
        <Empty
          image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
          }
          description={t('搜索无结果')}
          style={{ padding: 30 }}
        />
      }
      className='rounded-xl overflow-hidden'
      size='middle'
      visibleColumns={visibleColumns}
    />
  );
};

export default ModelsTable;
