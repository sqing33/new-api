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

import { useState, useMemo, useRef, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';
import { StatusContext } from '../../context/Status';

// 模型管理中的定价抽屉：首次打开时懒加载 /api/pricing，按 model_name 查找定价信息
export const useModelPricingDrawer = () => {
  const { t } = useTranslation();
  const [statusState] = useContext(StatusContext);

  const [visible, setVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState(null);
  const requestRef = useRef(0);

  const siteDisplayType = statusState?.status?.quota_display_type || 'USD';
  const currency = useMemo(
    () =>
      siteDisplayType === 'USD' ||
      siteDisplayType === 'CNY' ||
      siteDisplayType === 'CUSTOM'
        ? siteDisplayType
        : 'USD',
    [siteDisplayType],
  );
  const priceRate = statusState?.status?.price ?? 1;
  const usdExchangeRate = statusState?.status?.usd_exchange_rate ?? priceRate;
  const customExchangeRate =
    statusState?.status?.custom_currency_exchange_rate ?? 1;
  const customCurrencySymbol =
    statusState?.status?.custom_currency_symbol ?? '¤';

  const displayPrice = (usdPrice) => {
    if (currency === 'CNY') {
      return `¥${(usdPrice * usdExchangeRate).toFixed(3)}`;
    }
    if (currency === 'CUSTOM') {
      return `${customCurrencySymbol}${(usdPrice * customExchangeRate).toFixed(3)}`;
    }
    return `$${usdPrice.toFixed(3)}`;
  };

  const loadPricing = async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const res = await API.get('/api/pricing');
      const {
        success,
        message,
        data,
        vendors,
        group_ratio,
        usable_group,
        supported_endpoint,
        auto_groups,
      } = res.data;
      if (request !== requestRef.current) return;
      if (!success) {
        showError(message);
        return;
      }
      const vendorsMap = {};
      (vendors || []).forEach((v) => {
        vendorsMap[v.id] = v;
      });
      const models = (data || []).map((m) => {
        const vendor = vendorsMap[m.vendor_id];
        return vendor
          ? {
              ...m,
              vendor_name: vendor.name,
              vendor_icon: vendor.icon,
              vendor_description: vendor.description,
            }
          : m;
      });
      setPricing({
        models,
        vendorsMap,
        groupRatio: group_ratio || {},
        usableGroup: usable_group || {},
        endpointMap: supported_endpoint || {},
        autoGroups: auto_groups || [],
      });
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
      }
    }
  };

  const openForModel = (record) => {
    setSelectedRecord(record);
    setVisible(true);
    if (!pricing && !loading) {
      loadPricing();
    }
  };

  const close = () => {
    setVisible(false);
  };

  const modelData = useMemo(() => {
    if (!pricing || !selectedRecord) return null;
    return (
      pricing.models.find((m) => m.model_name === selectedRecord.model_name) ||
      null
    );
  }, [pricing, selectedRecord]);

  const notFound =
    visible && Boolean(selectedRecord) && !loading && pricing && !modelData;

  return {
    visible,
    loading,
    notFound,
    modelData,
    openForModel,
    close,
    groupRatio: pricing?.groupRatio || {},
    usableGroup: pricing?.usableGroup || {},
    vendorsMap: pricing?.vendorsMap || {},
    endpointMap: pricing?.endpointMap || {},
    autoGroups: pricing?.autoGroups || [],
    currency,
    siteDisplayType,
    displayPrice,
    t,
  };
};
