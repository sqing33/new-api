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

import React, { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';

const RELEASES_API_URL =
  'https://api.github.com/repos/QuantumNous/new-api/releases?per_page=100';
const IGNORED_VERSION_KEY = 'system-update-ignored-version';

// 解析 "v1.2.3" / "1.2.3" 形式的版本号，返回可比较的数字数组
const parseSystemVersion = (version) => {
  if (!version) return null;
  const match = String(version).match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareSystemVersions = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
};

const selectLatestRelease = (releases, currentVersion) => {
  const current = parseSystemVersion(currentVersion);
  if (!current) return null;
  const candidates = (releases || [])
    .filter((release) => !release.draft)
    .map((release) => ({
      tagName: release.tag_name,
      name: release.name || release.tag_name,
      url: release.html_url,
      version: parseSystemVersion(release.tag_name),
    }))
    .filter((release) => release.version !== null);
  let latest = null;
  for (const release of candidates) {
    if (
      !latest ||
      compareSystemVersions(release.version, latest.version) > 0
    ) {
      latest = release;
    }
  }
  if (!latest || compareSystemVersions(latest.version, current) <= 0) {
    return null;
  }
  return latest;
};

const UpdateNoticeBanner = ({ isAdminUser, currentVersion, t }) => {
  const [loading, setLoading] = useState(false);
  const [release, setRelease] = useState(null);
  const [ignored, setIgnored] = useState(() => {
    try {
      return localStorage.getItem(IGNORED_VERSION_KEY) || '';
    } catch (e) {
      return '';
    }
  });
  const [tick, setTick] = useState(0);

  const checkNow = useCallback(() => {
    if (!isAdminUser || loading) return;
    setLoading(true);
    fetch(RELEASES_API_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((releases) => {
        setRelease(selectLatestRelease(releases, currentVersion));
      })
      .catch(() => setRelease(null))
      .finally(() => setLoading(false));
  }, [isAdminUser, currentVersion, loading]);

  useEffect(() => {
    if (!isAdminUser) return;
    // 每小时自动检查一次；tick 由手动刷新触发
    checkNow();
    const timer = setInterval(checkNow, 60 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminUser, currentVersion, tick]);

  const handleIgnore = () => {
    try {
      localStorage.setItem(IGNORED_VERSION_KEY, release?.tagName || '');
    } catch (e) {
      // localStorage 不可用时忽略
    }
    setIgnored(release?.tagName || '');
  };

  if (!isAdminUser) return null;
  if (loading && !release) {
    return null;
  }
  if (!release || (ignored && ignored === release.tagName)) return null;

  return (
    <Banner
      type='info'
      closeIcon={null}
      className='!mb-4'
      description={
        <Space>
          <span>
            {t('发现新版本')}{' '}
            <Typography.Text strong>{release.tagName}</Typography.Text>
            {t('（当前版本 {{version}}）', { version: currentVersion })}
          </span>
          <Button
            size='small'
            theme='solid'
            onClick={() => window.open(release.url, '_blank')}
          >
            {t('查看更新')}
          </Button>
          <Button size='small' onClick={handleIgnore}>
            {t('忽略此版本')}
          </Button>
          <Button
            size='small'
            icon={loading ? <Spin size='small' /> : <IconRefresh />}
            onClick={() => setTick((v) => v + 1)}
          >
            {t('检查更新')}
          </Button>
        </Space>
      }
    />
  );
};

export default UpdateNoticeBanner;
