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

import React, { useContext, useMemo } from 'react';
import UsageLogsTable from '../../components/table/usage-logs';
import { StatusContext } from '../../context/Status';
import { parseImageModelSettings } from '../../helpers/imageModelSettings';

const ImageLogs = () => {
  const [statusState] = useContext(StatusContext);
  const statusLoaded = statusState?.status !== undefined;
  const imageModelOptions = useMemo(
    () =>
      statusLoaded
        ? [
            ...new Set(
              parseImageModelSettings(statusState?.status?.image_model_settings)
                .filter(
                  (setting) =>
                    Array.isArray(setting.modes) && setting.modes.length > 0,
                )
                .map((setting) => setting.model),
            ),
          ]
        : [],
    [statusLoaded, statusState?.status?.image_model_settings],
  );

  return (
    <div className='mt-[60px] px-2'>
      <UsageLogsTable
        imageOnly
        imageModelOptions={imageModelOptions}
        enabled={statusLoaded && imageModelOptions.length > 0}
      />
    </div>
  );
};

export default ImageLogs;
