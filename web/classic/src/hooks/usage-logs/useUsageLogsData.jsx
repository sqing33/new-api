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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@douyinfe/semi-ui';
import {
  API,
  getTodayStartTimestamp,
  isAdmin,
  showError,
  showSuccess,
  timestamp2string,
  renderQuota,
  renderNumber,
  getLogOther,
  copy,
  renderClaudeLogContent,
  renderLogContent,
  renderAudioModelPrice,
  renderClaudeModelPrice,
  renderModelPrice,
  renderTieredModelPrice,
  renderTaskBillingProcess,
} from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';
import { useAutoRefresh } from '../common/useAutoRefresh';
import { useAutoRefreshSetting } from '../common/useAutoRefreshSetting';
import ParamOverrideEntry from '../../components/table/usage-logs/components/ParamOverrideEntry';

// 每页条数的持久化键。与 /channel 共用同一个 key（两者的默认值与选项集相同），
// 表现为「共享每页条数偏好」。
const PAGE_SIZE_STORAGE_KEY = 'page-size';

// 读持久化的每页条数。多个 effect 都要用它，且必须各自现读——
// 在 effect 里捕获 pageSize 会拿到同一次渲染的初始值，导致用旧值发请求。
const readPersistedPageSize = () =>
  parseInt(localStorage.getItem(PAGE_SIZE_STORAGE_KEY)) || ITEMS_PER_PAGE;

export const useLogsData = ({
  imageOnly = false,
  imageModelOptions = [],
  enabled = true,
} = {}) => {  const { t } = useTranslation();

  // Define column keys for selection
  const COLUMN_KEYS = {
    TIME: 'time',
    CHANNEL: 'channel',
    USERNAME: 'username',
    TOKEN: 'token',
    GROUP: 'group',
    TYPE: 'type',
    MODEL: 'model',
    USE_TIME: 'use_time',
    PROMPT: 'prompt',
    COMPLETION: 'completion',
    OUTPUT_SPEED: 'output_speed',
    COST: 'cost',
    RETRY: 'retry',
    IP: 'ip',
    DETAILS: 'details',
    ERROR: 'error',
    PAYLOAD: 'payload',
  };

  // Basic state
  const [logs, setLogs] = useState([]);
  const [expandData, setExpandData] = useState({});
  const [showStat, setShowStat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStat, setLoadingStat] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [logCount, setLogCount] = useState(0);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [logType, setLogType] = useState(imageOnly ? 2 : 0);
  const imageModelOptionsKey = imageModelOptions.join('|');

  // User and admin
  const isAdminUser = isAdmin();
  // Role-specific storage key to prevent different roles from overwriting each other
  const STORAGE_KEY = isAdminUser
    ? 'logs-table-columns-admin'
    : 'logs-table-columns-user';
  const BILLING_DISPLAY_MODE_STORAGE_KEY = isAdminUser
    ? 'logs-billing-display-mode-admin'
    : 'logs-billing-display-mode-user';

  // Statistics state
  const [stat, setStat] = useState({
    quota: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  });

  // Form state
  const [formApi, setFormApi] = useState(null);
  const canLoadLogs =
    enabled && (!imageOnly || (formApi && imageModelOptions.length > 0));
  let now = new Date();
  const formInitValues = {
    username: '',
    token_name: '',
    // 清荫日志默认不预选模型：输入框留空即表示不筛选，
    // 后端凭 image_only 已限定只看生成类模型
    model_name: '',
    channel: '',
    group: '',
    request_id: '',
    dateRange: [
      timestamp2string(getTodayStartTimestamp()),
      timestamp2string(now.getTime() / 1000 + 3600),
    ],
    logType: imageOnly ? '2' : '0',
  };

  // Get default column visibility based on user role
  const getDefaultColumnVisibility = () => {
    return {
      [COLUMN_KEYS.TIME]: true,
      [COLUMN_KEYS.CHANNEL]: isAdminUser,
      [COLUMN_KEYS.USERNAME]: isAdminUser,
      [COLUMN_KEYS.TOKEN]: true,
      [COLUMN_KEYS.GROUP]: true,
      [COLUMN_KEYS.TYPE]: true,
      [COLUMN_KEYS.MODEL]: true,
      [COLUMN_KEYS.USE_TIME]: true,
      [COLUMN_KEYS.PROMPT]: true,
      [COLUMN_KEYS.COMPLETION]: true,
      [COLUMN_KEYS.OUTPUT_SPEED]: true,
      [COLUMN_KEYS.COST]: true,
      [COLUMN_KEYS.RETRY]: isAdminUser,
      [COLUMN_KEYS.IP]: true,
      [COLUMN_KEYS.DETAILS]: true,
    [COLUMN_KEYS.ERROR]: true,
      // 请求上下文载荷只对管理员开放，因此默认列也只对管理员可见。
      [COLUMN_KEYS.PAYLOAD]: isAdminUser,
    };
  };

  const getInitialVisibleColumns = () => {
    const defaults = getDefaultColumnVisibility();
    const savedColumns = localStorage.getItem(STORAGE_KEY);

    if (!savedColumns) {
      return defaults;
    }

    try {
      const parsed = JSON.parse(savedColumns);
      const merged = { ...defaults, ...parsed };

      if (!isAdminUser) {
        merged[COLUMN_KEYS.CHANNEL] = false;
        merged[COLUMN_KEYS.USERNAME] = false;
        merged[COLUMN_KEYS.RETRY] = false;
      }

      return merged;
    } catch (e) {
      console.error('Failed to parse saved column preferences', e);
      return defaults;
    }
  };

  const getInitialBillingDisplayMode = () => {
    const savedMode = localStorage.getItem(BILLING_DISPLAY_MODE_STORAGE_KEY);
    if (savedMode === 'price' || savedMode === 'ratio') {
      return savedMode;
    }
    return localStorage.getItem('quota_display_type') === 'TOKENS'
      ? 'ratio'
      : 'price';
  };

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState(
    getInitialVisibleColumns,
  );
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [billingDisplayMode, setBillingDisplayMode] = useState(
    getInitialBillingDisplayMode,
  );

  // Compact mode
  const [compactMode, setCompactMode] = useTableCompactMode('logs');

  // User info modal state
  const [showUserInfo, setShowUserInfoModal] = useState(false);
  const [userInfoData, setUserInfoData] = useState(null);

  // Channel affinity usage cache stats modal state (admin only)
  const [
    showChannelAffinityUsageCacheModal,
    setShowChannelAffinityUsageCacheModal,
  ] = useState(false);
  const [channelAffinityUsageCacheTarget, setChannelAffinityUsageCacheTarget] =
    useState(null);
  const [showParamOverrideModal, setShowParamOverrideModal] = useState(false);
  const [paramOverrideTarget, setParamOverrideTarget] = useState(null);
  const [showRequestPayloadModal, setShowRequestPayloadModal] = useState(false);
  const [requestPayloadTarget, setRequestPayloadTarget] = useState(null);
  // 分组可搜索筛选：管理员从 /api/group/ 拉取全量分组供下拉搜索
  const [groupOptions, setGroupOptions] = useState([]);

  // Initialize default column visibility
  const initDefaultColumns = () => {
    const defaults = getDefaultColumnVisibility();
    setVisibleColumns(defaults);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  };

  // Handle column visibility change
  const handleColumnVisibilityChange = (columnKey, checked) => {
    const updatedColumns = { ...visibleColumns, [columnKey]: checked };
    setVisibleColumns(updatedColumns);
  };

  // Handle "Select All" checkbox
  const handleSelectAll = (checked) => {
    const allKeys = Object.keys(COLUMN_KEYS).map((key) => COLUMN_KEYS[key]);
    const updatedColumns = {};

    allKeys.forEach((key) => {
      if (
        (key === COLUMN_KEYS.CHANNEL ||
          key === COLUMN_KEYS.USERNAME ||
          key === COLUMN_KEYS.RETRY) &&
        !isAdminUser
      ) {
        updatedColumns[key] = false;
      } else {
        updatedColumns[key] = checked;
      }
    });

    setVisibleColumns(updatedColumns);
  };

  // Persist column settings to the role-specific STORAGE_KEY
  useEffect(() => {
    if (Object.keys(visibleColumns).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
    }
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem(BILLING_DISPLAY_MODE_STORAGE_KEY, billingDisplayMode);
  }, [BILLING_DISPLAY_MODE_STORAGE_KEY, billingDisplayMode]);

  useEffect(() => {
    if (!isAdminUser || groupOptions.length > 0) return;
    let cancelled = false;
    API.get('/api/group/')
      .then((res) => {
        if (cancelled || res === undefined) return;
        const groups = res.data?.data;
        if (Array.isArray(groups)) {
          setGroupOptions(
            groups.map((group) => ({ label: group, value: group })),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdminUser, groupOptions.length]);

  // 获取表单值的辅助函数，确保所有值都是字符串
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};

    let start_timestamp = timestamp2string(getTodayStartTimestamp());
    let end_timestamp = timestamp2string(now.getTime() / 1000 + 3600);

    if (
      formValues.dateRange &&
      Array.isArray(formValues.dateRange) &&
      formValues.dateRange.length === 2
    ) {
      start_timestamp = formValues.dateRange[0];
      end_timestamp = formValues.dateRange[1];
    }

    const modelNameValue = formValues.model_name;

    return {
      username: formValues.username || '',
      token_name: formValues.token_name || '',
      // 清荫日志下留空表示不筛选（后端 image_only 已限定生成类模型），
      // 勾选后才把所选模型作为精确条件下发
      model_name: imageOnly
        ? Array.isArray(modelNameValue)
          ? modelNameValue
          : modelNameValue
            ? [modelNameValue]
            : []
        : modelNameValue || '',
      start_timestamp,
      end_timestamp,
      channel: formValues.channel || '',
      group: formValues.group || '',
      request_id: formValues.request_id || '',
      logType: formValues.logType
        ? parseInt(formValues.logType)
        : imageOnly
          ? 2
          : 0,
    };
  };

  const buildLogQueryString = (params) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value
          .filter((item) => item !== undefined && item !== null && item !== '')
          .forEach((item) => searchParams.append(key, item));
        return;
      }
      searchParams.set(key, value);
    });
    return searchParams.toString();
  };

  // Statistics functions
  const getLogSelfStat = async () => {
    const {
      token_name,
      model_name,
      start_timestamp,
      end_timestamp,
      group,
      logType: formLogType,
    } = getFormValues();
    const currentLogType = formLogType !== undefined ? formLogType : logType;
    let localStartTimestamp = Date.parse(start_timestamp) / 1000;
    let localEndTimestamp = Date.parse(end_timestamp) / 1000;
    let url = `/api/log/self/stat?${buildLogQueryString({
      type: currentLogType,
      token_name,
      model_name: Array.isArray(model_name) ? '' : model_name,
      model_names: Array.isArray(model_name) ? model_name : [],
      image_only: imageOnly ? 'true' : '',
      exclude_image_models: imageOnly ? '' : 'true',
      start_timestamp: localStartTimestamp,
      end_timestamp: localEndTimestamp,
      group,
    })}`;
    let res = await API.get(url);
    const { success, message, data } = res.data;
    if (success) {
      setStat(data);
    } else {
      showError(message);
    }
  };

  const getLogStat = async () => {
    const {
      username,
      token_name,
      model_name,
      start_timestamp,
      end_timestamp,
      channel,
      group,
      logType: formLogType,
    } = getFormValues();
    const currentLogType = formLogType !== undefined ? formLogType : logType;
    let localStartTimestamp = Date.parse(start_timestamp) / 1000;
    let localEndTimestamp = Date.parse(end_timestamp) / 1000;
    let url = `/api/log/stat?${buildLogQueryString({
      type: currentLogType,
      username,
      token_name,
      model_name: Array.isArray(model_name) ? '' : model_name,
      model_names: Array.isArray(model_name) ? model_name : [],
      image_only: imageOnly ? 'true' : '',
      exclude_image_models: imageOnly ? '' : 'true',
      start_timestamp: localStartTimestamp,
      end_timestamp: localEndTimestamp,
      channel,
      group,
    })}`;
    let res = await API.get(url);
    const { success, message, data } = res.data;
    if (success) {
      setStat(data);
    } else {
      showError(message);
    }
  };

  const handleEyeClick = async () => {
    if (!canLoadLogs) {
      setStat({
        quota: 0,
        token: 0,
      });
      return;
    }
    if (loadingStat) {
      return;
    }
    setLoadingStat(true);
    if (isAdminUser) {
      await getLogStat();
    } else {
      await getLogSelfStat();
    }
    setShowStat(true);
    setLoadingStat(false);
  };

  // User info function
  const showUserInfoFunc = async (userId) => {
    if (!isAdminUser) {
      return;
    }
    const res = await API.get(`/api/user/${userId}`);
    const { success, message, data } = res.data;
    if (success) {
      setUserInfoData(data);
      setShowUserInfoModal(true);
    } else {
      showError(message);
    }
  };

  const openChannelAffinityUsageCacheModal = (affinity) => {
    const a = affinity || {};
    setChannelAffinityUsageCacheTarget({
      rule_name: a.rule_name || a.reason || '',
      using_group: a.using_group || '',
      key_hint: a.key_hint || '',
      key_fp: a.key_fp || '',
    });
    setShowChannelAffinityUsageCacheModal(true);
  };

  const openParamOverrideModal = (log, other) => {
    const lines = Array.isArray(other?.po) ? other.po.filter(Boolean) : [];
    if (lines.length === 0) {
      return;
    }
    setParamOverrideTarget({
      lines,
      modelName: log?.model_name || '',
      requestId: log?.request_id || '',
      requestPath: other?.request_path || '',
    });
    setShowParamOverrideModal(true);
  };

  // 请求上下文载荷：按 request_id 打开。可能一个 request_id 下有多个 attempt
  // （每个失败 attempt 一条记录），弹窗内以标签页切换。
  const openRequestPayloadModal = (log) => {
    const requestId = log?.request_id || '';
    if (!requestId) {
      return;
    }
    setRequestPayloadTarget(requestId);
    setShowRequestPayloadModal(true);
  };

  // Format logs data
  const setLogsFormat = (logs) => {
    const requestConversionDisplayValue = (conversionChain) => {
      const chain = Array.isArray(conversionChain)
        ? conversionChain.filter(Boolean)
        : [];
      if (chain.length <= 1) {
        return t('原生格式');
      }
      return `${chain.join(' -> ')}`;
    };

    let expandDatesLocal = {};
    for (let i = 0; i < logs.length; i++) {
      logs[i].timestamp2string = timestamp2string(logs[i].created_at);
      logs[i].key = logs[i].id;
      let other = getLogOther(logs[i].other);
      let expandDataLocal = [];

      if (
        isAdminUser &&
        (logs[i].type === 0 || logs[i].type === 2 || logs[i].type === 6)
      ) {
        expandDataLocal.push({
          key: t('渠道信息'),
          value: `${logs[i].channel} - ${logs[i].channel_name || '[未知]'}`,
        });
      }
      if (logs[i].request_id) {
        expandDataLocal.push({
          key: t('Request ID'),
          value: logs[i].request_id,
        });
      }
      if (other?.ws || other?.audio) {
        expandDataLocal.push({
          key: t('语音输入'),
          value: other.audio_input,
        });
        expandDataLocal.push({
          key: t('语音输出'),
          value: other.audio_output,
        });
        expandDataLocal.push({
          key: t('文字输入'),
          value: other.text_input,
        });
        expandDataLocal.push({
          key: t('文字输出'),
          value: other.text_output,
        });
      }
      if (other?.cache_tokens > 0) {
        expandDataLocal.push({
          key: t('缓存 Tokens'),
          value: other.cache_tokens,
        });
      }
      if (other?.cache_creation_tokens > 0) {
        expandDataLocal.push({
          key: t('缓存创建 Tokens'),
          value: other.cache_creation_tokens,
        });
      }
      if (logs[i].type === 2) {
        if (other?.billing_mode !== 'tiered_expr') {
          expandDataLocal.push({
            key: t('日志详情'),
            value: other?.claude
              ? renderClaudeLogContent({
                  ...other,
                  displayMode: billingDisplayMode,
                })
              : renderLogContent({ ...other, displayMode: billingDisplayMode }),
          });
        }
        if (logs[i]?.content) {
          expandDataLocal.push({
            key: t('其他详情'),
            value: logs[i].content,
          });
        }
        if (isAdminUser && other?.reject_reason) {
          expandDataLocal.push({
            key: t('拦截原因'),
            value: other.reject_reason,
          });
        }
      }
      if (logs[i].type === 2) {
        let modelMapped =
          other?.is_model_mapped &&
          other?.upstream_model_name &&
          other?.upstream_model_name !== '';
        if (modelMapped) {
          expandDataLocal.push({
            key: t('请求并计费模型'),
            value: logs[i].model_name,
          });
          expandDataLocal.push({
            key: t('实际模型'),
            value: other.upstream_model_name,
          });
        }

        const isViolationFeeLog =
          other?.violation_fee === true ||
          Boolean(other?.violation_fee_code) ||
          Boolean(other?.violation_fee_marker);

        let content = '';
        if (!isViolationFeeLog && other?.billing_mode !== 'tiered_expr') {
          const logOpts = {
            ...other,
            prompt_tokens: logs[i].prompt_tokens,
            completion_tokens: logs[i].completion_tokens,
            displayMode: billingDisplayMode,
          };
          const isTaskLog = other?.is_task === true || other?.task_id != null;
          if (isTaskLog && other?.model_price === -1) {
            content = renderTaskBillingProcess(other, logs[i].content);
          } else if (other?.ws || other?.audio) {
            content = renderAudioModelPrice(logOpts);
          } else if (other?.claude) {
            content = renderClaudeModelPrice(logOpts);
          } else {
            content = renderModelPrice(logOpts);
          }
          expandDataLocal.push({
            key: t('计费过程'),
            value: content,
          });
        }
        if (other?.reasoning_effort) {
          expandDataLocal.push({
            key: t('Reasoning Effort'),
            value: other.reasoning_effort,
          });
        }
        if (other?.billing_mode === 'tiered_expr' && other?.expr_b64) {
          expandDataLocal.push({
            key: t('计费过程'),
            value: renderTieredModelPrice({
              ...other,
              prompt_tokens: logs[i].prompt_tokens,
              completion_tokens: logs[i].completion_tokens,
              displayMode: billingDisplayMode,
            }),
          });
        }
      }
      if (logs[i].type === 6) {
        if (other?.task_id) {
          expandDataLocal.push({
            key: t('任务ID'),
            value: other.task_id,
          });
        }
        if (other?.reason) {
          expandDataLocal.push({
            key: t('失败原因'),
            value: (
              <div
                style={{
                  maxWidth: 600,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                }}
              >
                {other.reason}
              </div>
            ),
          });
        }
      }
      if (other?.request_path) {
        expandDataLocal.push({
          key: t('请求路径'),
          value: other.request_path,
        });
      }
      if (isAdminUser && other?.stream_status) {
        const ss = other.stream_status;
        const isOk = ss.status === 'ok';
        const statusLabel = isOk ? '✓ ' + t('正常') : '✗ ' + t('异常');
        let streamValue =
          statusLabel + ' (' + (ss.end_reason || 'unknown') + ')';
        if (ss.error_count > 0) {
          streamValue += ` [${t('软错误')}: ${ss.error_count}]`;
        }
        if (ss.end_error) {
          streamValue += ` - ${ss.end_error}`;
        }
        expandDataLocal.push({
          key: t('流状态'),
          value: streamValue,
        });
        if (Array.isArray(ss.errors) && ss.errors.length > 0) {
          expandDataLocal.push({
            key: t('流错误详情'),
            value: (
              <div
                style={{
                  maxWidth: 600,
                  whiteSpace: 'pre-line',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                }}
              >
                {ss.errors.join('\n')}
              </div>
            ),
          });
        }
      }
      if (Array.isArray(other?.po) && other.po.length > 0) {
        expandDataLocal.push({
          key: t('参数覆盖'),
          value: (
            <ParamOverrideEntry
              count={other.po.length}
              t={t}
              onOpen={(event) => {
                event.stopPropagation();
                openParamOverrideModal(logs[i], other);
              }}
            />
          ),
        });
      }
      if (other?.billing_source === 'subscription') {
        const planId = other?.subscription_plan_id;
        const planTitle = other?.subscription_plan_title || '';
        const subscriptionId = other?.subscription_id;
        const unit = t('额度');
        const pre = other?.subscription_pre_consumed ?? 0;
        const postDelta = other?.subscription_post_delta ?? 0;
        const finalConsumed = other?.subscription_consumed ?? pre + postDelta;
        const remain = other?.subscription_remain;
        const total = other?.subscription_total;
        // Use multiple Description items to avoid an overlong single line.
        if (planId) {
          expandDataLocal.push({
            key: t('订阅套餐'),
            value: `#${planId} ${planTitle}`.trim(),
          });
        }
        if (subscriptionId) {
          expandDataLocal.push({
            key: t('订阅实例'),
            value: `#${subscriptionId}`,
          });
        }
        const settlementLines = [
          `${t('预扣')}：${pre} ${unit}`,
          `${t('结算差额')}：${postDelta > 0 ? '+' : ''}${postDelta} ${unit}`,
          `${t('最终抵扣')}：${finalConsumed} ${unit}`,
        ]
          .filter(Boolean)
          .join('\n');
        expandDataLocal.push({
          key: t('订阅结算'),
          value: (
            <div style={{ whiteSpace: 'pre-line' }}>{settlementLines}</div>
          ),
        });
        if (remain !== undefined && total !== undefined) {
          expandDataLocal.push({
            key: t('订阅剩余'),
            value: `${remain}/${total} ${unit}`,
          });
        }
        expandDataLocal.push({
          key: t('订阅说明'),
          value: t(
            'token 会按倍率换算成“额度/次数”，请求结束后再做差额结算（补扣/返还）。',
          ),
        });
      }
      if (isAdminUser && logs[i].type !== 6 && logs[i].type !== 1) {
        expandDataLocal.push({
          key: t('请求转换'),
          value: requestConversionDisplayValue(other?.request_conversion),
        });
      }
      if (isAdminUser && logs[i].type !== 6 && logs[i].type !== 1) {
        let localCountMode = '';
        if (other?.admin_info?.local_count_tokens) {
          localCountMode = t('本地计费');
        } else {
          localCountMode = t('上游返回');
        }
        expandDataLocal.push({
          key: t('计费模式'),
          value: localCountMode,
        });
      }
      if (isAdminUser && logs[i].type === 1) {
        const adminInfo = other?.admin_info;
        if (adminInfo) {
          if (adminInfo.payment_method) {
            expandDataLocal.push({
              key: t('订单支付方式'),
              value: adminInfo.payment_method,
            });
          }
          if (adminInfo.callback_payment_method) {
            expandDataLocal.push({
              key: t('回调支付方式'),
              value: adminInfo.callback_payment_method,
            });
          }
          if (adminInfo.caller_ip) {
            expandDataLocal.push({
              key: t('回调调用者IP'),
              value: adminInfo.caller_ip,
            });
          }
          if (adminInfo.server_ip) {
            expandDataLocal.push({
              key: t('服务器IP'),
              value: adminInfo.server_ip,
            });
          }
          if (adminInfo.node_name) {
            expandDataLocal.push({
              key: t('节点名称'),
              value: adminInfo.node_name,
            });
          }
          if (adminInfo.version) {
            expandDataLocal.push({
              key: t('系统版本'),
              value: adminInfo.version,
            });
          }
        } else {
          expandDataLocal.push({
            key: t('审计信息'),
            value: (
              <span style={{ color: 'var(--semi-color-warning)' }}>
                {t(
                  '该记录由旧版本实例写入，缺少审计信息，建议将实例升级至最新版本以便记录服务器IP、回调IP、支付方式与系统版本等审计字段。',
                )}
              </span>
            ),
          });
        }
      }
      if (isAdminUser && logs[i].type === 3 && other?.admin_info) {
        const adminInfo = other.admin_info;
        const hasUsername =
          adminInfo.admin_username !== undefined &&
          adminInfo.admin_username !== null &&
          adminInfo.admin_username !== '';
        const hasId =
          adminInfo.admin_id !== undefined &&
          adminInfo.admin_id !== null &&
          adminInfo.admin_id !== '';
        if (hasUsername || hasId) {
          let operatorValue = '';
          if (hasUsername && hasId) {
            operatorValue = `${adminInfo.admin_username} (ID: ${adminInfo.admin_id})`;
          } else if (hasUsername) {
            operatorValue = String(adminInfo.admin_username);
          } else {
            operatorValue = `ID: ${adminInfo.admin_id}`;
          }
          expandDataLocal.push({
            key: t('操作管理员'),
            value: operatorValue,
          });
        }
      }
      expandDatesLocal[logs[i].key] = expandDataLocal;
    }

    setExpandData(expandDatesLocal);
    setLogs(logs);
  };

  // Load logs function
  // silent=true 用于自动刷新：不显示 loading 骨架、不弹错误 toast。
  const loadLogs = async (
    startIdx,
    pageSize,
    customLogType = null,
    silent = false,
  ) => {
    if (!canLoadLogs) {
      setLogs([]);
      setExpandData({});
      setLogCount(0);
      setActivePage(1);
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
    }

    let url = '';
    const {
      username,
      token_name,
      model_name,
      start_timestamp,
      end_timestamp,
      channel,
      group,
      request_id,
      logType: formLogType,
    } = getFormValues();

    const currentLogType =
      customLogType !== null
        ? customLogType
        : formLogType !== undefined
          ? formLogType
          : logType;

    let localStartTimestamp = Date.parse(start_timestamp) / 1000;
    let localEndTimestamp = Date.parse(end_timestamp) / 1000;
    if (isAdminUser) {
      url = `/api/log/?${buildLogQueryString({
        p: startIdx,
        page_size: pageSize,
        type: currentLogType,
        username,
        token_name,
        model_name: Array.isArray(model_name) ? '' : model_name,
        model_names: Array.isArray(model_name) ? model_name : [],
        image_only: imageOnly ? 'true' : '',
        exclude_image_models: imageOnly ? '' : 'true',
        start_timestamp: localStartTimestamp,
        end_timestamp: localEndTimestamp,
        channel,
        group,
        request_id,
      })}`;
    } else {
      url = `/api/log/self/?${buildLogQueryString({
        p: startIdx,
        page_size: pageSize,
        type: currentLogType,
        token_name,
        model_name: Array.isArray(model_name) ? '' : model_name,
        model_names: Array.isArray(model_name) ? model_name : [],
        image_only: imageOnly ? 'true' : '',
        exclude_image_models: imageOnly ? '' : 'true',
        start_timestamp: localStartTimestamp,
        end_timestamp: localEndTimestamp,
        group,
        request_id,
      })}`;
    }
    // 静默模式走 skipErrorHandler：请求失败时不让 axios 拦截器弹全局 toast，
    // 否则每 5 秒失败一次就会弹一次。
    const res = await API.get(url, { skipErrorHandler: silent });
    const { success, message, data } = res.data;
    if (success) {
      const newPageData = data.items;
      setActivePage(data.page);
      // 不要把后端回传的 page_size 写回 state：它只是回显请求参数，
      // 缺失时还会回落成默认值，会把用户选的每页条数打回默认。
      setLogCount(data.total);

      setLogsFormat(newPageData);
    } else if (!silent) {
      showError(message);
    }
    if (!silent) {
      setLoading(false);
    }
  };

  // Page handlers
  const handlePageChange = (page) => {
    setActivePage(page);
    loadLogs(page, pageSize).then((r) => {});
  };

  const handlePageSizeChange = async (size) => {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, size + '');
    setPageSize(size);
    setActivePage(1);
    // 必须回到第 1 页：沿用当前页码会让 startIdx 超出新页大小，
    // 例如第 5 页 / 每页 100 条切成每页 10 条时会直接翻到空页。
    loadLogs(1, size)
      .then()
      .catch((reason) => {
        showError(reason);
      });
  };

  // Refresh function
  const refresh = async () => {
    setActivePage(1);
    handleEyeClick();
    await loadLogs(1, pageSize);
  };

  // 自动刷新专用：保持当前页码与筛选条件，静默拉数据。
  // 不能复用 refresh()——它会把页码重置到第 1 页，用户翻到第 3 页就被弹回来了。
  // 统计区（handleEyeClick）不在自动刷新范围内：那是额度/令牌汇总，
  // 每 5 秒重拉一次统计接口纯属浪费。
  //
  // loadLogs 每次渲染都会重建（它闭包了 canLoadLogs / formApi 等 state），
  // 直接把它塞进 useCallback 的依赖会让回调每次渲染都变，定时器被反复重建、
  // 等于永远等不到下一次触发。所以用 ref 持有最新的 loadLogs，
  // 回调本身只依赖真正需要的 activePage / pageSize。
  const loadLogsRef = useRef(loadLogs);
  loadLogsRef.current = loadLogs;

  const refreshSilently = useCallback(async () => {
    await loadLogsRef.current(activePage, pageSize, null, true);
  }, [activePage, pageSize]);

  const autoRefresh = useAutoRefreshSetting();
  useAutoRefresh({
    // canLoadLogs 为 false 时页面本来就没数据可拉（比如生图页还没配生成模型），
    // 这时轮询只会反复清空列表并把页码重置成 1，没有意义。
    enabled: autoRefresh.enabled && canLoadLogs,
    intervalMs: autoRefresh.intervalMs,
    onRefresh: refreshSilently,
  });

  // Copy text function
  const copyText = async (e, text) => {
    e.stopPropagation();
    if (await copy(text)) {
      showSuccess('已复制：' + text);
    } else {
      Modal.error({ title: t('无法复制到剪贴板，请手动复制'), content: text });
    }
  };

  // Initialize data
  useEffect(() => {
    if (!canLoadLogs) return;
    const localPageSize = readPersistedPageSize();
    setPageSize(localPageSize);
    loadLogs(activePage, localPageSize)
      .then()
      .catch((reason) => {
        showError(reason);
      });
  }, [canLoadLogs]);

  useEffect(() => {
    if (!canLoadLogs || !imageOnly || !formApi) return;
    // 不再把全部生成模型回填到输入框：留空即表示不筛选，
    // 后端凭 image_only 已限定只看生成类模型
    setLogType(2);
    // 必须重新读持久化的每页条数，不能用闭包里的 pageSize：
    // 这个 effect 与上面的挂载 effect 在同一次渲染里触发，此时
    // setPageSize 还没生效，闭包读到的是初始值 10。两条请求先后返回，
    // 后到的那条（page_size=10）会覆盖正确结果——表现就是右下角显示
    // 100 条、表格里却只有 10 条，刷新页面反复复现。
    const localPageSize = readPersistedPageSize();
    setTimeout(() => {
      loadLogs(1, localPageSize, 2).catch((reason) => {
        showError(reason);
      });
    }, 0);
  }, [canLoadLogs, imageOnly, formApi, imageModelOptionsKey]);

  // Initialize statistics when formApi is available
  useEffect(() => {
    if (formApi && canLoadLogs) {
      handleEyeClick();
    }
  }, [formApi, canLoadLogs]);

  // Check if any record has expandable content
  const hasExpandableRows = () => {
    return logs.some(
      (log) => expandData[log.key] && expandData[log.key].length > 0,
    );
  };

  return {
    // Basic state
    logs,
    expandData,
    showStat,
    loading,
    loadingStat,
    activePage,
    logCount,
    pageSize,
    logType,
    stat,
    isAdminUser,
    groupOptions,

    // Form state
    formApi,
    setFormApi,
    formInitValues,
    imageOnly,
    imageModelOptions,
    enabled,
    getFormValues,

    // Column visibility
    visibleColumns,
    showColumnSelector,
    setShowColumnSelector,
    billingDisplayMode,
    setBillingDisplayMode,
    handleColumnVisibilityChange,
    handleSelectAll,
    initDefaultColumns,
    COLUMN_KEYS,

    // Compact mode
    compactMode,
    setCompactMode,

    // User info modal
    showUserInfo,
    setShowUserInfoModal,
    userInfoData,
    showUserInfoFunc,

    // Channel affinity usage cache stats modal
    showChannelAffinityUsageCacheModal,
    setShowChannelAffinityUsageCacheModal,
    channelAffinityUsageCacheTarget,
    openChannelAffinityUsageCacheModal,
    showParamOverrideModal,
    setShowParamOverrideModal,
    paramOverrideTarget,
    showRequestPayloadModal,
    setShowRequestPayloadModal,
    requestPayloadTarget,

    // Functions
    loadLogs,
    handlePageChange,
    handlePageSizeChange,
    refresh,
    copyText,
    handleEyeClick,
    setLogsFormat,
    hasExpandableRows,
    setLogType,
    openParamOverrideModal,
    openRequestPayloadModal,

    // Translation
    t,
  };
};
