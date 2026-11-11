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
import {
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { showError, groupTagColor } from '../../../../helpers';

// 分组管理弹窗：新建 / 重命名 / 删除组织分组。
// 分组可以暂时没有任何令牌（用户可以先把「游戏」建出来，之后再往里放 key）。
const TokenGroupManageModal = ({
  showTokenGroupManage,
  setShowTokenGroupManage,
  tokenGroups,
  createTokenGroup,
  renameTokenGroup,
  deleteTokenGroup,
  t,
}) => {
  const [newGroupName, setNewGroupName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    setShowTokenGroupManage(false);
    setNewGroupName('');
    setEditingId(null);
    setEditingName('');
  };

  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name) {
      showError(t('分组名称不能为空'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await createTokenGroup(name);
      if (created) {
        setNewGroupName('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRename = async (id) => {
    const name = editingName.trim();
    if (!name) {
      return;
    }
    setSubmitting(true);
    try {
      const ok = await renameTokenGroup(id, name);
      if (ok) {
        setEditingId(null);
        setEditingName('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (group) => {
    Modal.confirm({
      title: t('确认删除分组？'),
      content: t('删除分组后，该分组下的令牌将变为未分组'),
      onOk: () => {
        deleteTokenGroup(group.id);
      },
    });
  };

  return (
    <Modal
      title={t('分组管理')}
      visible={showTokenGroupManage}
      onCancel={handleClose}
      footer={
        <div className='flex justify-end'>
          <Button onClick={handleClose}>{t('关闭')}</Button>
        </div>
      }
    >
      <div className='flex items-center gap-2 mb-4'>
        <Input
          value={newGroupName}
          onChange={setNewGroupName}
          placeholder={t('请输入分组名称')}
          maxLength={32}
          showClear
          onEnterPress={handleCreate}
          style={{ flex: 1 }}
        />
        <Button
          type='primary'
          theme='solid'
          loading={submitting}
          disabled={!newGroupName.trim()}
          onClick={handleCreate}
        >
          {t('新建分组')}
        </Button>
      </div>

      {tokenGroups.length === 0 ? (
        <Empty
          image={<IllustrationNoResult style={{ width: 120, height: 120 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 120, height: 120 }} />
          }
          description={t('暂无分组')}
          style={{ padding: 20 }}
        />
      ) : (
        <div className='flex flex-col gap-2 max-h-96 overflow-y-auto'>
          {tokenGroups.map((group) => (
            <div
              key={group.id}
              className='flex items-center gap-2 rounded-lg px-2 py-1'
              style={{ border: '1px solid var(--semi-color-border)' }}
            >
              {editingId === group.id ? (
                <>
                  <Input
                    value={editingName}
                    onChange={setEditingName}
                    maxLength={32}
                    showClear
                    onEnterPress={() => handleRename(group.id)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size='small'
                    type='primary'
                    theme='solid'
                    loading={submitting}
                    onClick={() => handleRename(group.id)}
                  >
                    {t('保存')}
                  </Button>
                  <Button size='small' onClick={() => setEditingId(null)}>
                    {t('取消')}
                  </Button>
                </>
              ) : (
                <>
                  <Tag
                    color={groupTagColor(group.name)}
                    shape='circle'
                    type='light'
                    className='flex-1'
                  >
                    {group.name}
                  </Tag>
                  <Tag color='grey' shape='circle' type='light'>
                    {t('令牌数量')}: {group.count}
                  </Tag>
                  <Space spacing={4}>
                    <Button
                      size='small'
                      type='tertiary'
                      icon={<IconEdit />}
                      aria-label={t('重命名分组')}
                      onClick={() => {
                        setEditingId(group.id);
                        setEditingName(group.name);
                      }}
                    />
                    <Button
                      size='small'
                      type='danger'
                      icon={<IconDelete />}
                      aria-label={t('删除分组')}
                      onClick={() => handleDelete(group)}
                    />
                  </Space>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default TokenGroupManageModal;
