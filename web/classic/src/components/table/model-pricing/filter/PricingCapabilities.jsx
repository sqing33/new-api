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
import SelectableButtonGroup from '../../../common/ui/SelectableButtonGroup';
import {
  modelMatchesCapability,
  PRICING_CAPABILITY_ALL,
  PRICING_CAPABILITY_ASR,
  PRICING_CAPABILITY_CHAT,
  PRICING_CAPABILITY_IMAGE,
  PRICING_CAPABILITY_TTS,
} from './pricingCapability';

const PricingCapabilities = ({
  filterCapability,
  setFilterCapability,
  models = [],
  imageModelSettingsMap = {},
  loading = false,
  t,
}) => {
  const getCapabilityCount = (capability) =>
    models.filter((model) =>
      modelMatchesCapability(model, capability, imageModelSettingsMap),
    ).length;

  const items = [
    {
      value: PRICING_CAPABILITY_ALL,
      label: t('全部能力'),
      tagCount: getCapabilityCount(PRICING_CAPABILITY_ALL),
    },
    {
      value: PRICING_CAPABILITY_IMAGE,
      label: t('生图'),
      tagCount: getCapabilityCount(PRICING_CAPABILITY_IMAGE),
    },
    {
      value: PRICING_CAPABILITY_CHAT,
      label: t('对话'),
      tagCount: getCapabilityCount(PRICING_CAPABILITY_CHAT),
    },
    {
      value: PRICING_CAPABILITY_TTS,
      label: t('TTS'),
      tagCount: getCapabilityCount(PRICING_CAPABILITY_TTS),
    },
    {
      value: PRICING_CAPABILITY_ASR,
      label: t('ASR'),
      tagCount: getCapabilityCount(PRICING_CAPABILITY_ASR),
    },
  ];

  return (
    <SelectableButtonGroup
      title={t('能力')}
      items={items}
      activeValue={filterCapability}
      onChange={setFilterCapability}
      loading={loading}
      variant='teal'
      t={t}
    />
  );
};

export default PricingCapabilities;
