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

import {
  Banner,
  Button,
  Input,
  Modal,
  Tag,
} from '@douyinfe/semi-ui';
import { Plus, Trash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDefaultMarketplaceSource } from './lib/marketplace';

// 行携带客户端生成的标识，保证编辑/删除时输入框状态不错位；
// 索引 URL 在管理员输完之前并不唯一，不能直接当 key
const MarketplaceSourcesDialog = ({
  visible,
  sources,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState([]);
  const nextRowId = useRef(0);
  const makeRowId = () => {
    nextRowId.current += 1;
    return `row-${nextRowId.current}`;
  };

  useEffect(() => {
    if (visible) {
      setDraft(
        (sources ?? []).map((source) => ({
          ...source,
          rowId: makeRowId(),
        })),
      );
    }
  }, [visible, sources]);

  const updateRow = (index, patch) => {
    setDraft((rows) =>
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const invalidRow = draft.some(
    (row) => !row.name.trim() || !row.index_url.trim(),
  );

  return (
    <Modal
      title={t('市场来源')}
      visible={visible}
      onOk={() =>
        onSave(
          draft.map((row) => ({
            name: row.name.trim(),
            index_url: row.index_url.trim(),
          })),
        )
      }
      onCancel={onClose}
      onMaskClick={onClose}
      width={640}
      okButtonProps={{
        disabled: invalidRow,
        children: t('保存'),
      }}
      cancelButtonProps={{ children: t('取消') }}
    >
      <div className='space-y-3'>
        <p className='text-sm text-gray-400'>
          {t('每个来源提供一个 index.json，列出可安装的插件。索引由浏览器抓取；网关不发起外呼。')}
        </p>
        {draft.length === 0 && (
          <p className='text-sm text-gray-400'>
            {t('未配置市场来源。')}
          </p>
        )}
        {draft.map((row, index) => (
          <div key={row.rowId} className='space-y-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2'>
              <label className='text-xs text-gray-400'>
                {t('来源名称')}
              </label>
              <div className='flex items-center gap-2'>
                {isDefaultMarketplaceSource(row.index_url) ? (
                  <Tag color='grey' size='small'>{t('官方')}</Tag>
                ) : (
                  <Tag color='red' size='small'>
                    {t('第三方 — 风险自担')}
                  </Tag>
                )}
                <Button
                  type='tertiary'
                  size='small'
                  icon={<Trash size={14} />}
                  aria-label={t('移除来源 {{name}}', {
                    name: row.name || row.index_url,
                  })}
                  onClick={() =>
                    setDraft((rows) =>
                      rows.filter((_, position) => position !== index),
                    )
                  }
                />
              </div>
            </div>
            <Input
              value={row.name}
              onChange={(value) => updateRow(index, { name: value })}
            />
            <label className='block text-xs text-gray-400'>
              {t('索引 URL')}
            </label>
            <Input
              type='url'
              inputMode='url'
              value={row.index_url}
              placeholder='https://example.com/index.json'
              onChange={(value) =>
                updateRow(index, { index_url: value })
              }
            />
          </div>
        ))}
        <Button
          type='tertiary'
          icon={<Plus size={14} />}
          onClick={() =>
            setDraft((rows) => [
              ...rows,
              { name: '', index_url: '', rowId: makeRowId() },
            ])
          }
        >
          {t('添加来源')}
        </Button>
        <Banner
          type='warning'
          title={t('第三方来源风险')}
          description={t('任何人都可以发布索引。从第三方来源安装的插件与你手动上传的插件权限相同：安装前请审查其源码。')}
        />
      </div>
    </Modal>
  );
};

export default MarketplaceSourcesDialog;
