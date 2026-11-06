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

import React, { useEffect, useState } from 'react';
import { Button, Card, Spin, Switch, Select, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, toBoolean } from '../../helpers';

const ENABLED_KEY = 'auto_refresh_setting.enabled';
const INTERVAL_KEY = 'auto_refresh_setting.interval_seconds';

// 可选的刷新间隔（秒）与显示文案。5 秒最实时，但请求量也最大。
const INTERVAL_LABELS = {
  5: '5 秒（实时）',
  10: '10 秒',
  30: '30 秒',
  60: '1 分钟',
  300: '5 分钟',
};
const INTERVAL_OPTIONS = Object.keys(INTERVAL_LABELS).map(Number);

const AutoRefreshSetting = () => {
  const { t } = useTranslation();
  const [inputs, setInputs] = useState({
    [ENABLED_KEY]: true,
    [INTERVAL_KEY]: 5,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (!success) {
      showError(message);
      return;
    }
    const nextInputs = {};
    data.forEach((item) => {
      if (item.key === ENABLED_KEY) {
        nextInputs[ENABLED_KEY] = toBoolean(item.value);
      } else if (item.key === INTERVAL_KEY) {
        const seconds = parseInt(item.value, 10);
        nextInputs[INTERVAL_KEY] = Number.isNaN(seconds) ? 5 : seconds;
      }
    });
    setInputs((prev) => ({ ...prev, ...nextInputs }));
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await getOptions();
      } catch (error) {
        showError(t('刷新失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const requests = [
        API.put('/api/option/', {
          key: ENABLED_KEY,
          value: String(inputs[ENABLED_KEY]),
        }),
        API.put('/api/option/', {
          key: INTERVAL_KEY,
          value: String(inputs[INTERVAL_KEY]),
        }),
      ];
      const results = await Promise.all(requests);
      if (results.some((res) => res?.data?.success === false)) {
        showError(t('保存失败，请重试'));
        return;
      }
      showSuccess(t('保存成功'));
      await getOptions();
    } catch (error) {
      showError(t('保存失败，请重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Spin spinning={loading} size='large'>
      <Card style={{ marginTop: '10px' }}>
        <div className='flex items-center mb-4'>
          <div className='w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mr-3 flex-shrink-0'>
            <RefreshCw
              size={18}
              className='text-emerald-600 dark:text-emerald-400'
            />
          </div>
          <div>
            <Typography.Title heading={6} className='mb-1'>
              {t('自动刷新')}
            </Typography.Title>
            <Typography.Text type='tertiary' className='text-sm'>
              {t('让管理页的数据定时自动更新，无需手动点击查询')}
            </Typography.Text>
          </div>
        </div>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4'>
            <div>
              <Typography.Text className='text-sm'>
                {t('启用自动刷新')}
              </Typography.Text>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                {t(
                  '开启后，清荫日志、使用日志、令牌管理、渠道管理四个页面会定时自动刷新数据。',
                )}
              </div>
            </div>
            <Switch
              size='small'
              checked={inputs[ENABLED_KEY]}
              onChange={(checked) =>
                setInputs((prev) => ({ ...prev, [ENABLED_KEY]: checked }))
              }
            />
          </div>

          <div className='flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4'>
            <div>
              <Typography.Text className='text-sm'>
                {t('刷新间隔')}
              </Typography.Text>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                {t(
                  '间隔越短数据越实时，但会给后端带来更多查询压力。多个管理员同时开启时压力会成倍增加。',
                )}
              </div>
            </div>
            <Select
              value={inputs[INTERVAL_KEY]}
              onChange={(value) =>
                setInputs((prev) => ({ ...prev, [INTERVAL_KEY]: value }))
              }
              style={{ width: 180 }}
              disabled={!inputs[ENABLED_KEY]}
              optionList={INTERVAL_OPTIONS.map((seconds) => ({
                value: seconds,
                label: t(INTERVAL_LABELS[seconds]),
              }))}
            />
          </div>
        </div>

        <div className='mt-4 flex justify-end'>
          <Button type='primary' loading={saving} onClick={handleSave}>
            {t('保存')}
          </Button>
        </div>

        <div className='mt-4 text-xs text-gray-500 dark:text-gray-400'>
          <Typography.Text type='tertiary'>
            {t(
              '提示：自动刷新会保持当前页码与筛选条件，页面切到后台时会自动暂停；修改后需要刷新页面才会生效。',
            )}
          </Typography.Text>
        </div>
      </Card>
    </Spin>
  );
};

export default AutoRefreshSetting;
