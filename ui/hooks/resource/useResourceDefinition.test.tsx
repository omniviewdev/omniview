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

import useResourceDefinition, { type ResourceTableRow } from './useResourceDefinition';

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
  return { store, columnsFor, cellOf, show };
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
