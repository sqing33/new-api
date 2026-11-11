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
import {
  Banner,
  Descriptions,
  SideSheet,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { API, copy, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

// 会话分组依据与其置信度提示。heuristic 为启发式分组，可能不准确，
// 必须在界面上明确告知，不能让管理员误以为分组是精确的。
const SESSION_KIND_META = {
  explicit: { color: 'green', label: '显式声明' },
  response_chain: { color: 'green', label: '响应链' },
  heuristic: { color: 'orange', label: '启发式分组' },
  empty: { color: 'grey', label: '未分组' },
};

const prettifyBody = (raw) => {
  if (!raw) {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // 流式响应是逐帧拼接的，不保证是合法 JSON，原样展示即可。
    return raw;
  }
};

const BodyBlock = ({ title, body, truncated, bytes, t }) => {
  const formatted = useMemo(() => prettifyBody(body), [body]);

  const handleCopy = useCallback(async () => {
    if (!formatted) {
      return;
    }
    if (await copy(formatted)) {
      showSuccess(t('已复制'));
      return;
    }
    showError(t('无法复制到剪贴板，请手动复制'));
  }, [formatted, t]);

  if (!body) {
    return (
      <div className='py-6 text-center'>
        <Text type='tertiary'>{t('未采集该内容')}</Text>
      </div>
    );
  }

  return (
    <div>
      {truncated ? (
        <Banner
          type='warning'
          closeIcon={null}
          className='mb-2'
          description={t('内容已截断，原始 {{bytes}} 字节', { bytes })}
        />
      ) : null}
      <div className='flex justify-between items-center mb-1'>
        <Text type='tertiary' size='small'>
          {title}
        </Text>
        <Text
          type='primary'
          size='small'
          style={{ cursor: 'pointer' }}
          onClick={handleCopy}
        >
          {t('复制')}
        </Text>
      </div>
      <pre
        style={{
          maxHeight: 420,
          overflow: 'auto',
          background: 'var(--semi-color-fill-0)',
          padding: 12,
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          margin: 0,
        }}
      >
        {formatted}
      </pre>
    </div>
  );
};

const RequestPayloadModal = ({ visible, requestId, onClose, t }) => {
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState([]);
  const [activeAttempt, setActiveAttempt] = useState(0);

  useEffect(() => {
    if (!visible || !requestId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    API.get(`/api/log/payload/${encodeURIComponent(requestId)}`)
      .then((res) => {
        if (cancelled) {
          return;
        }
        const { success, message, data } = res.data;
        if (!success) {
          showError(message);
          setAttempts([]);
          return;
        }
        setAttempts(Array.isArray(data) ? data : []);
        setActiveAttempt(0);
      })
      .catch(() => {
        if (!cancelled) {
          setAttempts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, requestId]);

  const current = attempts[activeAttempt];
  const sessionMeta =
    SESSION_KIND_META[current?.session_key_kind] ?? SESSION_KIND_META.empty;

  return (
    <SideSheet
      title={t('请求上下文')}
      visible={visible}
      onCancel={onClose}
      width={760}
      footer={null}
      closable
      maskClosable
    >
      <Spin spinning={loading}>
        {attempts.length === 0 && !loading ? (
          <div className='py-10 text-center'>
            <Text type='tertiary'>
              {t('该请求没有采集到上下文内容')}
            </Text>
          </div>
        ) : null}

        {attempts.length > 1 ? (
          <Tabs
            type='button'
            activeKey={String(activeAttempt)}
            onChange={(key) => setActiveAttempt(Number(key))}
            className='mb-3'
          >
            {attempts.map((item, index) => (
              <TabPane
                tab={`#${item.attempt_index ?? index}`}
                itemKey={String(index)}
                key={item.id ?? index}
              />
            ))}
          </Tabs>
        ) : null}

        {current ? (
          <div>
            <Descriptions
              row
              size='small'
              className='mb-3'
              data={[
                { key: t('请求 ID'), value: current.request_id },
                {
                  key: t('尝试序号'),
                  value: String(current.attempt_index ?? 0),
                },
                { key: t('模型'), value: current.model_name || '-' },
                { key: t('渠道'), value: String(current.channel_id ?? 0) },
                { key: t('令牌'), value: current.token_name || '-' },
                {
                  key: t('分组依据'),
                  value: (
                    <Tag color={sessionMeta.color} size='small'>
                      {t(sessionMeta.label)}
                    </Tag>
                  ),
                },
              ]}
            />

            {current.session_key_kind === 'heuristic' ? (
              <Banner
                type='info'
                closeIcon={null}
                className='mb-3'
                description={t(
                  '启发式分组，可能不准确：网关侧没有会话标识，按令牌、模型与首条系统消息指纹聚合。',
                )}
              />
            ) : null}

            {current.redacted ? (
              <Banner
                type='info'
                closeIcon={null}
                className='mb-3'
                description={t('已对凭据字段脱敏，显示为 ***masked***')}
              />
            ) : null}

            <Tabs type='line'>
              <TabPane tab={t('客户端请求')} itemKey='client'>
                <BodyBlock
                  title={t('客户端原始请求体')}
                  body={current.client_request_body}
                  truncated={current.client_truncated}
                  bytes={current.client_bytes}
                  t={t}
                />
              </TabPane>
              <TabPane tab={t('发往上游')} itemKey='upstream'>
                <BodyBlock
                  title={t('转换后发往上游的请求体')}
                  body={current.upstream_request_body}
                  truncated={current.upstream_req_truncated}
                  bytes={current.upstream_req_bytes}
                  t={t}
                />
              </TabPane>
              <TabPane tab={t('上游响应')} itemKey='response'>
                <BodyBlock
                  title={t('上游响应内容')}
                  body={current.upstream_response_body}
                  truncated={current.upstream_resp_truncated}
                  bytes={current.upstream_resp_bytes}
                  t={t}
                />
              </TabPane>
            </Tabs>
          </div>
        ) : null}
      </Spin>
    </SideSheet>
  );
};

export default RequestPayloadModal;
