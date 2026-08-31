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
import { Button, Checkbox, Modal } from '@douyinfe/semi-ui';
import { getModelsColumns } from '../ModelsColumnDefs';

const ColumnSelectorModal = ({
  showColumnSelector,
  setShowColumnSelector,
  visibleColumns,
  handleColumnVisibilityChange,
  handleSelectAllColumns,
  initDefaultColumns,
  t,
  ...modelsData
}) => {
  const allColumns = getModelsColumns({
    t,
    manageModel: modelsData.manageModel,
    setEditingModel: modelsData.setEditingModel,
    setShowEdit: modelsData.setShowEdit,
    refresh: modelsData.refresh,
    vendorMap: modelsData.vendorMap,
    imageModelSettingsMap: modelsData.imageModelSettingsMap,
    MODEL_COLUMN_KEYS: modelsData.MODEL_COLUMN_KEYS,
  }).filter((column) => column.key);

  const hideableColumns = allColumns.filter(
    (column) => column.key !== modelsData.MODEL_COLUMN_KEYS.OPERATE,
  );
  const allChecked = hideableColumns.every(
    (column) => visibleColumns[column.key],
  );
  const partlyChecked =
    hideableColumns.some((column) => visibleColumns[column.key]) && !allChecked;

  return (
    <Modal
      title={t('列设置')}
      visible={showColumnSelector}
      onCancel={() => setShowColumnSelector(false)}
      footer={
        <div className='flex justify-end'>
          <Button onClick={initDefaultColumns}>{t('重置')}</Button>
          <Button onClick={() => setShowColumnSelector(false)}>
            {t('取消')}
          </Button>
          <Button onClick={() => setShowColumnSelector(false)}>
            {t('确定')}
          </Button>
        </div>
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Checkbox
          checked={allChecked}
          indeterminate={partlyChecked}
          onChange={(e) => handleSelectAllColumns(e.target.checked)}
        >
          {t('全选')}
        </Checkbox>
      </div>
      <div
        className='flex flex-wrap max-h-96 overflow-y-auto rounded-lg p-4'
        style={{ border: '1px solid var(--semi-color-border)' }}
      >
        {allColumns.map((column) => {
          const required = column.key === modelsData.MODEL_COLUMN_KEYS.OPERATE;
          return (
            <div key={column.key} className='w-1/2 mb-4 pr-2'>
              <Checkbox
                checked={!!visibleColumns[column.key]}
                disabled={required}
                onChange={(e) =>
                  handleColumnVisibilityChange(column.key, e.target.checked)
                }
              >
                {column.title || t('操作')}
              </Checkbox>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default ColumnSelectorModal;
