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
import { getTokensColumns } from '../TokensColumnDefs';

const ColumnSelectorModal = ({
  showColumnSelector,
  setShowColumnSelector,
  visibleColumns,
  handleColumnVisibilityChange,
  handleSelectAllColumns,
  initDefaultColumns,
  t,
  ...tokensData
}) => {
  const allColumns = getTokensColumns({
    t,
    showKeys: tokensData.showKeys,
    resolvedTokenKeys: tokensData.resolvedTokenKeys,
    loadingTokenKeys: tokensData.loadingTokenKeys,
    toggleTokenVisibility: tokensData.toggleTokenVisibility,
    copyTokenKey: tokensData.copyTokenKey,
    copyTokenConnectionString: tokensData.copyTokenConnectionString,
    manageToken: tokensData.manageToken,
    onOpenLink: tokensData.onOpenLink,
    setEditingToken: tokensData.setEditingToken,
    setShowEdit: tokensData.setShowEdit,
    refresh: tokensData.refresh,
    groupRatios: tokensData.groupRatios,
  }).filter((column) => column.key);

  const operateKey = tokensData.TOKEN_COLUMN_KEYS.OPERATE;
  const hideableColumns = allColumns.filter(
    (column) => column.key !== operateKey,
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
          const required = column.key === operateKey;
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
