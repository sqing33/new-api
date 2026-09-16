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
import { Button, Input, Modal, Radio, RadioGroup, Typography } from '@douyinfe/semi-ui';

const METHOD_LABELS = {
  password: '账号密码',
  '2fa': '两步验证码',
  passkey: 'Passkey',
  oauth: '第三方账号',
};

const METHOD_HINTS = {
  password: '输入账号密码以确认是本人操作',
  '2fa': '输入验证器 App 中的 6 位验证码或备用码',
  passkey: '点击确认后按提示完成 Passkey 验证',
  oauth: '暂不支持，请选择其他验证方式',
};

const SecurityProofModal = ({
  proofState,
  submitProof,
  cancelProof,
  selectProofMethod,
  setProofCode,
  setProofPassword,
  t,
}) => {
  if (!proofState?.visible) return null;
  const { requirements, method, code, password, error, loading, submitting } =
    proofState;
  const availableMethods = (requirements?.methods || []).filter(
    (m) => m.available && m.method !== 'oauth',
  );

  return (
    <Modal
      title={proofState.title || t('安全验证')}
      visible={proofState.visible}
      onCancel={cancelProof}
      closeOnEsc={false}
      maskClosable={false}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={cancelProof}>{t('取消')}</Button>
          <Button
            theme='solid'
            loading={submitting}
            disabled={
              loading ||
              !method ||
              (method === '2fa' && !code.trim()) ||
              (method === 'password' && !password)
            }
            onClick={submitProof}
          >
            {t('确认')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className='py-6 text-center text-sm text-gray-500'>
          {t('正在加载验证方式...')}
        </div>
      ) : (
        <div className='flex flex-col gap-3 py-1'>
          {availableMethods.length > 1 && (
            <RadioGroup
              type='button'
              value={method}
              onChange={(e) => selectProofMethod(e.target.value)}
            >
              {availableMethods.map((m) => (
                <Radio key={m.method} value={m.method}>
                  {t(METHOD_LABELS[m.method] || m.method)}
                </Radio>
              ))}
            </RadioGroup>
          )}
          <Typography.Text type='tertiary' size='small'>
            {t(METHOD_HINTS[method] || '请选择一种验证方式')}
          </Typography.Text>
          {method === 'password' && (
            <Input
              mode='password'
              placeholder={t('请输入账号密码')}
              value={password}
              onChange={setProofPassword}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitProof();
              }}
            />
          )}
          {method === '2fa' && (
            <Input
              placeholder={t('请输入 6 位验证码或备用码')}
              value={code}
              onChange={setProofCode}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitProof();
              }}
            />
          )}
          {error && <Typography.Text type='danger'>{error}</Typography.Text>}
        </div>
      )}
    </Modal>
  );
};

export default SecurityProofModal;
