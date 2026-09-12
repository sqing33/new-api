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

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Modal,
  Select,
  Spin,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text, Title } = Typography;

/**
 * 供应商批量操作对话框：合并 / 删除供应商、把模型分配给指定供应商。
 * 对应后端 POST /api/vendors/operations/preview 与 /api/vendors/operations。
 */
const VendorOperationsModal = ({
  visible,
  onClose,
  vendors = [],
  models = [],
  onApplied,
  t,
}) => {
  const [action, setAction] = useState('merge');
  const [vendorIds, setVendorIds] = useState([]);
  const [modelIds, setModelIds] = useState([]);
  const [targetVendorId, setTargetVendorId] = useState(undefined);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const needsVendors = action !== 'assign';
  const needsModels = action === 'assign';
  const needsTarget = action === 'merge' || action === 'assign';

  const vendorOptions = useMemo(
    () =>
      vendors.map((v) => ({
        label: v.name,
        value: v.id,
      })),
    [vendors],
  );

  const resetOperationState = (nextAction) => {
    setAction(nextAction);
    setVendorIds([]);
    setModelIds([]);
    setTargetVendorId(undefined);
    setPreview(null);
  };

  const buildRequest = () => {
    const request = { action };
    if (needsVendors) request.vendor_ids = vendorIds;
    if (needsModels) request.model_ids = modelIds;
    if (needsTarget) request.target_vendor_id = targetVendorId;
    if (preview?.version) request.expected_version = preview.version;
    return request;
  };

  const operationValid = () => {
    if (action === 'assign') {
      return modelIds.length > 0 && !!targetVendorId;
    }
    if (action === 'merge') {
      return vendorIds.length >= 2 && !!targetVendorId;
    }
    if (action === 'delete') {
      return vendorIds.length > 0;
    }
    return false;
  };

  const handlePreview = async () => {
    if (!operationValid()) {
      showError(t('请先完善操作条件'));
      return;
    }
    setLoading(true);
    try {
      const request = buildRequest();
      delete request.expected_version;
      const res = await API.post('/api/vendors/operations/preview', request);
      if (res.data?.success) {
        setPreview(res.data.data);
      } else {
        showError(res.data?.message || t('预览失败'));
      }
    } catch (error) {
      showError(error?.response?.data?.message || t('预览失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview?.version) {
      showError(t('请先预览操作'));
      return;
    }
    setApplying(true);
    try {
      const res = await API.post('/api/vendors/operations', buildRequest());
      if (res.data?.success) {
        const result = res.data.data || {};
        showSuccess(
          t(
            '操作成功：更新 {{models}} 个模型，删除 {{vendors}} 个供应商',
            {
              models: (result.updated_models || []).length,
              vendors: (result.deleted_vendors || []).length,
            },
          ),
        );
        setPreview(null);
        onApplied?.();
        onClose();
      } else {
        showError(res.data?.message || t('操作失败'));
      }
    } catch (error) {
      showError(error?.response?.data?.message || t('操作失败'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={t('供应商批量操作')}
      visible={visible}
      onCancel={onClose}
      width={560}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button loading={loading} onClick={handlePreview}>
            {t('预览影响')}
          </Button>
          <Button
            theme='solid'
            type='danger'
            loading={applying}
            disabled={!preview}
            onClick={handleApply}
          >
            {t('执行操作')}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-4 py-2'>
        <div>
          <Title heading={6} className='mb-1'>
            {t('操作类型')}
          </Title>
          <Select
            value={action}
            onChange={resetOperationState}
            className='w-full'
            optionList={[
              { value: 'merge', label: t('合并供应商') },
              { value: 'delete', label: t('删除供应商') },
              { value: 'assign', label: t('分配模型到供应商') },
            ]}
          />
        </div>

        {needsVendors && (
          <div>
            <Title heading={6} className='mb-1'>
              {action === 'merge' ? t('选择要合并的供应商') : t('选择要删除的供应商')}
            </Title>
            <Select
              multiple
              filter
              value={vendorIds}
              onChange={setVendorIds}
              className='w-full'
              placeholder={t('选择供应商')}
              optionList={vendorOptions}
            />
          </div>
        )}

        {needsModels && (
          <div>
            <Title heading={6} className='mb-1'>
              {t('选择要分配的模型')}
            </Title>
            <Select
              multiple
              filter
              value={modelIds}
              onChange={setModelIds}
              className='w-full'
              placeholder={t('选择模型')}
              optionList={models.map((m) => ({
                label: m.model_name || m.name || `#${m.id}`,
                value: m.id,
              }))}
            />
            <Text type='tertiary' size='small'>
              {t('可选任意未分配模型，执行后将其归属到目标供应商')}
            </Text>
          </div>
        )}

        {needsTarget && (
          <div>
            <Title heading={6} className='mb-1'>
              {action === 'merge' ? t('目标供应商') : t('分配到供应商')}
            </Title>
            <Select
              filter
              value={targetVendorId}
              onChange={setTargetVendorId}
              className='w-full'
              placeholder={t('选择目标供应商')}
              optionList={vendorOptions.filter(
                (o) => !vendorIds.includes(o.value),
              )}
            />
          </div>
        )}

        {preview && (
          <div className='rounded-lg bg-gray-50 p-3 text-sm flex flex-col gap-1'>
            <Text strong>{t('影响预览')}</Text>
            <Text>
              {t('涉及供应商')}: {(preview.sources || []).length}
            </Text>
            <Text>
              {t('涉及模型')}: {(preview.models || []).length}
            </Text>
            {preview.target && (
              <Text>
                {t('目标供应商')}: {preview.target.name}
              </Text>
            )}
            <Text type='tertiary' size='small'>
              {t('执行后将按此预览生效（含并发版本校验）')}
            </Text>
          </div>
        )}

        {loading && (
          <div className='flex justify-center'>
            <Spin />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default VendorOperationsModal;
