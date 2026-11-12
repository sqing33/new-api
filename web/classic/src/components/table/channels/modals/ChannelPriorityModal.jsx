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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { IconArrowUp, IconArrowDown } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

/**
 * 渠道优先级排序。
 *
 * 后端以「一次移动一条渠道」的语义工作：提交 { revision, id, target_id, position }，
 * 由服务端按降序优先级重排并返回受影响的行。revision 用来检测并发修改，
 * 每次成功提交后再取一次最新快照。
 */
const ChannelPriorityModal = ({ visible, onClose, onSaved, t, channels = [] }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState({ revision: '', items: [] });

  const nameOf = useMemo(() => {
    const map = new Map();
    (channels || []).forEach((channel) => {
      if (channel && channel.id !== undefined) {
        map.set(channel.id, channel.name || `#${channel.id}`);
      }
    });
    return map;
  }, [channels]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/channel/priority/order');
      if (res.data?.success) {
        setOrder({
          revision: res.data.data?.revision || '',
          items: res.data.data?.items || [],
        });
      } else {
        showError(res.data?.message);
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      load();
    }
  }, [visible, load]);

  const move = async (index, direction) => {
    if (saving) {
      return;
    }
    const current = order.items[index];
    const targetIndex = index + direction;
    if (!current || targetIndex < 0 || targetIndex >= order.items.length) {
      return;
    }
    const target = order.items[targetIndex];
    setSaving(true);
    try {
      const res = await API.post('/api/channel/priority/reorder', {
        revision: order.revision,
        id: current.id,
        target_id: target.id,
        // 列表按降序优先级排列，向上移动即排到目标之前。
        position: direction < 0 ? 'before' : 'after',
      });
      if (res.data?.success) {
        setOrder({
          revision: res.data.data?.revision || order.revision,
          items: res.data.data?.items || order.items,
        });
        showSuccess(t('优先级已更新'));
        onSaved?.();
      } else {
        showError(res.data?.message);
        await load();
      }
    } catch (error) {
      showError(error);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('调整渠道优先级')}
      visible={visible}
      onCancel={onClose}
      footer={
        <Button type='tertiary' onClick={onClose}>
          {t('关闭')}
        </Button>
      }
      width={560}
    >
      <Text type='tertiary' size='small'>
        {t(
          '列表按优先级从高到低排列，向上移动会排到上一条之前；改动立即生效，仅影响优先级本身。',
        )}
      </Text>
      <div className='mt-3 max-h-[60vh] overflow-y-auto'>
        <Spin spinning={loading}>
          {order.items.map((item, index) => (
            <div
              key={item.id}
              className='flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 mb-2'
            >
              <div className='min-w-0 flex items-center gap-2'>
                <Tag color='grey' size='small'>
                  {index + 1}
                </Tag>
                <span className='truncate text-sm text-gray-700'>
                  {nameOf.get(item.id) || `#${item.id}`}
                </span>
                <Text type='tertiary' size='small'>
                  {item.priority ?? 0}
                </Text>
              </div>
              <div className='flex items-center gap-1'>
                <Button
                  size='small'
                  type='tertiary'
                  icon={<IconArrowUp />}
                  disabled={index === 0 || saving}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size='small'
                  type='tertiary'
                  icon={<IconArrowDown />}
                  disabled={index === order.items.length - 1 || saving}
                  onClick={() => move(index, 1)}
                />
              </div>
            </div>
          ))}
          {!loading && order.items.length === 0 && (
            <Text type='tertiary'>{t('暂无渠道')}</Text>
          )}
        </Spin>
      </div>
    </Modal>
  );
};

export default ChannelPriorityModal;
