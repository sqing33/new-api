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
  aggregateKeyWindows,
  aggregateTooltipKeyLines,
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

// ---------------------------------------------------------------------------
// aggregateKeyWindows: multi-key sum semantics
// ---------------------------------------------------------------------------

const okKey = (keyIndex, items) => ({
  key_index: keyIndex,
  status: 'ok',
  items,
});
const failingKey = (keyIndex, status) => ({
  key_index: keyIndex,
  status,
  items: [],
});

test('aggregateKeyWindows sums used/remaining across keys per window', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [
      {
        name: 'five_hour',
        used: 10,
        remaining: 30,
        unit: 'usd',
        reset: '2026-09-10T00:00:00Z',
      },
      { name: 'weekly_limit', used: 5, remaining: 15, unit: 'usd' },
    ]),
    okKey(1, [
      {
        name: 'five_hour',
        used: 20,
        remaining: 40,
        unit: 'usd',
        reset: '2026-09-09T00:00:00Z',
      },
    ]),
  ]);
  assert.equal(windows.length, 2);
  const fiveHour = windows.find((w) => w.name === 'five_hour');
  assert.equal(fiveHour.used, 30);
  assert.equal(fiveHour.remaining, 70);
  assert.equal(fiveHour.unit, 'usd');
  // percent = 30/(30+70)*100
  assert.equal(fiveHour.percent, 30);
  // earliest reset wins
  assert.equal(fiveHour.reset, '2026-09-09T00:00:00Z');
  const weekly = windows.find((w) => w.name === 'weekly_limit');
  assert.equal(weekly.used, 5);
  assert.equal(weekly.remaining, 15);
});

test('aggregateKeyWindows skips errored and needs_configuration keys', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [{ name: 'five_hour', used: 10, remaining: 10, unit: 'usd' }]),
    failingKey(1, 'authentication_error'),
    failingKey(2, 'needs_configuration'),
    failingKey(3, 'network_error'),
  ]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].used, 10, 'only the ok key contributed');
});

test('aggregateKeyWindows omits percent when remaining is missing', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [{ name: 'five_hour', used: 10, unit: 'usd' }]),
  ]);
  assert.equal(windows[0].percent, undefined);
  assert.equal(windows[0].used, 10, 'amounts still aggregated');
});

test('aggregateKeyWindows omits percent when denominator is zero', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [{ name: 'five_hour', used: 0, remaining: 0, unit: 'usd' }]),
  ]);
  assert.equal(windows[0].percent, undefined);
});

test('aggregateKeyWindows rounds percent to 1 decimal and clamps', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [{ name: 'five_hour', used: 1, remaining: 2, unit: 'usd' }]),
    okKey(1, [{ name: 'five_hour', used: 1, remaining: 1, unit: 'usd' }]),
  ]);
  // 2 used / 5 total = 40 exactly; now rounding: 1/3 -> 33.3
  assert.equal(windows[0].percent, 40);

  const clamped = aggregateKeyWindows([
    okKey(0, [{ name: 'five_hour', used: 1, remaining: 0, unit: 'usd' }]),
  ]);
  assert.equal(clamped[0].percent, 100);
});

test('aggregateKeyWindows keeps percentless windows separate from derivable ones', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [
      { name: 'five_hour', used: 10, remaining: 10, unit: 'usd' },
      { name: 'weekly_limit', used: 7, unit: 'usd' },
    ]),
    okKey(1, [{ name: 'five_hour', used: 5, remaining: 5, unit: 'usd' }]),
  ]);
  const fiveHour = windows.find((w) => w.name === 'five_hour');
  assert.equal(fiveHour.percent, 50);
  const weekly = windows.find((w) => w.name === 'weekly_limit');
  assert.equal(weekly.percent, undefined);
});

test('aggregateKeyWindows handles percent-only upstreams without inventing amounts', () => {
  const windows = aggregateKeyWindows([
    okKey(0, [
      { name: 'five_hour', percent: 30, reset: '2026-09-10T00:00:00Z' },
    ]),
    okKey(1, [{ name: 'five_hour', percent: 50 }]),
  ]);
  const fiveHour = windows.find((w) => w.name === 'five_hour');
  assert.equal(fiveHour.used, undefined);
  assert.equal(fiveHour.remaining, undefined);
  assert.equal(
    fiveHour.percent,
    undefined,
    'percent values are never averaged',
  );
  assert.equal(fiveHour.reset, '2026-09-10T00:00:00Z');
});

test('aggregateKeyWindows returns empty list for no ok keys', () => {
  assert.deepEqual(aggregateKeyWindows([]), []);
  assert.deepEqual(aggregateKeyWindows(undefined), []);
  assert.deepEqual(aggregateKeyWindows([failingKey(0, 'timeout')]), []);
});

test('aggregateTooltipKeyLines lists per-key amounts and caps with a more line', () => {
  const ti = (key, opts) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? ''));
  const perKey = [
    okKey(0, [{ name: 'five_hour', used: 1, remaining: 2 }]),
    failingKey(1, 'network_error'),
    okKey(2, [{ name: 'five_hour', used: 3 }]),
  ];
  const lines = aggregateTooltipKeyLines(perKey, 'five_hour', ti);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Key 1'));
  assert.ok(lines[0].includes('1'));
  assert.ok(lines[1].startsWith('Key 3'));

  const many = Array.from({ length: 13 }, (_, i) =>
    okKey(i, [{ name: 'five_hour', used: i }]),
  );
  const capped = aggregateTooltipKeyLines(many, 'five_hour', ti, 10);
  assert.equal(capped.length, 11);
  assert.ok(capped[10].includes('3'), '13-10=3 hidden keys are summarized');
});

test('aggregateTooltipKeyLines returns empty when no ok key has the window', () => {
  const perKey = [
    okKey(0, [{ name: 'weekly_limit', used: 1 }]),
    failingKey(1, 'timeout'),
  ];
  assert.deepEqual(aggregateTooltipKeyLines(perKey, 'five_hour', t), []);
});
