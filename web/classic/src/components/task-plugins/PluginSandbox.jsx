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

import { Button, Input, Select } from '@douyinfe/semi-ui';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const HOOKS = [
  'resolveRequest',
  'buildSubmitRequest',
  'parseSubmitResponse',
  'extractUsage',
  'extractUsageOnSubmit',
  'extractUsageOnComplete',
  'buildQueryRequest',
  'parseTaskResult',
  'buildBatchQueryRequest',
  'parseBatchResult',
  'buildContentRequest',
  'renderers.openai_video',
];

const PluginSandbox = ({ pluginKey, onDryRun }) => {
  const { t } = useTranslation();
  const [hook, setHook] = useState('buildSubmitRequest');
  const [args, setArgs] = useState('[{}]');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);

  const runDryRun = async () => {
    let parsed;
    try {
      parsed = JSON.parse(args);
    } catch (_) {
      setOutput(JSON.stringify({ error: t('参数必须是 JSON 数组') }, null, 2));
      return;
    }
    if (!Array.isArray(parsed)) {
      setOutput(JSON.stringify({ error: t('参数必须是 JSON 数组') }, null, 2));
      return;
    }
    const memberSeparator = hook.indexOf('.');
    const run = {
      hook: memberSeparator < 0 ? hook : hook.slice(0, memberSeparator),
      args: parsed,
    };
    if (memberSeparator >= 0) {
      run.member = hook.slice(memberSeparator + 1);
    }
    setRunning(true);
    try {
      const res = await onDryRun(pluginKey, run.hook, run.member, parsed);
      const { success, message, data } = res.data;
      if (success) {
        setOutput(JSON.stringify(data ?? null, null, 2));
      } else {
        setOutput(JSON.stringify({ error: message }, null, 2));
      }
    } catch (error) {
      setOutput(
        JSON.stringify(
          { error: error?.response?.data?.message || error.message },
          null,
          2,
        ),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className='space-y-4'>
      <Select
        className='w-full'
        value={hook}
        onChange={setHook}
        optionList={HOOKS.map((item) => ({ label: item, value: item }))}
      />
      <div className='space-y-1'>
        <label className='block text-xs text-gray-400'>
          {t('参数 JSON')}
        </label>
        <Input.TextArea
          value={args}
          rows={12}
          onChange={setArgs}
          className='font-mono text-xs'
        />
      </div>
      <Button
        loading={running}
        onClick={runDryRun}
        icon={<Play size={14} />}
      >
        {running ? t('试运行中') : t('试运行')}
      </Button>
      {output && (
        <pre className='max-h-96 overflow-auto rounded-md border bg-black/[0.02] p-3 font-mono text-xs whitespace-pre-wrap dark:bg-black/20'>
          {output}
        </pre>
      )}
    </div>
  );
};

export default PluginSandbox;
