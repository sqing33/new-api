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

const hasImageCapability = (model, imageModelSettingsMap) => {
  const setting = imageModelSettingsMap?.[model?.model_name];
  return Array.isArray(setting?.modes) && setting.modes.length > 0;
};

const PricingCapabilities = ({
  filterCapability,
  setFilterCapability,
  models = [],
  imageModelSettingsMap = {},
  loading = false,
  t,
}) => {
  const getCapabilityCount = (capability) => {
    if (capability === 'all') return models.length;

    return models.filter((model) => {
      const isImageModel = hasImageCapability(model, imageModelSettingsMap);
      return capability === 'image' ? isImageModel : !isImageModel;
    }).length;
  };

  const items = [
    {
      value: 'all',
      label: t('全部能力'),
      tagCount: getCapabilityCount('all'),
    },
    {
      value: 'image',
      label: t('生图'),
      tagCount: getCapabilityCount('image'),
    },
    {
      value: 'chat',
      label: t('对话'),
      tagCount: getCapabilityCount('chat'),
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
