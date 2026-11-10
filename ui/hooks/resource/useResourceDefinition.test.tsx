import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataTableFeatures } from '@omniviewdev/base-ui';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import {
  ExtensionPointRegistry,
  ExtensionProvider,
  RESOURCE_CELL_EXTENSION_POINT_ID,
  createResourceCellExtensionPoint,
  type ResourceCellContribution,
} from '@omniviewdev/runtime';

// Only the native Wails transport is replaced. Column construction, the extension registry and
// CustomTableCell are the production implementations.
const transport = vi.hoisted(() => ({ definition: vi.fn(), handler: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', async (original) => ({
  ...await original<typeof RuntimeApi>(),
  ResourceClient: { GetResourceDefinition: transport.definition },
  ExecClient: { GetHandler: transport.handler },
}));

import useResourceDefinition, { type ResourceColumnMeta, type ResourceTableRow } from './useResourceDefinition';
import { FIXTURE_COLUMN_DEFS, makeHostRecord } from '@/components/tables/Resources/testing/fixture';

type Columns = Array<ColumnDef<DataTableFeatures, ResourceTableRow>>;

afterEach(cleanup);

const row = { original: { data: { name: 'w' }, record: { route: { connection: 'c1' }, record: {} } } };

function setup() {
  transport.definition.mockResolvedValue({
    columnDefs: [
      { id: 'name', header: 'Name', accessor: 'name' },
      { id: 'status', header: 'Status', accessor: 'status', component: 'status-badge', componentParams: { label: 'phase' } },
    ],
  });
  transport.handler.mockResolvedValue({});
  const registry = new ExtensionPointRegistry({ initialStores: [createResourceCellExtensionPoint()] });
  const store = registry.getExtensionPoint<ResourceCellContribution>(RESOURCE_CELL_EXTENSION_POINT_ID)!;
  const client = new QueryClient();
  const providers = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ExtensionProvider registry={registry}>{children}</ExtensionProvider>
    </QueryClientProvider>
  );
  const columnsFor = async (resourceKey: string): Promise<Columns> => {
    const { result } = renderHook(() => useResourceDefinition({ pluginID: 'native', connectionID: 'c1', resourceKey }), { wrapper: providers });
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    return result.current.columns.defs;
  };

  const cellOf = (columns: Columns, id: string, value: unknown): React.ReactElement => {
    const column = columns.find(def => def.id === id)!;
    return (column.cell as (context: unknown) => React.ReactElement)({ getValue: () => value, row });
  };

  const show = (element: React.ReactNode) => render(<ExtensionProvider registry={registry}>{element}</ExtensionProvider>);
  return { store, columnsFor, cellOf, show, providers };
}

describe('useResourceDefinition custom columns', () => {
  it('resolves a provider-declared component for the column’s plugin and resource type', async () => {
    const { store, columnsFor, cellOf, show } = setup();
    const widgets = await columnsFor('widgets');
    const gadgets = await columnsFor('gadgets');
    store.register({
      id: 'native/status-badge',
      plugin: 'native',
      label: 'Status badge',
      value: { contractVersion: 1, name: 'status-badge', resourceKeys: ['widgets'], component: ({ data }) => <span>badge:{String(data)}</span> },
    });

    show(cellOf(widgets, 'status', 'Running'));
    expect(screen.getByText('badge:Running')).toBeTruthy();
    cleanup();
    show(cellOf(gadgets, 'status', 'Running'));
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  it('forwards the declared componentParams to the contributed renderer', async () => {
    const { store, columnsFor, cellOf, show } = setup();
    const widgets = await columnsFor('widgets');
    store.register({
      id: 'native/status-badge',
      plugin: 'native',
      label: 'Status badge',
      value: {
        contractVersion: 1,
        name: 'status-badge',
        component: ({ data, componentParams }) => <span>{String(data)}|{JSON.stringify(componentParams)}</span>,
      },
    });

    show(cellOf(widgets, 'status', 'Running'));
    expect(screen.getByText('Running|{"label":"phase"}')).toBeTruthy();
  });

  it('shows the unavailable state until the plugin contributes the declared component', async () => {
    const { store, columnsFor, cellOf, show } = setup();
    const widgets = await columnsFor('widgets');
    show(cellOf(widgets, 'status', 'Running'));
    expect(screen.getByText('Unavailable')).toBeTruthy();
    await act(async () => {
      store.register({
        id: 'native/status-badge',
        plugin: 'native',
        label: 'Status badge',
        value: { contractVersion: 1, name: 'status-badge', component: ({ data }) => <span>badge:{String(data)}</span> },
      }); 
    });
    expect(screen.getByText('badge:Running')).toBeTruthy();
  });

  it('keeps columns without a declared component on the built-in text cell', async () => {
    const { columnsFor, cellOf, show } = setup();
    const widgets = await columnsFor('widgets');
    show(cellOf(widgets, 'name', 'w'));
    expect(screen.getByText('w')).toBeTruthy();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});

type Providers = React.JSXElementConstructor<{ children: React.ReactNode }>;

/** Both the definition and the action handlers load separately. Wait until the columns reflect both. */
async function settledColumns(providers: Providers) {
  const hook = renderHook(() => useResourceDefinition({ pluginID: 'native', connectionID: 'c1', resourceKey: 'widgets' }), { wrapper: providers });
  await waitFor(() => {
    expect(hook.result.current.columns.actions).toBeDefined();
  });
  return hook;
}

const columnOf = (columns: Columns, id: string) => columns.find((def) => def.id === id)!;
const metaOf = (columns: Columns, id: string): ResourceColumnMeta | undefined => columnOf(columns, id).meta;
const reader = (columns: Columns, id: string) => {
  const { accessorFn } = columnOf(columns, id) as { accessorFn: (row: ResourceTableRow, index: number) => unknown };
  return (data: unknown) => accessorFn({ record: makeHostRecord(0), data }, 0);
};

describe('useResourceDefinition generic table columns', () => {
  it('keeps the same columns across renders, so mounted cells keep their renderers', async () => {
    const { providers } = setup();
    const { result, rerender } = await settledColumns(providers);
    const settled = result.current.columns;

    rerender();

    expect(result.current.columns).toBe(settled);
    expect(result.current.columns.defs).toBe(settled.defs);
  });

  it('declares selection and actions as controls of their own and plugin components as content-sized', async () => {
    const { providers } = setup();
    const { result } = await settledColumns(providers);
    const { defs } = result.current.columns;

    expect(defs.map((def) => def.id)).toEqual(['select', 'name', 'status', 'menu']);
    expect(metaOf(defs, 'select')).toMatchObject({ opensDetail: false });
    expect(metaOf(defs, 'menu')).toMatchObject({ opensDetail: false });
    expect(metaOf(defs, 'status')).toMatchObject({ rowHeight: 'content' });
    expect(metaOf(defs, 'name')?.rowHeight).toBeUndefined();
    expect(metaOf(defs, 'name')).toMatchObject({ dataTableCellDependencies: 'data' });
  });

  it('keeps a declared width exact, shares the space among the rest and starts hidden columns hidden', async () => {
    const { providers } = setup();
    transport.definition.mockResolvedValue({ columnDefs: FIXTURE_COLUMN_DEFS });
    const { result } = await settledColumns(providers);
    const { defs, visibility } = result.current.columns;

    expect(columnOf(defs, 'size')).toMatchObject({ size: 80, minSize: 80, maxSize: 80, enableResizing: false });
    expect(metaOf(defs, 'size')).toMatchObject({ align: 'right' });
    expect(columnOf(defs, 'name')).not.toHaveProperty('size');
    expect(visibility).toEqual({ name: true, phase: true, size: true, owner: false });
  });

  it('reads values by priority and applies a value map in declaration order without logging', async () => {
    const { providers } = setup();
    transport.definition.mockResolvedValue({
      columnDefs: [
        { id: 'phase', header: 'Phase', accessor: 'status.phase', accessorPriority: 'FIRST', valueMap: { '^Run': 'Go', 'ning$': 'ing!' } },
        { id: 'last', header: 'Last', accessor: 'a,b', accessorPriority: 'LAST' },
        { id: 'all', header: 'All', accessor: 'a,b' },
      ],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { result } = await settledColumns(providers);
    const { defs } = result.current.columns;

    expect(reader(defs, 'phase')({ status: { phase: 'Running' } })).toBe('Going!');
    expect(reader(defs, 'phase')({ status: { phase: 'Pending' } })).toBe('Pending');
    expect(reader(defs, 'last')({ a: 'x', b: 'y' })).toBe('y');
    expect(reader(defs, 'all')({ a: 'x', b: 'y' })).toEqual(['x', 'y']);
    expect(reader(defs, 'all')({ a: 'x' })).toBe('x');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('offers no action menu for a body that is not an object', async () => {
    const { providers, show } = setup();
    const { result } = await settledColumns(providers);
    const menu = columnOf(result.current.columns.defs, 'menu');

    show((menu.cell as (context: unknown) => React.ReactElement)({ row: { original: { data: ['not', 'an', 'object'], record: {} } } }));

    expect(screen.getByText('Resource actions require an object body.')).toBeTruthy();
  });

  it('has no columns and no actions while the definition is unavailable', async () => {
    const { providers } = setup();
    transport.definition.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useResourceDefinition({ pluginID: 'native', connectionID: 'c1', resourceKey: 'widgets' }), { wrapper: providers });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.columns).toEqual({ defs: [], visibility: {}, actions: undefined });
  });
});
