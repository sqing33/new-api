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

import React, { useState } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { showError } from '../../../helpers';
import CopyTokensModal from './modals/CopyTokensModal';
import DeleteTokensModal from './modals/DeleteTokensModal';
import SortPriorityPopover from '../../common/ui/SortPriorityPopover';
import { TOKEN_SORT_APPLY_COUNT } from '../../../hooks/tokens/useTokensData';

// 排序维度的展示名。key 与 useTokensData 里的 sortOrder 元素一一对应，
// 也与后端 model.tokenSortColumns 的键一致。
const SORT_DIMENSION_ITEMS = {
  id: { label: '使用ID排序' },
  name: { label: '名称排序' },
  group: { label: '按分组排序' },
  accessed_time: { label: '按最后使用时间排序' },
  concurrency: { label: '按并发排序' },
  created_time: { label: '按创建时间排序' },
  expired_time: { label: '按过期时间排序' },
  status: { label: '按状态排序' },
};

const TokensActions = ({
  selectedKeys,
  setEditingToken,
  setShowEdit,
  batchCopyTokens,
  batchDeleteTokens,
  setShowColumnSelector,
  setShowTokenGroupManage,
  sortOrder,
  reorderSortDimensions,
  t,
}) => {
  // Modal states
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Handle copy selected tokens with options
  const handleCopySelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowCopyModal(true);
  };

  // Handle delete selected tokens with confirmation
  const handleDeleteSelectedTokens = () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个令牌！'));
      return;
    }
    setShowDeleteModal(true);
  };

  // Handle delete confirmation
  const handleConfirmDelete = () => {
    batchDeleteTokens();
    setShowDeleteModal(false);
  };

  return (
    <>
      <div className='flex flex-wrap gap-2 w-full md:w-auto order-2 md:order-1'>
        <Button
          type='primary'
          className='flex-1 md:flex-initial'
          onClick={() => {
            setEditingToken({
              id: undefined,
            });
            setShowEdit(true);
          }}
          size='small'
        >
          {t('添加令牌')}
        </Button>

        <Button
          type='tertiary'
          className='flex-1 md:flex-initial'
          onClick={handleCopySelectedTokens}
          size='small'
        >
          {t('复制所选令牌')}
        </Button>

        <Button
          type='danger'
          className='w-full md:w-auto'
          onClick={handleDeleteSelectedTokens}
          size='small'
        >
          {t('删除所选令牌')}
        </Button>

        <Button
          type='secondary'
          className='flex-1 md:flex-initial'
          onClick={() => setShowColumnSelector(true)}
          size='small'
        >
          {t('列设置')}
        </Button>

        <Button
          type='tertiary'
          className='w-full md:w-auto'
          onClick={() => setShowTokenGroupManage(true)}
          size='small'
        >
          {t('分组管理')}
        </Button>
      </div>

      <div className='flex flex-col md:flex-row items-start md:items-center gap-2 w-full md:w-auto order-1 md:order-2'>
        <SortPriorityPopover
          order={sortOrder}
          items={SORT_DIMENSION_ITEMS}
          applyCount={TOKEN_SORT_APPLY_COUNT}
          onReorder={reorderSortDimensions}
          t={t}
        />
      </div>

      <CopyTokensModal
        visible={showCopyModal}
        onCancel={() => setShowCopyModal(false)}
        batchCopyTokens={batchCopyTokens}
        t={t}
      />

      <DeleteTokensModal
        visible={showDeleteModal}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        selectedKeys={selectedKeys}
        t={t}
      />
    </>
  );
};

export default TokensActions;
