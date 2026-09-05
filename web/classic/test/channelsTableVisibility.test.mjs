import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/components/table/channels/ChannelsTable.jsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'table-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return;
          return { path: args.path, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
          if (path === 'react')
            return {
              contents: `
          export const useMemo = (factory) => factory();
          export default { createElement: (type, props) => ({ type, props }) };
        `,
            };
          if (path === './ChannelsColumnDefs')
            return {
              contents: `
          export const getChannelsColumns = ({ COLUMN_KEYS, planQuotaVisible }) => [
            { key: COLUMN_KEYS.PLAN_QUOTA, queryEnabled: planQuotaVisible },
            { key: 'balance' },
          ];
        `,
            };
          return {
            contents: `export default function Fixture() {}; export const Empty = () => null;
          export const IllustrationNoResult = () => null;
          export const IllustrationNoResultDark = () => null;`,
          };
        });
      },
    },
  ],
});
const { default: ChannelsTable } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const render = (visibleColumns) =>
  ChannelsTable({
    channels: [],
    visibleColumns,
    COLUMN_KEYS: { PLAN_QUOTA: 'plan_quota' },
    t: (key) => key,
  });

test('visible quota column enables its query without a separate visibility prop', () => {
  const table = render({ plan_quota: true, balance: true });
  assert.equal(
    table.props.columns.find((column) => column.key === 'plan_quota')
      .queryEnabled,
    true,
  );
});

test('hiding then showing the quota column updates the query visibility', () => {
  assert.deepEqual(
    render({ plan_quota: false, balance: true }).props.columns.map(
      (column) => column.key,
    ),
    ['balance'],
  );
  assert.equal(
    render({ plan_quota: true }).props.columns[0].queryEnabled,
    true,
  );
});
