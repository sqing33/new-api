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

import { useCallback, useState } from 'react';
import { SecurityProofService, secureProofHeaders } from '../../services/securityProof';

const initialState = {
  visible: false,
  loading: false,
  submitting: false,
  requirements: null,
  method: null,
  code: '',
  password: '',
  error: '',
  title: '',
  scope: '',
  context: null,
  onSuccess: null,
};

/**
 * 安全操作证明 Hook。
 *
 * 用法：
 *   const { proofState, requireProof, submitProof, cancelProof, selectProofMethod,
 *           setProofCode, setProofPassword } = useSecurityProof();
 *   await requireProof({
 *     scope: 'access_token.generate',
 *     title: '生成访问令牌',
 *     onSuccess: async (proof) => { ... 带 secureProofHeaders(proof) 的请求 ... },
 *   });
 */
export const useSecurityProof = () => {
  const [proofState, setProofState] = useState(initialState);

  const pickDefaultMethod = (requirements) => {
    const available = (requirements?.methods || []).filter(
      (m) => m.available,
    );
    const priority = ['passkey', '2fa', 'password', 'oauth'];
    for (const method of priority) {
      if (available.some((m) => m.method === method)) return method;
    }
    return available[0]?.method || null;
  };

  const requireProof = useCallback(({ scope, context, title, onSuccess }) => {
    setProofState((prev) => ({
      ...initialState,
      visible: true,
      loading: true,
      scope,
      context,
      title: title || '安全验证',
      onSuccess,
    }));
    return SecurityProofService.fetchRequirements(scope)
      .then((requirements) => {
        setProofState((prev) => ({
          ...prev,
          loading: false,
          requirements,
          method: pickDefaultMethod(requirements),
        }));
        return true;
      })
      .catch((error) => {
        setProofState(initialState);
        throw error;
      });
  }, []);

  const selectProofMethod = useCallback((method) => {
    setProofState((prev) => ({
      ...prev,
      method,
      code: '',
      error: '',
    }));
  }, []);

  const setProofCode = useCallback((code) => {
    setProofState((prev) => ({ ...prev, code }));
  }, []);

  const setProofPassword = useCallback((password) => {
    setProofState((prev) => ({ ...prev, password }));
  }, []);

  const cancelProof = useCallback(() => {
    setProofState((prev) => ({ ...initialState, visible: false }));
  }, []);

  const submitProof = useCallback(async () => {
    setProofState((prev) => {
      if (!prev.visible) return prev;
      return { ...prev, submitting: true, error: '' };
    });
    try {
      let proofToken = null;
      const { method, scope, context, code, password, requirements } =
        proofState;
      if (method === 'password') {
        proofToken = await SecurityProofService.verifyWithPassword(
          scope,
          password,
          !!requirements?.password_encryption_enabled,
        );
      } else if (method === '2fa') {
        proofToken = await SecurityProofService.verifyWith2FA(scope, code);
      } else if (method === 'passkey') {
        proofToken = await SecurityProofService.verifyWithPasskey(scope);
      } else {
        throw new Error('当前验证方式暂不支持，请选择其他方式');
      }
      if (!proofToken) {
        throw new Error('验证未返回有效凭证，请重试');
      }
      const onSuccess = proofState.onSuccess;
      setProofState(initialState);
      if (onSuccess) {
        await onSuccess(proofToken, context);
      }
      return proofToken;
    } catch (error) {
      const message = error?.message || '验证失败，请重试';
      setProofState((prev) => ({ ...prev, submitting: false, error: message }));
      throw error;
    }
  }, [proofState]);

  return {
    proofState,
    requireProof,
    submitProof,
    cancelProof,
    selectProofMethod,
    setProofCode,
    setProofPassword,
    secureProofHeaders,
  };
};

export default useSecurityProof;
