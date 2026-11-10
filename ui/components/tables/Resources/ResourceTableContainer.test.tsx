import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DataTableFeatures } from '@omniviewdev/base-ui';
import type * as Runtime from '@omniviewdev/runtime';

import { readProfileStorage, writeProfileStorage } from '@/features/instance/boot';
import type { ResourceColumnMeta, ResourceTableRow } from '@/hooks/resource/useResourceDefinition';
import { projectResourceRows } from './rows';
import ResourceTableContainer from './ResourceTableContainer';
import { FIXTURE_CONNECTION_ID, FIXTURE_RESOURCE_TYPE, makeHostRecord, makeHostRecords } from './testing/fixture';

// The drawer and the notification center belong to the app shell. The table, the shared DataTable and
// everything between are the production implementations.
const drawer = vi.hoisted(() => ({ showResourceSidebar: vi.fn() }));
const activity = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/hooks/useRightDrawer', () => ({ default: () => drawer }));
vi.mock('@omniviewdev/runtime', async (original) => ({
  ...await original<typeof Runtime>(),
  useNotifications: () => activity,
}));
vi.mock('@/providers/BottomDrawer/events', () => ({ bottomDrawerChannel: { emit: vi.fn() } }));

// jsdom has no layout, so the virtualizer would see a 0px viewport and mount nothing. Give every
// element a fixed size, as the shared table's own tests do.
const sizes = { offsetHeight: 400, offsetWidth: 800, clientHeight: 400, clientWidth: 800 } as const;
const prototypeOf = (name: string) => name.startsWith('offset') ? HTMLElement.prototype : Element.prototype;
const saved = Object.entries(sizes).map(([name]) => [name, Object.getOwnPropertyDescriptor(prototypeOf(name), name)] as const);

beforeAll(() => {
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(prototypeOf(name), name, { configurable: true, get: () => value });
  }
});

afterAll(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) {
      Object.defineProperty(prototypeOf(name), name, descriptor);
    }
  }
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

type Column = ColumnDef<DataTableFeatures, ResourceTableRow>;

const textColumn = (id: string, header: string, meta?: ResourceColumnMeta): Column => ({
  id,
  header,
  accessorFn: (row) => (row.data as Record<string, unknown>)[id],
  meta: { dataTableCellDependencies: 'data', ...meta },
});

// Controls that act on their own, like the selection checkbox and the row-action button.
const selectColumn: Column = {
  id: 'select',
  header: 'Select',
  cell: () => <span>pick</span>,
  size: 40,
  enableSorting: false,
  enableHiding: false,
  enableResizing: false,
  meta: { opensDetail: false },
};
const ownColumn: Column = {
  id: 'own',
  header: 'Own',
  cell: () => <span data-testid="own-control">own</span>,
  enableSorting: false,
  meta: { opensDetail: false },
};
const menuColumn: Column = {
  id: 'menu',
  cell: () => <span>actions</span>,
  size: 50,
  enableSorting: false,
  enableHiding: false,
  enableResizing: false,
  meta: { opensDetail: false },
};
const customColumn: Column = {
  ...textColumn('custom', 'Custom', { rowHeight: 'content' }),
  cell: () => <span>custom cell</span>,
};

const columns = [selectColumn, textColumn('name', 'Name'), textColumn('phase', 'Phase'), ownColumn, menuColumn];
const idOf = (row: ResourceTableRow) => row.record.record.reference.address.id;
const visibilityKey = `fixture-${FIXTURE_CONNECTION_ID}-${FIXTURE_RESOURCE_TYPE}-column-visibility`;

function show(props: Partial<React.ComponentProps<typeof ResourceTableContainer>> = {}) {
  // Host order is deliberately not name order.
  const rows = projectResourceRows([makeHostRecord(3), makeHostRecord(1), makeHostRecord(2)]);
  const view = render(
    <ResourceTableContainer
      columns={columns}
      data={rows}
      pluginID="fixture"
      connectionID={FIXTURE_CONNECTION_ID}
      resourceKey={FIXTURE_RESOURCE_TYPE}
      {...props}
    />,
  );
  return { rows, ...view };
}

const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody > tr'));

describe('generic resource table', () => {
  it('shows the host records in the shared table, sorted by name, under their stable host keys', () => {
    const { rows, container } = show();

    const byId = (id: string) => rows.find((row) => idOf(row) === id)!.record.key;
    expect(bodyRows(container).map((tr) => tr.dataset.ovRowId)).toEqual(
      ['widget-00001', 'widget-00002', 'widget-00003'].map(byId),
    );
  });

  it('sorts through the shared header', () => {
    const { rows, container } = show();

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));

    expect(bodyRows(container).map((tr) => tr.dataset.ovRowId)).toEqual(
      rows.map(idOf).sort().reverse().map((id) => rows.find((row) => idOf(row) === id)!.record.key),
    );
  });

  it('mounts only the rows in view of a large collection', () => {
    const { container } = show({ data: projectResourceRows(makeHostRecords(1000)) });

    const mounted = bodyRows(container).length;

    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });

  it('pins selection at the start and actions at the end', () => {
    const { container } = show();

    for (const row of [container.querySelector('thead tr'), bodyRows(container)[0]]) {
      const cells = row!.children;
      expect(cells[0].getAttribute('data-ov-pinned')).toBe('start');
      expect(cells[cells.length - 1].getAttribute('data-ov-pinned')).toBe('end');
      expect(cells[1].getAttribute('data-ov-pinned')).toBeNull();
    }
  });

  it('keeps fixed row heights, and measures rows only while a content-sized column is visible', () => {
    const withCustom = [selectColumn, textColumn('name', 'Name'), customColumn];

    const measured = show({ columns: withCustom });
    expect(bodyRows(measured.container)).not.toHaveLength(0);
    expect(bodyRows(measured.container).some((tr) => tr.hasAttribute('data-ov-fixed-height'))).toBe(false);
    cleanup();

    const hidden = show({ columns: withCustom, initialColumnVisibility: { custom: false } });
    expect(bodyRows(hidden.container).every((tr) => tr.dataset.ovFixedHeight === 'true')).toBe(true);
    expect(screen.queryByText('custom cell')).toBeNull();
    cleanup();

    const fixed = show();
    expect(bodyRows(fixed.container).every((tr) => tr.dataset.ovFixedHeight === 'true')).toBe(true);
  });

  describe('row clicks', () => {
    it('open the clicked row with its canonical record', () => {
      drawer.showResourceSidebar.mockResolvedValue(undefined);
      const { rows } = show();
      const row = rows.find((candidate) => idOf(candidate) === 'widget-00002')!;

      fireEvent.click(screen.getByText('widget-00002'));

      expect(drawer.showResourceSidebar).toHaveBeenCalledTimes(1);
      expect(drawer.showResourceSidebar).toHaveBeenCalledWith({
        pluginID: 'fixture',
        targetId: row.record.targetId,
        route: row.record.route,
        reference: row.record.record.reference,
        representation: 'json',
        record: row.record,
      });
    });

    it('do not open a row from a column that acts on its own', () => {
      drawer.showResourceSidebar.mockResolvedValue(undefined);
      show();

      fireEvent.click(screen.getAllByTestId('own-control')[0]);
      fireEvent.click(screen.getAllByText('pick')[0]);
      fireEvent.click(screen.getAllByText('actions')[0]);

      expect(drawer.showResourceSidebar).not.toHaveBeenCalled();
    });

    it('report a failed open, but stay quiet when a newer open superseded it', async () => {
      show();

      drawer.showResourceSidebar.mockRejectedValueOnce(new Error('boom'));
      fireEvent.click(screen.getByText('widget-00001'));
      await waitFor(() => {
        expect(activity.notify).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Failed to load resource: widget-00001',
          severity: 'error',
        }));
      });

      drawer.showResourceSidebar.mockRejectedValueOnce(new DOMException('superseded', 'AbortError'));
      fireEvent.click(screen.getByText('widget-00002'));
      await waitFor(() => {
        expect(drawer.showResourceSidebar).toHaveBeenCalledTimes(2);
      });
      // Let the rejected open's handler run before asserting that it stayed quiet.
      const settled = Promise.withResolvers<void>();
      setTimeout(settled.resolve, 0);
      await settled.promise;

      expect(activity.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('column visibility', () => {
    it('keeps the column picker current while hiding and showing the same column', async () => {
      show();
      fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Phase' }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Sort by Phase' })).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Phase' })).not.toBeChecked();
      });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Phase' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sort by Phase' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Phase' })).toBeChecked();
      });
    });

    it('shows the profile\'s saved choices from the first render and adds newly declared columns', () => {
      writeProfileStorage(visibilityKey, JSON.stringify({ phase: false }));

      show({ initialColumnVisibility: { name: true, phase: true, extra: false } });

      expect(screen.getByRole('button', { name: 'Sort by Name' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Sort by Phase' })).toBeNull();
      expect(JSON.parse(readProfileStorage(visibilityKey) ?? 'null')).toEqual({ phase: false, name: true, extra: false });
    });

    it('starts from the declared defaults when nothing was saved', () => {
      show({ initialColumnVisibility: { name: true, phase: false } });

      expect(screen.getByRole('button', { name: 'Sort by Name' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Sort by Phase' })).toBeNull();
    });
  });
});
