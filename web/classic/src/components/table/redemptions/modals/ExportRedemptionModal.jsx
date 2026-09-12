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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Modal, Radio, RadioGroup, Space } from '@douyinfe/semi-ui';
import { downloadTextAsFile } from '../../../../helpers';

const sanitizeCell = (value) => String(value).replaceAll(/[\t\r\n]+/g, ' ');

const buildContent = ({ keys, name, quota, format, includeName, includeQuota, t }) => {
  const headers = [];
  if (includeName) headers.push(t('名称'));
  headers.push(t('兑换码'));
  if (includeQuota) headers.push(t('额度'));

  const rows = keys.map((key) => {
    const row = [];
    if (includeName) row.push(sanitizeCell(name));
    row.push(sanitizeCell(key));
    if (includeQuota) row.push(sanitizeCell(quota));
    return row;
  });

  if (format === 'md') {
    const markdownRows = [headers, headers.map(() => '---'), ...rows];
    const lines = markdownRows.map((row, index) => {
      const cells =
        index === 1
          ? row
          : row.map((value) =>
              String(value)
                .replaceAll('&', '&amp;')
                .replaceAll(/[\\`*_[\]|<>]/g, '\\$&'),
            );
      return `| ${cells.join(' | ')} |`;
    });
    return `${lines.join('\n')}\n`;
  }
  return `${rows.map((row) => row.join('\t')).join('\n')}\n`;
};

const ExportRedemptionModal = ({ visible, data, onClose, t: tProp }) => {
  const { t } = useTranslation();
  const translate = tProp || t;
  const [saveToFile, setSaveToFile] = useState(false);
  const [format, setFormat] = useState('txt');
  const [includeName, setIncludeName] = useState(true);
  const [includeQuota, setIncludeQuota] = useState(true);

  if (!data) return null;

  const handleComplete = () => {
    if (!saveToFile) {
      onClose();
      return;
    }
    const content = buildContent({
      keys: data.keys,
      name: data.name,
      quota: data.quota,
      format,
      includeName,
      includeQuota,
      t: translate,
    });
    downloadTextAsFile(content, `${data.name}.${format}`);
    onClose();
  };

  return (
    <Modal
      title={translate('兑换码创建成功')}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{translate('完成')}</Button>
          <Button theme='solid' onClick={handleComplete}>
            {saveToFile ? translate('保存并完成') : translate('完成')}
          </Button>
        </Space>
      }
    >
      <div className='flex flex-col gap-3 py-2'>
        <p>{translate('兑换码创建成功，可保存为文件。')}</p>
        <Checkbox checked={saveToFile} onChange={(e) => setSaveToFile(e.target.checked)}>
          {translate('保存为文件')}
        </Checkbox>
        {saveToFile && (
          <div className='flex flex-col gap-2 pl-6'>
            <RadioGroup value={format} onChange={(e) => setFormat(e.target.value)} type='button'>
              <Radio value='txt'>TXT</Radio>
              <Radio value='md'>Markdown</Radio>
            </RadioGroup>
            <Checkbox checked={includeName} onChange={(e) => setIncludeName(e.target.checked)}>
              {translate('包含名称')}
            </Checkbox>
            <Checkbox checked={includeQuota} onChange={(e) => setIncludeQuota(e.target.checked)}>
              {translate('包含额度')}
            </Checkbox>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ExportRedemptionModal;
