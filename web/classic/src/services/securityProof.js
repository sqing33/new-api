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

import { API } from '../helpers';
import {
  prepareCredentialRequestOptions,
  buildAssertionResult,
  isPasskeySupported,
} from '../helpers/passkey';

/**
 * 安全操作证明（security proof）服务。
 *
 * 新版契约：POST /api/verify 返回一次性 proof_token，
 * 业务请求通过 X-Security-Proof 请求头携带该令牌。
 */

export const secureProofHeaders = (proofToken) =>
  proofToken ? { 'X-Security-Proof': proofToken } : {};

export const SecurityProofService = {
  /**
   * 获取某个操作范围内可用的验证方式
   * @returns {Promise<{scope, methods: [{method, available, reason}], password_encryption_enabled}>}
   */
  async fetchRequirements(scope) {
    const res = await API.get('/api/verify/methods', { params: { scope } });
    if (!res.data?.success) {
      throw new Error(res.data?.message || '获取验证方式失败');
    }
    return res.data.data;
  },

  /**
   * 通过密码换取证明令牌
   */
  async verifyWithPassword(scope, password, passwordEncryptionEnabled) {
    const body = { method: 'password', scope, password };
    if (passwordEncryptionEnabled) {
      const keyRes = await API.get('/api/user/login/encryption-key');
      const keyData = keyRes.data?.data;
      if (keyData?.enabled && keyData?.public_key) {
        const encrypted = await encryptPasswordRSA(
          password,
          keyData.public_key,
          keyData.kid,
        );
        body.password = '';
        body.password_encrypted = encrypted.ciphertext;
        body.encryption_key_id = encrypted.keyId;
      }
    }
    const res = await API.post('/api/verify', body);
    if (!res.data?.success) {
      throw new Error(res.data?.message || '验证失败');
    }
    return res.data.data?.proof_token;
  },

  /**
   * 通过两步验证码换取证明令牌
   */
  async verifyWith2FA(scope, code) {
    if (!code?.trim()) {
      throw new Error('请输入验证码或备用码');
    }
    const res = await API.post('/api/verify', {
      method: '2fa',
      scope,
      code: code.trim(),
    });
    if (!res.data?.success) {
      throw new Error(res.data?.message || '验证失败');
    }
    return res.data.data?.proof_token;
  },

  /**
   * 通过 Passkey 仪式换取证明令牌
   */
  async verifyWithPasskey(scope) {
    const beginResponse = await API.post('/api/user/passkey/verify/begin');
    if (!beginResponse.data?.success) {
      throw new Error(beginResponse.data?.message || '开始验证失败');
    }
    const publicKey = prepareCredentialRequestOptions(
      beginResponse.data.data?.options || beginResponse.data.data,
    );
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) {
      throw new Error('Passkey 验证被取消');
    }
    const assertionResult = buildAssertionResult(credential);
    const finishResponse = await API.post(
      '/api/user/passkey/verify/finish',
      assertionResult,
    );
    if (!finishResponse.data?.success) {
      throw new Error(finishResponse.data?.message || '验证失败');
    }
    const verifyResponse = await API.post('/api/verify', {
      method: 'passkey',
      scope,
    });
    if (!verifyResponse.data?.success) {
      throw new Error(verifyResponse.data?.message || '验证失败');
    }
    return verifyResponse.data.data?.proof_token;
  },

  async isPasskeyAvailable() {
    try {
      return await isPasskeySupported();
    } catch (e) {
      return false;
    }
  },
};

// RSA-OAEP/SHA-256 加密，与登录加密保持一致
async function encryptPasswordRSA(password, publicKeyPem, keyId) {
  const hijacked = window.crypto?.subtle;
  if (!hijacked) {
    throw new Error('当前环境不支持密码加密');
  }
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await hijacked.importKey(
    'spki',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const encrypted = await hijacked.encrypt(
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(password),
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return { ciphertext: base64, keyId };
}
