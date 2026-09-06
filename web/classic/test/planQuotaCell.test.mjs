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

// Deterministic render tests for the Plan quota cell. The hook is stubbed at
// module resolution, so no store, React runtime or network is involved: the
// component function is called directly and the returned element tree is
// inspected. This pins the visible contract of the quota column: a successful
// query shows usage without a status tag or any refresh button, error and
// configuration problems keep their tag, and each window line shows its
// progress bar with the localized reset date+time on its right — or nothing
// when the reset is missing or invalid.
// Run with: node --test test/planQuotaCell.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const usageStubSource = `
  // Read at call time so each test can reseed the global before rendering.
  export const useChannelPlanQuota = () => ({
    state: globalThis.__planQuotaTestState,
  });
`;

const keysUsageStubSource = `
  // Read at call time so each test can reseed the global before rendering.
  export const useChannelKeysPlanQuota = () => ({
    state: globalThis.__keysPlanQuotaTestState,
  });
`;

const { outputFiles } = await build({
  entryPoints: ['src/components/table/channels/PlanQuotaCell.jsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'transform',
  plugins: [
    {
      name: 'cell-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return;
          // The real hooks pull in axios and the entire helpers graph; the
          // cell test replaces them at the resolved-path level instead.
          if (args.path.endsWith('useChannelPlanQuota')) {
            return { path: 'useChannelPlanQuota', namespace: 'fixture' };
          }
          if (args.path.endsWith('useChannelKeysPlanQuota')) {
            return { path: 'useChannelKeysPlanQuota', namespace: 'fixture' };
          }
          if (path.isAbsolute(args.path) || args.path.startsWith('.')) {
            // Real source files (planQuotaFormat.js etc.) load from disk.
            return null;
          }
          return { path: args.path, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
          if (path === 'useChannelPlanQuota') {
            return { contents: usageStubSource };
          }
          if (path === 'useChannelKeysPlanQuota') {
            return { contents: keysUsageStubSource };
          }
          if (path === 'react') {
            return {
              contents: `
            export const useState = (initial) => [initial, () => {}];
            const React = {
              createElement: (type, props, ...children) => ({
                type,
                props: props || {},
                children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
              }),
            };
            export default React;
          `,
            };
          }
          if (path.startsWith('@douyinfe/semi-ui')) {
            return {
              contents: `
            const passthrough = (name) => (props) => ({ type: name, props });
            export const Progress = passthrough('Progress');
            export const Select = passthrough('Select');
            export const Spin = passthrough('Spin');
            export const Tag = passthrough('Tag');
            export const Tooltip = passthrough('Tooltip');
            export const Typography = { Text: passthrough('Text') };
          `,
            };
          }
          return {
            contents: 'export default null;',
          };
        });
      },
    },
  ],
});

const { PlanQuotaCell } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const t = (key) => key;
const record = { id: 1, channel_info: {} };

// Flatten the element tree into strings keyed by "type|text" for structural
// assertions that ignore tooltip wrapper depth. Function elements (the local
// window-line component) are invoked with their props, mirroring what a
// renderer would do.
const collect = (node, out = []) => {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));
    return out;
  }
  if (typeof node.type === 'function') {
    // A renderer hands children to components through props.children.
    collect(node.type({ ...node.props, children: node.children }), out);
    return out;
  }
  out.push(`${node.type}`);
  if (node.children) collect(node.children, out);
  if (node.props?.children != null) collect(node.props.children, out);
  return out;
};

// The stubbed hook reads this snapshot at call time, so each render is
// seeded deterministically without any store or network.
const renderCell = (state) => {
  globalThis.__planQuotaTestState = state;
  return PlanQuotaCell({ t, record, visible: true })
    .children.flatMap((child) => collect(child))
    .join('\n');
};

const okState = (items, extra = {}) => ({
  status: 'ok',
  loading: false,
  data: { status: 'ok', items, cache_hit: false, ...extra },
  error: null,
});

test('successful query renders usage only: no status tag, no refresh button', () => {
  const tree = renderCell(
    okState([
      { name: 'five_hour', percent: 30, reset: '2026-09-10T00:00:00Z' },
    ]),
  );
  assert.ok(tree.includes('5-hour window'), 'window title rendered');
  assert.ok(!tree.includes('Tag'), 'no status tag for ok status');
  assert.ok(!tree.includes('Healthy'), 'no Healthy text');
  assert.ok(!tree.includes('Force refresh'), 'no refresh affordance');
  assert.ok(!tree.includes('IconRefresh'), 'no refresh icon');
});

test('error and configuration problems keep their status tag', () => {
  const errorTree = renderCell({
    status: 'error',
    loading: false,
    data: null,
    error: 'Rate limited',
  });
  assert.ok(errorTree.includes('Tag'), 'error tag kept');
  assert.ok(errorTree.includes('Rate limited'));

  const configTree = renderCell(okState([], { status: 'disabled' }));
  assert.ok(configTree.includes('Tag'), 'unbound preset tag kept');
  assert.ok(configTree.includes('No preset bound'));
});

test('window line shows progress bar with localized reset at its right', () => {
  const tree = renderCell(
    okState([
      {
        name: 'five_hour',
        percent: 42,
        reset: '2026-09-10T08:30:00Z',
        unit: 'usd',
      },
    ]),
  );
  assert.ok(tree.includes('Progress'), 'progress bar rendered');
  assert.ok(tree.includes('2026'), 'formatted reset date rendered');
  assert.ok(
    /\nReset$/.test(tree) || tree.includes('Reset'),
    'Reset label rendered',
  );
  // Reset text follows the bar: bar element appears before the reset strings.
  const progressIndex = tree.indexOf('Progress');
  const resetIndex = tree.indexOf('Reset');
  assert.ok(progressIndex < resetIndex, 'reset sits right of the bar');
});

test('missing or invalid reset renders neither label nor guessed time', () => {
  for (const reset of [undefined, null, '', 'not-a-date']) {
    const tree = renderCell(okState([{ name: 'daily', percent: 10, reset }]));
    assert.ok(tree.includes('Progress'));
    assert.ok(
      !tree.includes('Reset'),
      `no Reset label for reset=${JSON.stringify(reset)}`,
    );
    assert.ok(
      !tree.includes('NaN'),
      `no fabricated time for reset=${JSON.stringify(reset)}`,
    );
  }
});

test('multi window usage renders one line per window with per-window resets', () => {
  const items = [
    { name: 'five_hour', percent: 30, reset: '2026-09-10T00:00:00Z' },
    { name: 'weekly_limit', percent: 80, reset: '2026-09-15T00:00:00Z' },
    { name: 'monthly', percent: 55 },
  ];
  const tree = renderCell(okState(items));
  const resetLines = tree.split('\n').filter((entry) => /^\d{4}/.test(entry));
  assert.equal(resetLines.length, 2, 'only windows with a reset show one');
  assert.ok(tree.includes('5-hour window'));
  assert.ok(tree.includes('Weekly window'));
  assert.ok(tree.includes('Monthly window'));
});

test('multi-key channel renders the all-keys aggregate without any key selector', () => {
  const multiRecord = {
    id: 2,
    channel_info: { is_multi_key: true, multi_key_size: 3 },
  };
  globalThis.__keysPlanQuotaTestState = {
    status: 'ok',
    loading: false,
    data: {
      channel_id: 2,
      is_multi_key: true,
      keys: [
        {
          key_index: 0,
          status: 'ok',
          items: [
            {
              name: 'five_hour',
              used: 10,
              remaining: 30,
              unit: 'usd',
              reset: '2026-09-10T00:00:00Z',
            },
          ],
        },
        {
          key_index: 1,
          status: 'ok',
          items: [
            {
              name: 'five_hour',
              used: 20,
              remaining: 40,
              unit: 'usd',
              reset: '2026-09-09T00:00:00Z',
            },
          ],
        },
        { key_index: 2, status: 'authentication_error', items: [] },
      ],
    },
    error: null,
  };
  const flat = collect(
    PlanQuotaCell({ t, record: multiRecord, visible: true }),
  ).join('\n');
  assert.ok(flat.includes('Select') === false, 'no key index select rendered');
  assert.ok(flat.includes('5-hour window'), 'aggregated window rendered');
  assert.ok(flat.includes('30%'), 'sum-derived percent rendered');
  assert.ok(!flat.includes('60%'), 'per-key percents are not averaged/summed');
  assert.ok(flat.includes('2026'), 'earliest reset rendered');
  assert.ok(!flat.includes('Force refresh'));
});

test('multi-key channel without queryable keys shows unbound tag', () => {
  const multiRecord = {
    id: 3,
    channel_info: { is_multi_key: true, multi_key_size: 2 },
  };
  globalThis.__keysPlanQuotaTestState = {
    status: 'ok',
    loading: false,
    data: {
      channel_id: 3,
      is_multi_key: true,
      keys: [{ key_index: 0, status: 'needs_configuration', items: [] }],
    },
    error: null,
  };
  const flat = collect(
    PlanQuotaCell({ t, record: multiRecord, visible: true }),
  ).join('\n');
  assert.ok(flat.includes('Tag'));
  assert.ok(
    flat.includes('Needs configuration'),
    'needs_configuration keys show their configuration tag',
  );
});

test('multi-key aggregate with no derivable percent renders amounts without a bar', () => {
  const multiRecord = {
    id: 4,
    channel_info: { is_multi_key: true, multi_key_size: 1 },
  };
  globalThis.__keysPlanQuotaTestState = {
    status: 'ok',
    loading: false,
    data: {
      channel_id: 4,
      is_multi_key: true,
      keys: [
        {
          key_index: 0,
          status: 'ok',
          items: [{ name: 'five_hour', used: 10, unit: 'usd' }],
        },
      ],
    },
    error: null,
  };
  const flat = collect(
    PlanQuotaCell({ t, record: multiRecord, visible: true }),
  ).join('\n');
  assert.ok(flat.includes('5-hour window'));
  assert.ok(flat.includes('10'), 'summed used amount rendered as text');
  assert.ok(
    flat.includes('Progress') === false,
    'no progress bar fabricated without a percent',
  );
});
