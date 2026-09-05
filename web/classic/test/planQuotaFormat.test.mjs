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

// Deterministic tests for the Plan-quota display helpers. These pin the
// percentage semantics contract: `percent` is the only used-percentage
// source; `used`/`remaining` are absolute unit-qualified amounts that are
// displayed as-is and never converted into percentages.
// Run with: node --test test/planQuotaFormat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPercent,
  formatAmount,
  formatResetTime,
  resolveWindowUsedPercent,
  windowTooltipLines,
} from '../src/hooks/channels/planQuotaFormat.js';

const t = (key) => key;

test('resolveWindowUsedPercent uses only percent, never remaining', () => {
  assert.equal(resolveWindowUsedPercent({ percent: 42.5 }), 42.5);
  assert.equal(
    resolveWindowUsedPercent({ percent: 0 }),
    0,
    'explicit 0 is kept',
  );
  assert.equal(resolveWindowUsedPercent({ percent: 150 }), 100, 'clamped high');
  assert.equal(resolveWindowUsedPercent({ percent: -5 }), 0, 'clamped low');
  // Remaining is an absolute amount: 50 (usd/quota/anything) must NOT become
  // a 50% or 100-50% bar.
  assert.equal(resolveWindowUsedPercent({ remaining: 50 }), null);
  assert.equal(
    resolveWindowUsedPercent({ remaining: 50, unit: 'usd' }),
    null,
    'unit-qualified remaining is not a percentage',
  );
  assert.equal(resolveWindowUsedPercent({}), null);
  assert.equal(resolveWindowUsedPercent(null), null);
  assert.equal(resolveWindowUsedPercent({ percent: 'abc' }), null);
  assert.equal(resolveWindowUsedPercent({ percent: null }), null);
});

test('formatAmount handles null, invalid and sized numbers', () => {
  assert.equal(formatAmount(null), '-');
  assert.equal(formatAmount(undefined), '-');
  assert.equal(formatAmount(Number.NaN), '-');
  assert.equal(formatAmount('not-a-number'), '-');
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(1234567), '1,234,567');
});

test('formatResetTime returns null for null/invalid dates', () => {
  assert.equal(formatResetTime(null), null);
  assert.equal(formatResetTime(undefined), null);
  assert.equal(formatResetTime(''), null);
  assert.equal(formatResetTime('not-a-date'), null);
  const parsed = formatResetTime('2026-01-01T00:00:00Z');
  assert.ok(typeof parsed === 'string' && parsed.length > 0);
});

test('clampPercent bounds non-finite and out-of-range values', () => {
  assert.equal(clampPercent('bad'), 0);
  assert.equal(clampPercent(null), 0);
  assert.equal(clampPercent(101), 100);
  assert.equal(clampPercent(73), 73);
});

test('tooltip lines: percent-only window shows derived remaining percent', () => {
  const lines = windowTooltipLines({ name: 'five_hour', percent: 30 }, t);
  assert.deepEqual(lines, ['Remaining: 70%']);
});

test('tooltip lines: absolute amounts stay absolute, no fabricated percent', () => {
  // The coordinator-reported case: remaining=50 with unit usd and no percent.
  const lines = windowTooltipLines(
    { name: 'weekly_limit', remaining: 50, unit: 'usd' },
    t,
  );
  assert.deepEqual(
    lines,
    ['Remaining: 50 usd', 'Unit: usd'],
    'no "50%" or "Remaining: 50%" is invented',
  );
  assert.ok(!lines.some((line) => line.includes('%')));
});

test('tooltip lines: full window with used, remaining, percent, reset and unit', () => {
  const lines = windowTooltipLines(
    {
      name: 'five_hour',
      used: 3,
      remaining: 7,
      percent: 30,
      reset: '2026-01-01T00:00:00Z',
      unit: 'quota',
    },
    t,
  );
  assert.equal(lines[0], 'Used: 3 quota');
  assert.equal(lines[1], 'Remaining: 70%');
  assert.equal(lines[2], 'Remaining: 7 quota');
  assert.ok(lines[3].startsWith('Resets at: '));
  assert.equal(lines[4], 'Unit: quota');
});

test('tooltip lines: empty item renders no lines', () => {
  assert.deepEqual(windowTooltipLines(null, t), []);
  assert.deepEqual(windowTooltipLines({}, t), []);
});
