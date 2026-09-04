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

import { getLobeHubIcon } from '../../helpers';
import { resolvePluginIcon, textAvatarClass } from './lib/pluginIcon';

const PluginIcon = ({ plugin, size = 20 }) => {
  const descriptor = resolvePluginIcon(plugin);
  if (descriptor.kind === 'lobe') {
    return getLobeHubIcon(descriptor.name, size);
  }
  return (
    <span
      aria-hidden='true'
      className={`inline-flex items-center justify-center rounded-md font-semibold select-none ${textAvatarClass(descriptor.colorSeed)}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.floor(size * 0.42)),
      }}
    >
      {descriptor.label}
    </span>
  );
};

export default PluginIcon;
