// The table as a person meets it: a named region holding a native table, a header whose sort is a native button with aria-sort, rows that are
// not Tab stops, a selection column of named checkboxes, one click handler for activation. jsdom has no layout, so the region's size is
// stubbed; what is asserted is structure, state and calls, not pixels (the probes read pixels against the mock in WebKit and Chromium).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import type { DataTableColumn, DataTableSort } from './types';

const VIEWPORT = { height: 600, width: 1117 };
const isRegion = (element: HTMLElement) => element.getAttribute('role') === 'region';
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return isRegion(this) ? VIEWPORT.height : 0; 
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return isRegion(this) ? VIEWPORT.width : 0; 
} });

type Item = { readonly key: string; readonly name: string; readonly group: string; readonly count: number | undefined };

const items = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ key: `k${index}`, name: `item-${index}`, group: `group-${index % 7}`, count: index % 5 === 0 ? undefined : (index * 7) % 11 }));

const columns: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'id', lead: 36, cell: (row) => <span>{row.name}</span>, sortKey: (row) => row.name, text: (row) => row.name },
  { id: 'group', header: 'Group', fit: 'flex', cell: (row) => row.group, sortKey: (row) => row.group, text: (row) => row.group },
  { id: 'count', header: 'Count', fit: 'fixed', width: 72, align: 'end', cell: (row) => (row.count === undefined ? '\u2014' : String(row.count)), sortKey: (row) => row.count, sortKind: 'number' },
  { id: 'note', header: 'Note', fit: 'fixed', width: 80, cell: () => 'ok' },
];

const defined = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new Error(`no ${what}`);
  }

  return value;
};

const getRowKey = (row: Item) => row.key;
afterEach(() => {
  VIEWPORT.height = 600;
});

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const names = () => bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const bodyRow = (index: number): HTMLElement => defined(bodyRows()[index], `row ${index}`);
const cellOf = (row: HTMLElement, index: number): HTMLElement => defined(within(row).getAllByRole('cell')[index], `cell ${index}`);

describe('structure', () => {
  it('is a named scroll region holding a native table with its header and the rows in view', () => {
    render(<DataTable label="Items" rows={items(100)} getRowKey={getRowKey} columns={columns} />);
    const region = screen.getByRole('region', { name: 'Items' });
    expect(region.getAttribute('tabindex')).toBe('0');
    const table = within(region).getByRole('table');
    expect(table.tagName).toBe('TABLE');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Group', 'Count', 'Note']);
    expect(bodyRows().length).toBeGreaterThan(10);
    expect(bodyRows().length).toBeLessThan(40);
  });

  it('says how many rows there are and which one each mounted row is (the window is not the table)', () => {
    render(<DataTable label="Items" rows={items(5000)} getRowKey={getRowKey} columns={columns} />);
    const table = screen.getByRole('table');
    expect(table.getAttribute('aria-rowcount')).toBe('5001');
    const rows = within(table).getAllByRole('row');
    expect(rows[0]?.getAttribute('aria-rowindex')).toBe('1');
    expect(rows[1]?.getAttribute('aria-rowindex')).toBe('2');
    expect(rows[2]?.getAttribute('aria-rowindex')).toBe('3');
  });

  it('keeps every cell in its column, in order, with the content the column gives', () => {
    render(<DataTable label="Items" rows={items(10)} getRowKey={getRowKey} columns={columns} />);
    const cells = within(bodyRow(1)).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['item-1', 'group-1', '7', 'ok']);
  });

  it('is empty without rows: the header stays, there is no row', () => {
    render(<DataTable label="Items" rows={[]} getRowKey={getRowKey} columns={columns} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(bodyRows()).toHaveLength(0);
  });

  it('makes no row a Tab stop: rows, cells and headers carry no tabindex (15 L2)', () => {
    render(<DataTable label="Items" rows={items(30)} getRowKey={getRowKey} columns={columns} />);
    // Inside the region (itself the one Tab stop that scrolls by keyboard) nothing carries a tabindex.
    expect([...screen.getByRole('region').querySelectorAll('[tabindex]')]).toEqual([]);
  });

  it('has no title attribute anywhere (15 L4)', () => {
    render(<DataTable label="Items" rows={items(30)} getRowKey={getRowKey} columns={columns} onSortChange={() => undefined} />);
    expect(screen.getByRole('region').querySelectorAll('[title]')).toHaveLength(0);
  });

  it('marks its row height: two lines or one', () => {
    const { rerender } = render(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={columns} />);
    expect(screen.getByRole('region').getAttribute('data-ov-lines')).toBe('1');
    rerender(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={columns} lines={2} />);
    expect(screen.getByRole('region').getAttribute('data-ov-lines')).toBe('2');
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = DataTable as unknown as (props: Record<string, unknown>) => React.ReactElement;
    render(<Loose label="Items" rows={items(3)} getRowKey={getRowKey} columns={columns} data-testid="probe" className="restyled" style={{ color: 'red' }} id="x" title="hint" />);
    const region = screen.getByTestId('probe');
    expect(region.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title']) {
      expect(region.hasAttribute(attribute), attribute).toBe(false);
    }
  });
});

describe('windowing', () => {
  it('mounts only the rows in view for 5,025 rows, and keeps the height of all of them', () => {
    render(<DataTable label="Items" rows={items(5025)} getRowKey={getRowKey} columns={columns} />);
    const region = screen.getByRole('region');
    expect(bodyRows().length).toBeLessThanOrEqual(40);
    expect(region.querySelectorAll('tr').length).toBeLessThan(80);
    // The rows above and below the window are one spacer each, so the body is as tall as all the rows.
    const spacers = [...region.querySelectorAll('tbody > tr[aria-hidden="true"]')];
    expect(spacers.length).toBeLessThanOrEqual(2);
  });

  it('moves the window with the scroll offset and never leaves a hole in the viewport', () => {
    render(<DataTable label="Items" rows={items(5025)} getRowKey={getRowKey} columns={columns} />);
    const region = screen.getByRole('region');
    let offset = 0;
    Object.defineProperty(region, 'scrollTop', { configurable: true, get: () => offset });
    const scrollTo = (top: number) => {
      act(() => {
        offset = top;
        fireEvent.scroll(region);
      });
    };

    for (const top of [0, 137, 4000, 90_000, 150_000, 200_000]) {
      scrollTo(top);
      const first = Math.floor(top / 24);
      const last = Math.min(5024, Math.ceil((top + VIEWPORT.height) / 24) - 1);
      const indexes = new Set(bodyRows().map((row) => Number(row.getAttribute('aria-rowindex')) - 2));
      for (let index = first; index <= last; index += 1) {
        expect(indexes.has(index), `row ${index} at offset ${top}`).toBe(true);
      }
    }
  });
});

describe('sort', () => {
  function Sorted({ initial, onSort }: { initial?: DataTableSort | undefined; onSort?: (sort: DataTableSort) => void }) {
    const [sort, setSort] = useState<DataTableSort | undefined>(initial);
    const rows = useMemo(() => items(12).reverse(), []);
    return (
      <DataTable
        label="Items"
        rows={rows}
        getRowKey={getRowKey}
        columns={columns}
        sort={sort}
        onSortChange={(next) => {
          onSort?.(next);
          setSort(next);
        }}
      />
    );
  }

  const header = (name: string) => screen.getByRole('columnheader', { name });

  it('puts a native button in the header of a sortable column, and none in a column that cannot be sorted', () => {
    render(<Sorted />);
    expect(within(header('Name')).getByRole('button', { name: 'Name' }).tagName).toBe('BUTTON');
    expect(within(header('Note')).queryByRole('button')).toBeNull();
  });

  it('reads aria-sort: none until a sort is chosen, then ascending or descending on that column only', () => {
    render(<Sorted initial={{ column: 'name', direction: 'ascending' }} />);
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    expect(header('Group').getAttribute('aria-sort')).toBe('none');
    expect(header('Note').hasAttribute('aria-sort')).toBe(false);
  });

  it('sorts ascending on the first press, descending on the second, and back (no third state)', () => {
    const onSort = vi.fn();
    render(<Sorted onSort={onSort} />);
    const press = (name: string) => fireEvent.click(within(header(name)).getByRole('button'));
    press('Name');
    expect(onSort).toHaveBeenLastCalledWith({ column: 'name', direction: 'ascending' });
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    press('Name');
    expect(onSort).toHaveBeenLastCalledWith({ column: 'name', direction: 'descending' });
    press('Name');
    expect(onSort).toHaveBeenLastCalledWith({ column: 'name', direction: 'ascending' });
    press('Group');
    expect(onSort).toHaveBeenLastCalledWith({ column: 'group', direction: 'ascending' });
  });

  it('orders text naturally: item-2 before item-10', () => {
    render(<Sorted initial={{ column: 'name', direction: 'ascending' }} />);
    expect(names()).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9', 'item-10', 'item-11']);
  });

  it('orders numbers as numbers and puts a missing value last in either direction (13 D7)', () => {
    render(<Sorted initial={{ column: 'count', direction: 'ascending' }} />);
    const counts = () => bodyRows().map((row) => within(row).getAllByRole('cell')[2]?.textContent);
    const ascending = counts();
    expect(ascending.slice(-3)).toEqual(['\u2014', '\u2014', '\u2014']);
    const present = ascending.filter((value) => value !== '\u2014').map(Number);
    expect(present).toEqual([...present].sort((a, b) => a - b));
    fireEvent.click(within(header('Count')).getByRole('button'));
    const descending = counts();
    expect(descending.slice(-3)).toEqual(['\u2014', '\u2014', '\u2014']);
    const down = descending.filter((value) => value !== '\u2014').map(Number);
    expect(down).toEqual([...down].sort((a, b) => b - a));
  });

  it('shows the active direction as a 12 px arrow in the header, and none elsewhere', () => {
    render(<Sorted initial={{ column: 'name', direction: 'descending' }} />);
    const arrow = header('Name').querySelector('svg');
    expect(arrow?.getAttribute('data-ov-glyph')).toBe('arrow-down');
    expect(arrow?.getAttribute('data-ov-size')).toBe('12');
    expect(header('Group').querySelector('svg')).toBeNull();
  });

  it('leaves the rows in the order given when there is no sort', () => {
    render(<DataTable label="Items" rows={items(5).reverse()} getRowKey={getRowKey} columns={columns} onSortChange={() => undefined} />);
    expect(names()).toEqual(['item-4', 'item-3', 'item-2', 'item-1', 'item-0']);
  });

  it('shows no sort button without a way to change the sort', () => {
    render(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={columns} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('selection', () => {
  function Selecting({ onToggle, onActivate }: { onToggle?: (row: Item) => void; onActivate?: (row: Item) => void }) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['k1']));
    const rows = useMemo(() => items(20), []);
    return (
      <DataTable
        label="Items"
        rows={rows}
        getRowKey={getRowKey}
        columns={columns}
        onRowActivate={onActivate}
        selection={{
          selected,
          label: (row) => `Select ${row.name}`,
          onToggle: (row) => {
            onToggle?.(row);
            setSelected((current) => {
              const next = new Set(current);
              if (!next.delete(row.key)) {
                next.add(row.key);
              }

              return next;
            });
          },
          all: { state: selected.size === 0 ? false : selected.size === 20 ? true : 'mixed', label: 'Select all 20 rows', onToggle: () => {
            setSelected(new Set()); 
          } },
        }}
      />
    );
  }

  function checkbox(name: string): HTMLInputElement {
    const element = screen.getByRole('checkbox', { name });
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError(`${name} is not an input`);
    }

    return element;
  }

  it('adds a leading column of checkboxes, each named for its row, and a header checkbox for the whole', () => {
    render(<Selecting />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    expect(checkbox('Select item-3').checked).toBe(false);
    expect(checkbox('Select item-1').checked).toBe(true);
    expect(checkbox('Select all 20 rows').indeterminate).toBe(true);
  });

  it('toggles a row from its checkbox, marks the row, and does not activate it', () => {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    render(<Selecting onToggle={onToggle} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select item-3' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toMatchObject({ key: 'k3' });
    expect(checkbox('Select item-3').checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Select item-3' }).closest('tr')?.getAttribute('data-ov-selected')).toBe('true');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('leaves the header cell empty when the table has no select-all (no invented control)', () => {
    render(
      <DataTable
        label="Items"
        rows={items(5)}
        getRowKey={getRowKey}
        columns={columns}
        selection={{ selected: new Set(), label: (row) => `Select ${row.name}`, onToggle: () => undefined }}
      />,
    );
    const lead = defined(screen.getAllByRole('columnheader')[0], 'the selection header');
    expect(lead.textContent).toBe('');
    expect(within(lead).queryByRole('checkbox')).toBeNull();
  });
});

describe('row activation', () => {
  it('calls back with the row for a click on a plain cell, from one handler on the body', () => {
    const onRowActivate = vi.fn();
    render(<DataTable label="Items" rows={items(10)} getRowKey={getRowKey} columns={columns} onRowActivate={onRowActivate} />);
    fireEvent.click(cellOf(bodyRow(3), 1));
    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate.mock.calls[0]?.[0]).toMatchObject({ key: 'k3' });
  });

  it('resolves the row after a sort, not by where it was', () => {
    const onRowActivate = vi.fn();
    render(<DataTable label="Items" rows={items(10).reverse()} getRowKey={getRowKey} columns={columns} sort={{ column: 'name', direction: 'ascending' }} onSortChange={() => undefined} onRowActivate={onRowActivate} />);
    fireEvent.click(cellOf(bodyRow(0), 0));
    expect(onRowActivate.mock.calls[0]?.[0]).toMatchObject({ key: 'k0' });
  });

  it('leaves a control inside the row its own click', () => {
    const onRowActivate = vi.fn();
    const withControl: Array<DataTableColumn<Item>> = [...columns, { id: 'go', header: 'Go', fit: 'fixed', width: 60, cell: (row) => <button type="button">{`Open ${row.name}`}</button> }];
    render(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={withControl} onRowActivate={onRowActivate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open item-2' }));
    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it('marks the table as activatable so a row paints under the pointer only when a click does something', () => {
    const { rerender } = render(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={columns} />);
    expect(screen.getByRole('table').hasAttribute('data-ov-activatable')).toBe(false);
    rerender(<DataTable label="Items" rows={items(5)} getRowKey={getRowKey} columns={columns} onRowActivate={() => undefined} />);
    expect(screen.getByRole('table').hasAttribute('data-ov-activatable')).toBe(true);
  });
});
