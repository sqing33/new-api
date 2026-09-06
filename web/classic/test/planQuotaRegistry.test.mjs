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

// Deterministic tests for the plan-quota sort registry: the remaining
// metric derivation from window items, record/get semantics and the
// subscribe/notify contract the table uses to re-sort. Run with:
// node --test test/planQuotaRegistry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __clearPlanQuotaRegistryForTests,
  getChannelSortValue,
  getPlanQuotaRegistryVersion,
  planQuotaSortValueFromWindows,
  recordChannelSortValue,
  subscribePlanQuotaRegistry,
} from '../src/hooks/channels/planQuotaRegistry.js';

test.beforeEach(() => {
  __clearPlanQuotaRegistryForTests();
});

const versionAtTestStart = () => {
  __clearPlanQuotaRegistryForTests();
  return getPlanQuotaRegistryVersion();
};

test('planQuotaSortValueFromWindows prefers the five_hour absolute remaining', () => {
  const value = planQuotaSortValueFromWindows([
    { name: 'weekly_limit', remaining: 5 },
    { name: 'five_hour', remaining: 12.5, percent: 80 },
  ]);
  assert.equal(value, 12.5);
});

test('planQuotaSortValueFromWindows falls back to the five_hour percent scale', () => {
  const value = planQuotaSortValueFromWindows([
    { name: 'five_hour', percent: 62 },
  ]);
  assert.equal(value, 38, '100 - usedPercent');
  assert.equal(
    planQuotaSortValueFromWindows([{ name: 'five_hour', percent: 150 }]),
    0,
    'percent scale is clamped to 0-100',
  );
});

test('planQuotaSortValueFromWindows falls back to the first window item', () => {
  assert.equal(
    planQuotaSortValueFromWindows([{ name: 'monthly', remaining: 7 }]),
    7,
    'no five_hour window: first item wins',
  );
  assert.equal(
    planQuotaSortValueFromWindows([{ name: 'monthly', percent: 25 }]),
    75,
  );
});

test('planQuotaSortValueFromWindows returns null for unknown usage', () => {
  assert.equal(planQuotaSortValueFromWindows([]), null);
  assert.equal(planQuotaSortValueFromWindows(undefined), null);
  assert.equal(planQuotaSortValueFromWindows([{ name: 'daily' }]), null);
  assert.equal(
    planQuotaSortValueFromWindows([{ name: 'daily', percent: 'x' }]),
    null,
  );
});

test('recordChannelSortValue stores finite values and drops unknown ones', () => {
  const start = versionAtTestStart();
  recordChannelSortValue(1, 42);
  assert.equal(getChannelSortValue(1), 42);
  assert.equal(getPlanQuotaRegistryVersion(), start + 1);

  recordChannelSortValue(1, 10);
  assert.equal(getChannelSortValue(1), 10, 'latest report wins');
  assert.equal(getPlanQuotaRegistryVersion(), start + 2);

  recordChannelSortValue(2, null);
  assert.equal(getChannelSortValue(2), null, 'null reports nothing');

  recordChannelSortValue(1, null);
  assert.equal(getChannelSortValue(1), null, 'null clears the value');
  assert.equal(
    getPlanQuotaRegistryVersion(),
    start + 3,
    'clearing an unknown id does not bump',
  );

  recordChannelSortValue(1, Number.NaN);
  assert.equal(getChannelSortValue(1), null, 'non-finite never recorded');
});

test('recordChannelSortValue ignores unknown channel ids', () => {
  const start = versionAtTestStart();
  recordChannelSortValue(null, 42);
  recordChannelSortValue(undefined, 42);
  assert.equal(getChannelSortValue(null), null);
  assert.equal(getPlanQuotaRegistryVersion(), start, 'no notification fired');
});

test('registry notifies subscribers and version bumps on every change', () => {
  const start = versionAtTestStart();
  let notified = 0;
  const unsubscribe = subscribePlanQuotaRegistry(() => {
    notified += 1;
  });

  recordChannelSortValue(7, 3);
  assert.equal(notified, 1);
  assert.equal(getPlanQuotaRegistryVersion(), start + 1);

  unsubscribe();
  recordChannelSortValue(7, 4);
  assert.equal(notified, 1, 'unsubscribed listeners are not notified');
  assert.equal(getChannelSortValue(7), 4);
});
