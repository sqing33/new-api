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

import {
  Banner,
  Button,
  Input,
  Modal,
  Space,
} from '@douyinfe/semi-ui';
import { FileCode2, FolderOpen } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_PLUGIN_SOURCE_BYTES,
  fetchPluginSourceText,
  normalizePluginSourceUrl,
  pluginSourceByteLength,
  PluginSourceFetchError,
} from './lib/pluginUrl';

const UploadDialog = ({
  visible,
  initialKey,
  onUpload,
  onClose,
}) => {
  const { t } = useTranslation();
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [remark, setRemark] = useState('');
  const [result, setResult] = useState(null);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const reset = () => {
    setSource('');
    setFileName('');
    setRemark('');
    setResult(null);
    setImportUrl('');
    setImportError('');
    setError('');
  };

  const close = () => {
    onClose();
    reset();
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_PLUGIN_SOURCE_BYTES) {
      setImportError(t('插件源码超过 1 MiB 上限。'));
      return;
    }
    setImportError('');
    setFileName(file.name);
    setSource(await file.text());
    setResult(null);
    setError('');
  };

  const handleFetch = async () => {
    const normalized = normalizePluginSourceUrl(importUrl);
    if (!normalized) {
      setImportError(t('请输入绝对 http(s) URL。'));
      return;
    }
    setImporting(true);
    try {
      const text = await fetchPluginSourceText(normalized);
      setImportError('');
      setFileName('');
      setSource(text);
      setResult(null);
      setError('');
    } catch (err) {
      if (err instanceof PluginSourceFetchError) {
        if (err.reason === 'too_large') {
          setImportError(t('插件源码超过 1 MiB 上限。'));
        } else if (err.reason === 'not_found') {
          setImportError(
            t('URL 返回了 HTTP {{status}}，请检查地址，或下载文件后将源码粘贴到下方。', {
              status: err.status ?? 0,
            }),
          );
        } else {
          setImportError(
            t('浏览器无法抓取该 URL，托管站点可能屏蔽跨域请求或不可达。请下载文件后将源码粘贴到下方。'),
          );
        }
        return;
      }
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async () => {
    setUploading(true);
    setError('');
    try {
      const resultMeta = await onUpload({ source, remark });
      if (resultMeta?.success) {
        setResult(resultMeta.meta);
      } else {
        setError(resultMeta?.message || t('上传失败'));
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={
        initialKey
          ? t('上传新的插件版本')
          : t('上传任务插件')
      }
      visible={visible}
      onOk={handleSubmit}
      onCancel={close}
      onMaskClick={close}
      width={720}
      okButtonProps={{
        loading: uploading,
        disabled: !source.trim(),
        children: uploading ? t('上传中...') : t('上传'),
      }}
      cancelButtonProps={{ children: t('关闭') }}
    >
      <div className='space-y-4'>
        <Banner
          type='danger'
          title={t('第三方插件风险')}
          description={t('上传插件属于管理员级别的信任决策。插件可以访问渠道凭据并构造上游请求。启用前请审查其源码与差异。')}
        />
        {initialKey && (
          <p className='text-sm'>
            {t('插件 key')}: <span className='font-mono'>{initialKey}</span>
          </p>
        )}

        <div
          className='flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center'
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            handleFile(event.dataTransfer.files?.[0]);
          }}
        >
          {fileName ? (
            <FileCode2 size={20} className='text-gray-400' />
          ) : (
            <FolderOpen size={20} className='text-gray-400' />
          )}
          <div className='space-y-0.5'>
            <p className='text-sm font-medium'>
              {fileName || t('将 JavaScript 插件文件拖拽到此处')}
            </p>
            <p className='text-xs text-gray-400'>
              {t('单个 .js 文件，最大 1 MiB。上传前源码将显示在下方供审查。')}
            </p>
          </div>
          <Button
            size='small'
            type='tertiary'
            icon={<FolderOpen size={14} />}
            onClick={() => fileInputRef.current?.click()}
          >
            {fileName ? t('重新选择文件') : t('选择文件')}
          </Button>
          <input
            ref={fileInputRef}
            type='file'
            accept='.js,text/javascript'
            className='hidden'
            onChange={(event) => {
              handleFile(event.target.files?.[0]);
              // 允许报错后重新选择同一文件
              event.target.value = '';
            }}
          />
        </div>

        <div className='space-y-1'>
          <label className='block text-xs text-gray-400'>
            {t('从 URL 导入')}
          </label>
          <Space align='center'>
            <Input
              className='max-w-md'
              type='url'
              value={importUrl}
              placeholder='https://github.com/owner/repo/blob/main/plugin.js'
              onChange={(value) => {
                setImportUrl(value);
                setImportError('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (importUrl.trim()) handleFetch();
              }}
            />
            <Button
              type='tertiary'
              loading={importing}
              disabled={!importUrl.trim()}
              onClick={handleFetch}
            >
              {importing ? t('抓取中...') : t('抓取')}
            </Button>
          </Space>
          <p className='text-xs text-gray-400'>
            {t('在浏览器中抓取并填入下方源码字段供审查。GitHub 与 gist 页面 URL 会自动重写为 raw URL。')}
          </p>
          {importError && (
            <p className='text-xs text-red-500'>{importError}</p>
          )}
        </div>

        <div className='space-y-1'>
          <div className='flex items-center justify-between'>
            <label className='block text-xs text-gray-400'>
              {t('插件源码')}
            </label>
            <span className='font-mono text-[11px] text-gray-400'>
              {t('{{bytes}} 字节', { bytes: pluginSourceByteLength(source) })}
            </span>
          </div>
          <Input.TextArea
            value={source}
            rows={14}
            placeholder={t('在此粘贴 JavaScript 源码...')}
            className='font-mono text-xs'
            onChange={(value) => {
              setSource(value);
              setResult(null);
            }}
          />
        </div>

        <div className='space-y-1'>
          <label className='block text-xs text-gray-400'>
            {t('备注')}
          </label>
          <Input
            value={remark}
            placeholder={t('描述此版本的可选备注')}
            onChange={setRemark}
          />
        </div>

        {error && (
          <Banner
            type='danger'
            title={t('网关拒绝了该插件')}
            description={<span className='whitespace-pre-wrap'>{error}</span>}
          />
        )}

        {result && (
          <Banner
            type='success'
            title={t('已解析的插件元数据')}
            description={
              <span className='font-mono'>
                {result.key} · {result.name} · v{result.version} · API v
                {result.apiVersion}
              </span>
            }
          />
        )}
      </div>
    </Modal>
  );
};

export default UploadDialog;
