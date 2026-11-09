import React, { useState, useCallback, useMemo } from 'react';
import {
  Button,
  InputNumber,
  Select,
  Typography,
  Popconfirm,
} from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

let _idCounter = 0;
const uid = () => `ugr_${++_idCounter}`;

function parseUserGroupRatio(str) {
  if (!str || !str.trim()) return [];
  try {
    const parsed = JSON.parse(str);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed).map(([name, ratio]) => ({
      _id: uid(),
      name,
      ratio: typeof ratio === 'number' ? ratio : 1,
    }));
  } catch {
    return [];
  }
}

function serializeUserGroupRatio(items) {
  const result = {};
  items.forEach(({ name, ratio }) => {
    if (!name) return;
    result[name] = ratio;
  });
  return Object.keys(result).length === 0
    ? ''
    : JSON.stringify(result, null, 2);
}

// UserGroupRatioList 编辑「用户分组倍率」：按用户身份（users.group）设置折扣系数，
// 与令牌分组倍率相乘得到最终生效倍率，因此一个分组只需要配置一次折扣。
export default function UserGroupRatioList({ value, groupNames = [], onChange }) {
  const { t } = useTranslation();

  const [items, setItems] = useState(() => parseUserGroupRatio(value));

  const emitChange = useCallback(
    (newItems) => {
      setItems(newItems);
      onChange?.(serializeUserGroupRatio(newItems));
    },
    [onChange],
  );

  const groupOptions = useMemo(
    () => groupNames.map((n) => ({ value: n, label: n })),
    [groupNames],
  );

  const addItem = useCallback(() => {
    emitChange([...items, { _id: uid(), name: '', ratio: 1 }]);
  }, [items, emitChange]);

  const removeItem = useCallback(
    (id) => {
      emitChange(items.filter((i) => i._id !== id));
    },
    [items, emitChange],
  );

  const updateItem = useCallback(
    (id, field, val) => {
      emitChange(items.map((i) => (i._id === id ? { ...i, [field]: val } : i)));
    },
    [items, emitChange],
  );

  if (items.length === 0) {
    return (
      <div>
        <Text type='tertiary' className='block text-center py-4'>
          {t('暂无用户分组折扣，点击下方按钮添加')}
        </Text>
        <div className='mt-2 flex justify-center'>
          <Button icon={<IconPlus />} theme='outline' onClick={addItem}>
            {t('添加用户分组折扣')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className='space-y-2'>
        {items.map((item) => (
          <div key={item._id} className='flex items-center gap-2'>
            <Select
              size='small'
              filter
              value={item.name || undefined}
              placeholder={t('选择用户分组')}
              optionList={groupOptions}
              onChange={(v) => updateItem(item._id, 'name', v)}
              style={{ flex: 1 }}
              allowCreate
              position='bottomLeft'
            />
            <InputNumber
              size='small'
              min={0}
              step={0.1}
              value={item.ratio}
              style={{ width: 120 }}
              onChange={(v) => updateItem(item._id, 'ratio', v ?? 0)}
            />
            <Popconfirm
              title={t('确认移除？')}
              onConfirm={() => removeItem(item._id)}
              position='left'
            >
              <Button
                icon={<IconDelete />}
                type='danger'
                theme='borderless'
                size='small'
              />
            </Popconfirm>
          </div>
        ))}
      </div>
      <div className='mt-3 flex justify-center'>
        <Button icon={<IconPlus />} theme='outline' onClick={addItem}>
          {t('添加用户分组折扣')}
        </Button>
      </div>
    </div>
  );
}
