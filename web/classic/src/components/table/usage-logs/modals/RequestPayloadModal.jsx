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
  Modal,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  copy,
  groupTagColor,
  showError,
  showSuccess,
} from '../../../../helpers';
import { prettifyBody } from './prettifyBody';

const { Text } = Typography;

// 会话分组依据与其置信度提示。heuristic 为启发式分组，可能不准确，
// 必须在界面上明确告知，不能让管理员误以为分组是精确的。
const SESSION_KIND_META = {
  explicit: { color: 'green', label: '显式声明' },
  response_chain: { color: 'green', label: '响应链' },
  heuristic: { color: 'orange', label: '启发式分组' },
  empty: { color: 'grey', label: '未分组' },
};

// 正文区高度。用视口比例而非固定像素，兼顾大屏与小窗口。
const BODY_MAX_HEIGHT = '52vh';

// 让 Semi Tabs 的内容区参与 flex 高度分配：
// 默认 Tabs 内容是「按内容高度收缩」的，正文区无法占满弹窗剩余空间。
//
// 真实 DOM 嵌套是 tabs > tabs-content > tabs-pane > tabs-pane-motion-overlay，
// 四层都要允许收缩，BodyBlock 的 flex:1 才能把剩余高度吃掉。
const TAB_STYLE = `
.payload-tabs { display: flex; flex-direction: column; min-height: 0; }
.payload-tabs > .semi-tabs-bar { flex: 0 0 auto; }
.payload-tabs > .semi-tabs-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.payload-tabs .semi-tabs-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.payload-tabs .semi-tabs-pane-motion-overlay { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
`;
const BodyBlock = ({ title, body, truncated, bytes, t }) => {
  const formatted = useMemo(
    () => prettifyBody(body, truncated),
    [body, truncated],
  );

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
    // flex 列布局 + 正文区 flex:1，使正文占满弹窗剩余高度，
    // 而不是只按内容高度收缩成一小块。
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
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
          flex: 1,
          minHeight: BODY_MAX_HEIGHT,
          maxHeight: BODY_MAX_HEIGHT,
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

const RequestPayloadModal = ({ visible, target, onClose, t }) => {
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState([]);
  const [activeAttempt, setActiveAttempt] = useState(0);

  const requestId = target?.requestId || '';
  const channelName = target?.channelName || '';
  const logTokenName = target?.tokenName || '';
  const tokenGroup = target?.tokenGroup || '';

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

  // 渠道展示为「名称（#序号）」；日志行没带名称时退回仅序号。
  const channelValue =
    current?.channel_id === undefined || current?.channel_id === null
      ? '-'
      : channelName
        ? `${channelName}（#${current.channel_id}）`
        : `#${current.channel_id}`;

  // 令牌名右侧并入令牌标签，与日志页「令牌」单元格的呈现保持一致。
  const tokenValue = (
    <span className='inline-flex items-center gap-1'>
      <span>{current?.token_name || logTokenName || '-'}</span>
      {tokenGroup ? (
        <Tag color={groupTagColor(tokenGroup)} shape='circle' type='light'>
          {tokenGroup}
        </Tag>
      ) : null}
    </span>
  );

  return (
    <Modal
      title={t('请求上下文')}
      visible={visible}
      onCancel={onClose}
      footer={null}
      centered
      closable
      maskClosable
      width={960}
      bodyStyle={{ maxHeight: '78vh', overflow: 'auto' }}
    >
      <style>{TAB_STYLE}</style>
      <Spin spinning={loading}>
        {attempts.length === 0 && !loading ? (
          <div className='py-10 text-center'>
            <Text type='tertiary'>{t('该请求没有采集到上下文内容')}</Text>
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
                { key: t('渠道'), value: channelValue },
                { key: t('令牌'), value: tokenValue },
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

            <Tabs
              type='line'
              // 让 Tab 内容区继承剩余高度，BodyBlock 才能用 flex:1 撑满。
              className='payload-tabs'
            >
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
    </Modal>
  );
};

export default RequestPayloadModal;
