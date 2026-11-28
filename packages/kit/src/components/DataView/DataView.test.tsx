import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import type { CardGridContent } from '../CardGrid';
import type { CollectionFooterProps } from '../CollectionFooter';
import type { DataTableColumn } from '../DataTable';
import { ResourceCard } from '../ResourceCard';
import { DataView, type DataViewProps, type DataViewState } from './DataView';
import * as examples from './DataView.examples';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

type Item = { readonly key: string; readonly name: string; readonly status: string };
const ITEMS: readonly Item[] = [
  { key: 'a', name: 'orders-api', status: 'Running' },
  { key: 'b', name: 'orders-db', status: 'Failed' },
  { key: 'c', name: 'orders-queue', status: 'Running' },
];

const columns: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'id', cell: (row) => row.name, text: (row) => row.name, sortKey: (row) => row.name },
  { id: 'status', header: 'Status', fit: 'fixed', width: 120, cell: (row) => row.status, sortKey: (row) => row.status },
];

const FILTERS = { label: 'Item state', total: 3, filters: [{ id: 'running', label: 'Running', count: 2, tone: 'success' as const }, { id: 'failed', label: 'Failed', count: 1, tone: 'error' as const }], selected: null, onSelect: () => undefined };
const FOOTER = { shown: 3, total: { kind: 'exact' as const, value: 3 }, noun: 'item', plural: 'items' };

const view = (props: Partial<Extract<DataViewProps<Item>, { readonly table: unknown }>> = {}) => (
  <DataView<Item>
    label="Items"
    header={<h1>Items</h1>}
    quickFilters={FILTERS}
    toolbar={<div role="group" aria-label="Tools"><input aria-label="Search items" /></div>}
    table={{ rows: ITEMS, getRowKey: (row) => row.key, columns }}
    footer={FOOTER}
    {...props}
  />
);

const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('DataView, the composition (design 12 section 5)', () => {
  it('keeps the header, quick filters, toolbar, table and footer in reading and keyboard order', () => {
    const { container } = render(view());
    const order = [
      screen.getByRole('heading', { name: 'Items' }),
      screen.getByRole('group', { name: 'Item state' }),
      screen.getByRole('group', { name: 'Tools' }),
      screen.getByRole('region', { name: 'Items' }),
      screen.getByRole('status'),
    ];
    let previous: HTMLElement | undefined;
    for (const element of order) {
      if (previous !== undefined) {
        expect(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }

      previous = element;
    }

    expect(root(container).getAttribute('data-ov-state')).toBe('ready');
  });

  it('is three rows: what is fixed above, the one body that takes what is left, and the footer', () => {
    const { container } = render(view());
    const parts = [...root(container).children].map((child) => child.getAttribute('data-ov-part'));
    expect(parts).toEqual(['header', 'body', 'footer']);
  });

  it('draws only what it is given: no header, no strip and no toolbar leave no empty band', () => {
    const { container } = render(view({ header: undefined, quickFilters: undefined, toolbar: undefined }));
    expect(container.querySelector('[data-ov-part="header"]')).toBeNull();
    expect([...root(container).children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['body', 'footer']);
  });

  it('leaves no controls band when both slots render null', () => {
    const { container } = render(view({ header: null, quickFilters: undefined, toolbar: null }));
    expect(container.querySelector('[data-ov-part="header"]')).toBeNull();
  });

  it('keeps search focus when a filter leaves no matching rows', () => {
    const { rerender } = render(view());
    const search = screen.getByRole('textbox', { name: 'Search items' });
    search.focus();
    rerender(view({ quickFilters: { ...FILTERS, selected: 'failed' }, state: { kind: 'no-match' } }));
    expect(screen.getByRole('button', { name: 'Failed 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(search);
  });

  it('keeps the quick filters and toolbar adjacent after the title, including when their shared line wraps', () => {
    const { container } = render(view());
    const blocks = [...container.querySelectorAll('[data-ov-part="header"] > [data-ov-block]')].map((block) => block.getAttribute('data-ov-block'));
    expect(blocks).toEqual(['top', 'filters', 'toolbar']);
  });

  it('shows the strip as the quick filters of the collection, and reports what is chosen', () => {
    const onSelect = vi.fn();
    render(view({ quickFilters: { ...FILTERS, onSelect } }));
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }));
    expect(onSelect).toHaveBeenCalledWith('failed');
    expect(screen.getByRole('button', { name: 'All 3' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the footer as the collection\'s count, in its own wording', () => {
    const { rerender } = render(view());
    expect(screen.getByRole('status').textContent).toBe('3 items');
    rerender(view({ footer: { ...FOOTER, shown: 1 } }));
    expect(screen.getByRole('status').textContent).toBe('1 of 3 items');
    rerender(view({ footer: { shown: 3, total: { kind: 'unknown' }, noun: 'item', plural: 'items' } }));
    expect(screen.getByRole('status').textContent).toBe('3 items loaded');
  });

  it('passes data attributes to its root and nothing else', () => {
    const { container } = render(view({ 'data-testid': 'collection' }));
    expect(screen.getByTestId('collection')).toBe(root(container));
  });

  it('passes the data attributes of its quick filters to the strip, and nothing else of what a caller adds to them', () => {
    // A caller in plain JavaScript (or a cast) can hand the strip more than its type says: only `data-*` reaches the element.
    const loose: Record<string, unknown> = { ...FILTERS, 'data-testid': 'strip', id: 'not-an-attribute-of-a-part' };
    render(view({ quickFilters: loose as unknown as typeof FILTERS }));

    expect(screen.getByTestId('strip')).toBe(screen.getByRole('group', { name: 'Item state' }));
    expect(screen.getByTestId('strip').hasAttribute('id')).toBe(false);
  });
});

describe('DataView, the rows', () => {
  it('names its one scroll region by the collection: the table is that region', () => {
    render(view());
    const region = screen.getByRole('region', { name: 'Items' });
    expect(within(region).getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('draws the rows it is given, with the columns it is given', () => {
    render(view());
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Status']);
    expect(within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['orders-api', 'orders-db', 'orders-queue']);
  });

  it('hands the table its own props: sorting, activation, line count, selection, immutability and a bounded height', () => {
    const onSortChange = vi.fn();
    const onRowActivate = vi.fn();
    const onToggle = vi.fn();
    const { container } = render(
      view({
        table: {
          rows: ITEMS,
          getRowKey: (row) => row.key,
          columns,
          lines: 2,
          sort: { column: 'name', direction: 'ascending' },
          onSortChange,
          onRowActivate,
          rowsAreImmutable: true,
          maxHeight: 320,
          selection: { selected: new Set(['b']), onToggle, label: (row) => `Select ${row.name}` },
        },
      }),
    );
    expect(screen.getByRole('region', { name: 'Items' }).getAttribute('data-ov-lines')).toBe('2');
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Status' })).getByRole('button'));
    expect(onSortChange).toHaveBeenCalledWith({ column: 'status', direction: 'ascending' });
    expect(screen.getByRole('checkbox', { name: 'Select orders-db' }).getAttribute('aria-checked') ?? (screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select orders-db' }).checked ? 'true' : 'false')).toBe('true');
    fireEvent.click(screen.getByText('orders-api'));
    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="region"]')?.getAttribute('style')).toContain('--_max-height: 320px');
  });
});

describe('DataView, loading (design 13 ES2, plan 1.4)', () => {
  const loading = () => render(view({ state: { kind: 'loading' }, footer: { shown: 0, total: { kind: 'unknown' }, noun: 'item', plural: 'items' } }));

  it('keeps the header, the strip, the toolbar and the footer, and puts the skeleton where the rows will be', () => {
    loading();
    expect(screen.getByRole('heading', { name: 'Items' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Item state' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByText('0 items loaded')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is a busy status named for what loads, in the one named region of the view', () => {
    loading();
    const skeleton = screen.getByRole('status', { name: 'Loading Items' });
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    const region = screen.getByRole('region', { name: 'Items' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.contains(skeleton)).toBe(true);
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('has the final column count: a head row of bars and eight rows, one bar for each column', () => {
    const { container } = loading();
    const rows = container.querySelectorAll('[data-ov-skeleton-row]');
    expect(rows).toHaveLength(9);
    expect(rows[0]?.hasAttribute('data-ov-head')).toBe(true);
    for (const row of rows) {
      expect(row.children).toHaveLength(2);
    }
  });

  it('counts the selection column when the table has one', () => {
    const { container } = render(view({ state: { kind: 'loading' }, table: { rows: [], getRowKey: (row) => row.key, columns, selection: { selected: new Set(), onToggle: () => undefined, label: (row) => row.name } } }));
    expect(container.querySelector('[data-ov-skeleton-row]')?.children).toHaveLength(3);
  });

  it('draws the same bars every time: a skeleton is a static placeholder, never a shimmer', () => {
    const first = loading();
    const widths = [...first.container.querySelectorAll<HTMLElement>('[data-ov-skeleton-row] > span')].map((bar) => bar.getAttribute('style'));
    first.unmount();
    const second = loading();
    expect([...second.container.querySelectorAll<HTMLElement>('[data-ov-skeleton-row] > span')].map((bar) => bar.getAttribute('style'))).toEqual(widths);
    // The mock's widths: 40 + ((row x 37 + column x 53) mod 51) percent, the head row's columns counted from 7 (core.js `H.skeleton`).
    expect(widths[0]).toBe('--_w: 54%;');
  });
});

describe('DataView, empty and filtered-empty (design 13 ES1, ES2, E9)', () => {
  it('keeps the table header and says one line: No items', () => {
    render(view({ state: { kind: 'empty' }, footer: { shown: 0, total: { kind: 'exact', value: 0 }, noun: 'item', plural: 'items' } }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Status']);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1);
    expect(screen.getByText('No Items')).toBeTruthy();
    expect(screen.getByText('0 items')).toBeTruthy();
  });

  it('says "No Items match" when a search or a filter hid every item, and the count says how many there were', () => {
    render(view({ state: { kind: 'no-match' }, footer: { shown: 0, total: { kind: 'exact', value: 24 }, noun: 'item', plural: 'items' } }));
    expect(screen.getByText('No Items match')).toBeTruthy();
    expect(screen.getByText('0 of 24 items')).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(2);
  });

  it('draws no Clear filters of its own: the toolbar supplies the one (E9)', () => {
    render(view({ state: { kind: 'no-match' } }));
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('says a hint under the empty line when it is given one', () => {
    render(view({ state: { kind: 'empty', hint: 'Items appear here when they are created.' } }));
    expect(screen.getByText('Items appear here when they are created.')).toBeTruthy();
  });

  it('announces the line, politely: it appears in answer to a search', () => {
    render(view({ state: { kind: 'no-match' } }));
    const line = screen.getByText('No Items match').closest('[role="status"]');
    expect(line).not.toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('shows rows for no row it is given: a state wins over the rows', () => {
    render(view({ state: { kind: 'empty' } }));
    expect(screen.queryByText('orders-api')).toBeNull();
  });

  it('keeps the table as the one named region of the view', () => {
    render(view({ state: { kind: 'no-match' } }));
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Items' }).contains(screen.getByRole('table'))).toBe(true);
  });
});

describe('DataView, a failure with no rows (design 15 5.8, 17 K18)', () => {
  const failed = (onRetry?: () => void, message?: string) => render(view({ state: { kind: 'error', onRetry, message } }));

  it('is one notice in place of the rows, an alert, that says what could not be loaded and why', () => {
    failed(undefined, 'The server did not answer.');
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Couldn\'t load Items')).toBeTruthy();
    expect(within(alert).getByText('The server did not answer.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers one Retry when there is a way to try again, and calls it', () => {
    const onRetry = vi.fn();
    failed(onRetry);
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })).toBe(retry);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry when there is nothing to retry with: a button that does nothing is a stub', () => {
    failed();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says it once and draws no footer: a failure that leaves no rows has no count to carry (the mock draws none)', () => {
    const { container } = render(view({ state: { kind: 'error', message: 'The server did not answer.', onRetry: vi.fn() } }));
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(container.querySelector('[data-ov-part="footer"]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect([...root(container).children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['header', 'body']);
  });

  it('marks the pane footless, so its bottom inset (12 px) is its own: the shell gives a pane none', () => {
    const { container, rerender } = render(view({ state: { kind: 'error' } }));
    expect(root(container).hasAttribute('data-ov-footless')).toBe(true);
    rerender(view());
    expect(root(container).hasAttribute('data-ov-footless')).toBe(false);
  });

  it('keeps the header, the strip and the toolbar, so the way back is where it was', () => {
    failed(vi.fn());
    expect(screen.getByRole('group', { name: 'Item state' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tools' })).toBeTruthy();
  });

  it('is in the one named region of the view', () => {
    failed(vi.fn());
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Items' }).contains(screen.getByRole('alert'))).toBe(true);
  });
});

const CARDS: CardGridContent<Item> = {
  items: ITEMS,
  getKey: (row) => row.key,
  renderCard: (row) => <ResourceCard title={row.name} status={<span>{row.status}</span>} actions={<button type="button">Open</button>} />,
};

const cardsView = (props: { readonly state?: DataViewState; readonly footer?: CollectionFooterProps } = {}) => (
  <DataView<Item>
    label="Items"
    header={<h1>Items</h1>}
    quickFilters={FILTERS}
    toolbar={<div role="group" aria-label="Tools"><input aria-label="Search items" /></div>}
    cards={CARDS}
    footer={props.footer ?? FOOTER}
    state={props.state}
  />
);

describe('DataView, cards (the mock\'s card view of the one collection)', () => {
  it('shows the cards under the same header, strip, toolbar and footer: the body is the one named region, and switching from the table draws the body again and nothing else', () => {
    const { container, rerender } = render(view());
    const [header, , footer] = [...root(container).children];
    expect(screen.getByRole('table')).toBeTruthy();

    rerender(cardsView());
    expect(root(container).getAttribute('data-ov-view')).toBe('cards');
    expect([...root(container).children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['header', 'body', 'footer']);
    expect([...root(container).children][0]).toBe(header);
    expect([...root(container).children][2]).toBe(footer);
    expect(screen.queryByRole('table')).toBeNull();

    const region = screen.getByRole('region', { name: 'Items' });
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(region.getAttribute('data-ov-part')).toBe('body');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(within(region).getByRole('list', { name: 'Items' })).getAllByRole('listitem').map((cell) => cell.textContent)).toEqual([
      'orders-apiRunningOpen',
      'orders-dbFailedOpen',
      'orders-queueRunningOpen',
    ]);
    expect(screen.getByRole('status').textContent).toBe('3 items');

    rerender(view());
    expect(root(container).getAttribute('data-ov-view')).toBe('table');
    expect([...root(container).children][0]).toBe(header);
    expect([...root(container).children][2]).toBe(footer);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('has the states of the table as cards: a busy skeleton of blocks, one line for nothing to list, and the notice with its Retry and no footer', () => {
    const onRetry = vi.fn();
    const { container, rerender } = render(cardsView({ state: { kind: 'loading' } }));
    const skeleton = screen.getByRole('status', { name: 'Loading Items' });
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[data-ov-skeleton-card]')).toHaveLength(8);
    expect(screen.getByRole('region', { name: 'Items' }).contains(skeleton)).toBe(true);

    rerender(cardsView({ state: { kind: 'empty', hint: 'Items appear here when they are created.' } }));
    expect(screen.getByText('No Items')).toBeTruthy();
    expect(screen.getByText('Items appear here when they are created.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();

    rerender(cardsView({ state: { kind: 'no-match' } }));
    expect(screen.getByText('No Items match')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();

    rerender(cardsView({ state: { kind: 'error', message: 'The server did not answer.', onRetry } }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-ov-part="footer"]')).toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('hands the footer its status and the table its row menu', () => {
    render(view({ footer: { ...FOOTER, status: { text: 'Refreshing…', busy: true } }, table: { rows: ITEMS, getRowKey: (row) => row.key, columns, rowMenu: 'row-menu' } }));
    expect(screen.getByText('Refreshing…').closest('[data-ov-part="footer"]')).not.toBeNull();
    const row = screen.getByText('orders-db').closest('tr');
    expect(row?.getAttribute('data-ov-menu')).toBe('row-menu');
    expect(row?.getAttribute('data-ov-menu-key')).toBe('b');
  });
});

describe('the examples of DataView', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for the rows and for every state', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['Cards', 'CardsEmpty', 'CardsFailure', 'CardsFilteredEmpty', 'CardsLoading', 'CardsRefreshing', 'Empty', 'Failure', 'FailureWithoutRetry', 'FilteredEmpty', 'Loaded', 'Loading', 'Ready', 'SwitchingViews'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with the view's one named region and its count`, () => {
      const { container } = render(<Example />);
      // The groups of cards are regions of their own: the view's one scroll region is the one named for the collection.
      expect(screen.getAllByRole('region', { name: 'Items' }).length).toBe(1);
      expect(container.querySelector('[title]')).toBeNull();
      expect(container.querySelector('[data-ov-part="footer"]') === null).toBe(name === 'Failure' || name === 'FailureWithoutRetry' || name === 'CardsFailure');
    });
  }
});

const css = await readFile(path.join(import.meta.dirname, 'DataView.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the DataView stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the pane: three rows, the header and the footer as tall as they are and the body the rest, filling its parent and shrinking inside it', () => {
    expect(rule('.root')).toMatchObject({
      display: 'grid',
      'grid-template-rows': 'auto minmax(0, 1fr) auto',
      height: '100%',
      'min-width': '0',
      'min-height': '0',
      'box-sizing': 'border-box',
    });
  });

  it('is 12 px shorter without a footer: the inset a footer-less pane keeps at the bottom (the mock\'s `padding-block-end` of its content)', () => {
    expect(rule('.root[data-ov-footless]')).toMatchObject({ height: 'calc(100% - var(--ov-spacing-12))' });
  });

  it('fits the controls in one wrapping line below the full-width title, leaving 8 px before the table', () => {
    expect(rule('.header')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: 'var(--ov-spacing-8) var(--ov-spacing-12)', 'padding-block-end': 'var(--ov-spacing-8)' });
    expect(rule('.top')['flex-basis']).toBe('100%');
    expect(rule('.filters')).toMatchObject({ 'margin-inline-end': 'auto', 'max-width': '100%' });
    expect(rule('.toolbar')).toMatchObject({ width: 'max-content', 'min-width': 'min(280px, 100%)', 'max-width': '100%' });
  });

  it('is a body that holds its table: it never scrolls itself, the table\'s region does', () => {
    expect(rule('.body')).toMatchObject({ 'min-width': '0', 'min-height': '0', overflow: 'hidden' });
    expect(rule('.body[role=\'region\']')).toMatchObject({ overflow: 'auto', 'overscroll-behavior': 'contain' });
  });

  it('keeps the table\'s header over the empty line: a grid of the header as tall as it is and the line under it', () => {
    expect(rule('.tableState')).toMatchObject({ display: 'grid', 'grid-template-rows': 'auto minmax(0, 1fr)', height: '100%', 'min-height': '0' });
  });

  describe('the skeleton (the mock\'s static placeholder)', () => {
    it('is a grid of rows: a head row of the header\'s height with a subtle line under it, and rows of the row height, 12 px apart', () => {
      expect(rule('.skeletonRow')).toMatchObject({
        display: 'grid',
        'grid-template-columns': 'repeat(var(--_cols, 1), minmax(0, 1fr))',
        'align-items': 'center',
        gap: 'var(--ov-spacing-12)',
        'padding-inline': 'var(--ov-spacing-12)',
        'min-height': 'var(--ov-row-height)',
      });
      expect(rule('.skeletonRow[data-ov-head]')).toMatchObject({ 'min-height': 'var(--ov-table-header-height)', 'border-bottom': '1px solid var(--ov-border-subtle)' });
    });

    it('draws each bar 8 px high, rounded, on the progress track colour, to a width that is a data parameter', () => {
      expect(rule('.skeletonRow > span')).toMatchObject({ display: 'block', width: 'var(--_w, 60%)', height: '8px', 'border-radius': 'var(--ov-radius-mark)', 'background-color': 'var(--ov-progress-track)' });
    });

    it('appears after 250 ms, so a fast read never flashes one, and at once under reduced motion', () => {
      expect(rule(':where(:root:not([data-ov-motion=\'reduced\'])) .skeleton')).toMatchObject({ visibility: 'hidden', animation: 'reveal 0s linear 250ms forwards' });
      expect(css).toMatch(/@keyframes\s+reveal\s*\{\s*to\s*\{\s*visibility:\s*visible;?\s*\}\s*\}/);
      expect(declarationsOf(css, ':where(:root:not([data-ov-motion=\'normal\'])) .skeleton', 'prefers-reduced-motion: reduce')).toMatchObject({ visibility: 'visible', animation: 'none' });
    });
  });

  describe('the empty line (the mock\'s empty block)', () => {
    it('is a centred column of 8 px, at least 96 px high, 24 px and 12 px of padding, muted, wrapping', () => {
      expect(rule('.empty')).toMatchObject({
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: 'var(--ov-spacing-8)',
        'min-height': '96px',
        padding: 'var(--ov-spacing-24) var(--ov-spacing-12)',
        color: 'var(--ov-fg-muted)',
        'text-align': 'center',
        'white-space': 'normal',
        'align-self': 'start',
      });
    });

    it('sets its title in the plain colour, 13 px semibold, and its hint no wider than 64 characters', () => {
      expect(rule('.empty > b')).toMatchObject({ color: 'var(--ov-fg)', 'font-size': 'var(--ov-fs-13)', 'font-weight': '600' });
      expect(rule('.empty > span')['max-width']).toBe('64ch');
    });
  });

  describe('the notice of a failure (the mock\'s error notice, flush)', () => {
    it('stands in a column at least 160 px high, with the notice at the centre of it', () => {
      expect(rule('.failure')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'min-height': '160px' });
    });

    it('is an error notice: an 8 px and 12 px padding, a 1 px error border, 4 px radius, the error fill, wrapping, 8 px apart, with no margin', () => {
      expect(rule('.notice')).toMatchObject({
        display: 'flex',
        'flex-wrap': 'wrap',
        'align-items': 'center',
        gap: 'var(--ov-spacing-8)',
        padding: 'var(--ov-spacing-8) var(--ov-spacing-12)',
        border: '1px solid var(--ov-error-border)',
        'border-radius': 'var(--ov-radius-control)',
        'background-color': 'var(--ov-error-bg)',
        color: 'var(--ov-fg)',
        margin: '0',
      });
    });

    it('lays out its glyph, its message and its command: the message takes the room, the command goes to the end', () => {
      expect(rule('.noticeBody')).toMatchObject({ flex: '1 1 200px', 'min-width': '0' });
      expect(rule('.noticeAction')).toMatchObject({ 'margin-inline-start': 'auto' });
    });
  });

  it('uses only tokens for colour and type, and no hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });
});
