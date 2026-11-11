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

import React, { useEffect, useState, useRef } from 'react';
import {
  Button,
  Col,
  Form,
  Row,
  Spin,
  DatePicker,
  Typography,
  Modal,
  Banner,
} from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
} from '../../../helpers';

const { Text } = Typography;

export default function SettingsLog(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [loadingCleanHistoryLog, setLoadingCleanHistoryLog] = useState(false);
  const [inputs, setInputs] = useState({
    LogConsumeEnabled: false,
    'payload_capture_setting.enabled': false,
    'payload_capture_setting.capture_client_request': true,
    'payload_capture_setting.capture_upstream_request': true,
    'payload_capture_setting.capture_upstream_response': true,
    'payload_capture_setting.capture_raw_upstream_response': false,
    'payload_capture_setting.capture_binary': false,
    'payload_capture_setting.max_payload_bytes': 49152,
    'payload_capture_setting.retention_days': 7,
    'payload_capture_setting.session_gap_minutes': 30,
    historyTimestamp: dayjs().subtract(1, 'month').toDate(),
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow).filter(
      (item) => item.key !== 'historyTimestamp',
    );

    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) => {
      const raw = inputs[item.key];
      // option 接口只接受字符串：布尔与数字都要显式转换，否则 axios 会传
      // 非字符串值，后端 updateOptionMap 的分层配置解析会失败。
      const value =
        typeof raw === 'boolean' || typeof raw === 'number'
          ? String(raw)
          : raw;
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }
  async function onCleanHistoryLog() {
    if (!inputs.historyTimestamp) {
      showError(t('请选择日志记录时间'));
      return;
    }

    const now = dayjs();
    const targetDate = dayjs(inputs.historyTimestamp);
    const targetTime = targetDate.format('YYYY-MM-DD HH:mm:ss');
    const currentTime = now.format('YYYY-MM-DD HH:mm:ss');
    const daysDiff = now.diff(targetDate, 'day');

    Modal.confirm({
      title: t('确认清除历史日志'),
      content: (
        <div style={{ lineHeight: '1.8' }}>
          <p>
            <Text>{t('当前时间')}：</Text>
            <Text strong style={{ color: '#52c41a' }}>
              {currentTime}
            </Text>
          </p>
          <p>
            <Text>{t('选择时间')}：</Text>
            <Text strong type='danger'>
              {targetTime}
            </Text>
            {daysDiff > 0 && (
              <Text type='tertiary'>
                {' '}
                ({t('约')} {daysDiff} {t('天前')})
              </Text>
            )}
          </p>
          <div
            style={{
              background: '#fff7e6',
              border: '1px solid #ffd591',
              padding: '12px',
              borderRadius: '4px',
              marginTop: '12px',
              color: '#333',
            }}
          >
            <Text strong style={{ color: '#d46b08' }}>
              ⚠️ {t('注意')}：
            </Text>
            <Text style={{ color: '#333' }}>{t('将删除')} </Text>
            <Text strong style={{ color: '#cf1322' }}>
              {targetTime}
            </Text>
            {daysDiff > 0 && (
              <Text style={{ color: '#8c8c8c' }}>
                {' '}
                ({t('约')} {daysDiff} {t('天前')})
              </Text>
            )}
            <Text style={{ color: '#333' }}> {t('之前的所有日志')}</Text>
          </div>
          <p style={{ marginTop: '12px' }}>
            <Text type='danger'>
              {t('此操作不可恢复，请仔细确认时间后再操作！')}
            </Text>
          </p>
        </div>
      ),
      okText: t('确认删除'),
      cancelText: t('取消'),
      okType: 'danger',
      onOk: async () => {
        try {
          setLoadingCleanHistoryLog(true);
          const res = await API.delete(
            `/api/log/?target_timestamp=${Date.parse(inputs.historyTimestamp) / 1000}`,
          );
          const { success, message, data } = res.data;
          if (success) {
            showSuccess(`${data} ${t('条日志已清理！')}`);
            return;
          } else {
            throw new Error(t('日志清理失败：') + message);
          }
        } catch (error) {
          showError(error.message);
        } finally {
          setLoadingCleanHistoryLog(false);
        }
      },
    });
  }

  useEffect(() => {
    const currentInputs = {};
    for (let key in props.options) {
      if (Object.keys(inputs).includes(key)) {
        currentInputs[key] = props.options[key];
      }
    }
    currentInputs['historyTimestamp'] = inputs.historyTimestamp;
    setInputs(Object.assign(inputs, currentInputs));
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
  }, [props.options]);
  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('日志设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'LogConsumeEnabled'}
                  label={t('启用额度消费日志记录')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      LogConsumeEnabled: value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Spin spinning={loadingCleanHistoryLog}>
                  <Form.DatePicker
                    label={t('清除历史日志')}
                    field={'historyTimestamp'}
                    type='dateTime'
                    inputReadOnly={true}
                    onChange={(value) => {
                      setInputs({
                        ...inputs,
                        historyTimestamp: value,
                      });
                    }}
                  />
                  <Text
                    type='tertiary'
                    size='small'
                    style={{ display: 'block', marginTop: 4, marginBottom: 8 }}
                  >
                    {t('将清除选定时间之前的所有日志')}
                  </Text>
                  <Button
                    size='default'
                    type='danger'
                    onClick={onCleanHistoryLog}
                  >
                    {t('清除历史日志')}
                  </Button>
                </Spin>
              </Col>
            </Row>

            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存日志设置')}
              </Button>
            </Row>
          </Form.Section>

          <Form.Section text={t('请求上下文采集')}>
            <Banner
              type='warning'
              closeIcon={null}
              className='mb-3'
              description={t(
                '请求正文包含用户对话内容与潜在凭据，默认关闭。开启后仅管理员可查看，凭据字段会被脱敏，但存储体积会显著增加。',
              )}
            />
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.enabled'}
                  label={t('启用请求上下文采集')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.enabled': value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.capture_client_request'}
                  label={t('采集客户端请求体')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.capture_client_request': value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.capture_upstream_request'}
                  label={t('采集发往上游的请求体')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.capture_upstream_request': value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.capture_upstream_response'}
                  label={t('采集上游响应内容')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.capture_upstream_response': value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.capture_raw_upstream_response'}
                  label={t('采集上游原始字节')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  disabled={
                    !inputs['payload_capture_setting.enabled'] ||
                    !inputs['payload_capture_setting.capture_upstream_response']
                  }
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.capture_raw_upstream_response':
                        value,
                    });
                  }}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {t(
                    '开启后改用原始字节采集。已知限制：会替换响应体的渠道（如 MiniMax）将采集不到响应内容。',
                  )}
                </Text>
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'payload_capture_setting.capture_binary'}
                  label={t('采集多模态与二进制内容')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.capture_binary': value,
                    });
                  }}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {t('关闭时图片、音频等二进制内容会被替换为占位符。')}
                </Text>
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'payload_capture_setting.max_payload_bytes'}
                  label={t('单份正文上限（字节）')}
                  min={1024}
                  max={60000}
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.max_payload_bytes': value,
                    });
                  }}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {t(
                    '超出即截断并标记。上限受 MySQL TEXT 列限制，不应超过 60000。',
                  )}
                </Text>
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'payload_capture_setting.retention_days'}
                  label={t('保留天数')}
                  min={0}
                  max={3650}
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.retention_days': value,
                    });
                  }}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {t('0 表示不自动清理。每次请求最多占用三份正文。')}
                </Text>
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'payload_capture_setting.session_gap_minutes'}
                  label={t('会话切分间隔（分钟）')}
                  min={0}
                  max={1440}
                  disabled={!inputs['payload_capture_setting.enabled']}
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      'payload_capture_setting.session_gap_minutes': value,
                    });
                  }}
                />
                <Text
                  type='tertiary'
                  size='small'
                  style={{ display: 'block', marginTop: 4 }}
                >
                  {t('超过该间隔无新请求即视为新会话。')}
                </Text>
              </Col>
            </Row>

            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存日志设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
