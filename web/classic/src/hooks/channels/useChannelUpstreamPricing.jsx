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

import { useRef, useState } from 'react';
import { API, showError, showInfo, showSuccess } from '../../helpers';

export const useChannelUpstreamPricing = ({ t, refresh }) => {
  const [detectAllUpstreamPricingLoading, setDetectAllUpstreamPricingLoading] =
    useState(false);

  const detectChannelUpstreamPricingInFlightRef = useRef(false);
  const detectAllUpstreamPricingInFlightRef = useRef(false);

  const detectChannelUpstreamPricing = async (channel) => {
    if (detectChannelUpstreamPricingInFlightRef.current) {
      showInfo(t('正在检测，请稍候'));
      return;
    }
    if (!channel?.id) {
      return;
    }
    detectChannelUpstreamPricingInFlightRef.current = true;
    try {
      const res = await API.post(
        '/api/channel/upstream_pricing/detect',
        {
          id: channel.id,
        },
        { skipErrorHandler: true },
      );
      const { success, message, data } = res.data || {};
      if (!success) {
        showError(message || t('检测失败'));
        return;
      }

      const changes = data?.changes || [];
      if (changes.length === 0) {
        showSuccess(
          t('{{name}} 未检测到上游定价变动', {
            name: data?.channel_name || channel.name,
          }),
        );
      } else {
        const preview = changes
          .slice(0, 3)
          .map(
            (c) =>
              `${c.model_name} ${c.field}: ${c.old_value} → ${c.new_value}`,
          )
          .join('; ');
        const suffix = changes.length > 3 ? '...' : '';
        showSuccess(
          t('{{name}} 检测到 {{count}} 项上游定价变动', {
            name: data?.channel_name || channel.name,
            count: changes.length,
          }) +
            ': ' +
            preview +
            suffix,
        );
      }
    } catch (error) {
      showError(
        error?.response?.data?.message || error?.message || t('检测失败'),
      );
    } finally {
      detectChannelUpstreamPricingInFlightRef.current = false;
    }
  };

  const detectAllUpstreamPricing = async () => {
    if (detectAllUpstreamPricingInFlightRef.current) {
      showInfo(t('正在批量检测，请稍候'));
      return;
    }
    detectAllUpstreamPricingInFlightRef.current = true;
    setDetectAllUpstreamPricingLoading(true);
    try {
      const res = await API.post(
        '/api/channel/upstream_pricing/detect_all',
        {},
        { skipErrorHandler: true },
      );
      const { success, message, data } = res.data || {};
      if (!success) {
        showError(message || t('批量检测失败'));
        return;
      }

      const processed = data?.processed_channels || 0;
      const up = data?.total_increases || 0;
      const down = data?.total_decreases || 0;
      const failed = (data?.failed_channel_ids || []).length;
      showSuccess(
        t(
          '上游定价检测完成: 处理渠道 {{processed}}, 涨价 {{up}}, 降价 {{down}}, 失败 {{failed}}',
          { processed, up, down, failed },
        ),
      );
    } catch (error) {
      showError(
        error?.response?.data?.message || error?.message || t('批量检测失败'),
      );
    } finally {
      detectAllUpstreamPricingInFlightRef.current = false;
      setDetectAllUpstreamPricingLoading(false);
    }
  };

  return {
    detectChannelUpstreamPricing,
    detectAllUpstreamPricing,
    detectAllUpstreamPricingLoading,
  };
};
