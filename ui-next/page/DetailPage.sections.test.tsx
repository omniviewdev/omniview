import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailPageDefinition, DetailSection, DetailSource, DetailView } from './detailDefinition';
import { DetailPage } from './DetailPage';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view, and it has no canvas to measure text on.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// A section is the plugin's data and the plugin's cells, and an Overview is the aggregate of independent reads: one section that cannot be drawn is that section's failure, said in its own card, and the page's header, its summary and every
// other section stay (S2 of the review of HM3b). The page is plugin-agnostic, so the tests are too: an invented widget in an invented bay.

const definition: DetailPageDefinition = {
  kind: 'Widget',
  tile: { icon: 'box' },
  identity: { name: 'name' },
  tabs: [{ id: 'overview', label: 'Overview' }],
};

type Bay = { readonly key: string; readonly name: string };
const BAYS: readonly Bay[] = [
  { key: 'b1', name: 'north bay' },
  { key: 'b2', name: 'south bay' },
];

/** What the cell of the Bays table does: it throws while the test says the plugin's code is broken. */
const plugin = { broken: true };

const columns = [
  {
    id: 'name',
    header: 'Name',
    fit: 'flex' as const,
    width: 160,
    text: (row: Bay) => row.name,
    cell: (row: Bay) => {
      if (plugin.broken) {
        throw new Error('SECRET the cell of the plugin');
      }

      return row.name;
    },
  },
];

const bays: DetailSection = { id: 'bays', kind: 'table', title: 'Bays', columns, rows: BAYS, getRowKey: (row: Bay) => row.key };
const details: DetailSection = { id: 'details', kind: 'kv', title: 'Details', rows: [{ label: 'Site', value: 'north' }] };
const recent: DetailSection = { id: 'recent', kind: 'list', title: 'Recent', rows: [{ id: 'moved', title: 'lathe-4 was moved', detail: 'Two days ago', meta: '2' }] };

const viewOf = (sections: readonly DetailSection[]): DetailView => ({
  state: { role: 'running', label: 'Running' },
  tabs: { overview: { kind: 'overview', summary: [{ value: '2', label: 'bays' }], sections } },
});

const sourceOf = (sections: readonly DetailSection[]): DetailSource => ({ state: { kind: 'ready' }, view: viewOf(sections), refreshing: false, refresh: async () => undefined });

const page = (sections: readonly DetailSection[]) => <DetailPage definition={definition} params={{ name: 'lathe-4' }} source={sourceOf(sections)} />;

const section = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-detail-section="${id}"]`);
  if (found === null) {
    throw new Error(`the page draws no section "${id}"`);
  }

  return found;
};

/** What stays when one section cannot be drawn: the header, the summary, and each section that was fine, drawn. */
function expectTheRestStays(): void {
  expect(screen.getByRole('heading', { level: 1, name: 'lathe-4' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'lathe-4 status' })).toHaveTextContent('2');
  expect(within(section('details')).getByText('north')).toBeInTheDocument();
  expect(within(section('recent')).getByRole('list', { name: 'Recent' })).toHaveTextContent('lathe-4 was moved');
}

beforeEach(() => {
  plugin.broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a section whose cell throws', () => {
  it('says that it failed in its own card, in the page\'s words and none of the plugin\'s, and the header, the summary and the other sections stay', () => {
    render(page([details, bays, recent]));

    expectTheRestStays();
    const card = within(section('bays'));
    expect(card.getByRole('heading', { level: 2, name: 'Bays' })).toBeInTheDocument();
    expect(card.getByRole('alert')).toHaveTextContent('Bays failed to display.');
    expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Only that card says it failed: nothing else on the page is an alert, and the plugin's own words stay in the log.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('SECRET');
    expect(console.error).toHaveBeenCalledWith('[page] section bays failed to render', expect.any(Error), expect.any(String));
  });

  it('is in its column and in its place among the sections, as the one it stands for was', () => {
    render(page([details, { ...bays, priority: 10 }, recent]));

    expect([...document.querySelectorAll('[data-detail-section]')].map((card) => card.getAttribute('data-detail-section'))).toEqual(['bays', 'details', 'recent']);
  });

  it('draws it again on Retry once what threw works, and draws no other section again', () => {
    render(page([details, bays, recent]));
    const kept = section('details');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    plugin.broken = false;
    fireEvent.click(within(section('bays')).getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(section('bays')).getByRole('region', { name: 'Bays' })).toHaveTextContent('south bay');
    expectTheRestStays();
    expect(section('details')).toBe(kept);
  });

  it('says it again, and offers Retry again, when Retry finds the cell still throwing', () => {
    render(page([details, bays, recent]));

    fireEvent.click(within(section('bays')).getByRole('button', { name: 'Retry' }));

    expect(within(section('bays')).getByRole('alert')).toHaveTextContent('Bays failed to display.');
    expect(within(section('bays')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expectTheRestStays();
  });

  it('tries again by itself when the plugin gives the section anew: a read that works after one that did not needs no press', () => {
    const { rerender } = render(page([details, bays, recent]));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    plugin.broken = false;
    rerender(page([details, { ...bays }, recent]));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(section('bays')).getByRole('region', { name: 'Bays' })).toHaveTextContent('north bay');
  });

  it('keeps saying it while the plugin gives the section anew and it still throws, and logs each failure', () => {
    const { rerender } = render(page([details, bays, recent]));

    rerender(page([details, { ...bays }, recent]));

    expect(within(section('bays')).getByRole('alert')).toHaveTextContent('Bays failed to display.');
    expectTheRestStays();
    expect(vi.mocked(console.error).mock.calls.filter(([said]) => said === '[page] section bays failed to render')).toHaveLength(2);
  });

  it('says it in the aside when the section it stands for was there, and the main column stays', () => {
    render(page([details, { id: 'broken', kind: 'list', title: 'Broken', placement: 'aside', rows: undefined } as unknown as DetailSection, recent]));

    const aside = within(screen.getByRole('group', { name: 'Side sections' }));
    expect(aside.getByRole('alert')).toHaveTextContent('Broken failed to display.');
    expectTheRestStays();
  });
});

describe('a section whose data is not what its kind says', () => {
  const malformed: ReadonlyArray<readonly [string, DetailSection]> = [
    ['a key-value section with no rows', { id: 'broken', kind: 'kv', title: 'Broken', rows: undefined } as unknown as DetailSection],
    ['a table with no rows', { id: 'broken', kind: 'table', title: 'Broken', columns, rows: undefined, getRowKey: (row: Bay) => row.key } as unknown as DetailSection],
    ['a list with no rows', { id: 'broken', kind: 'list', title: 'Broken', rows: undefined } as unknown as DetailSection],
    ['a list whose rows are not a list', { id: 'broken', kind: 'list', title: 'Broken', rows: { length: 1 } } as unknown as DetailSection],
    ['a tags section with no items', { id: 'broken', kind: 'tags', title: 'Broken', items: undefined } as unknown as DetailSection],
  ];

  it.each(malformed)('says that %s failed in its own card, and the header, the summary and the other sections stay', (_name, broken) => {
    render(page([details, broken, recent]));

    expectTheRestStays();
    const card = within(section('broken'));
    expect(card.getByRole('heading', { level: 2, name: 'Broken' })).toBeInTheDocument();
    expect(card.getByRole('alert')).toHaveTextContent('Broken failed to display.');
    expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('says it failed in words of the page\'s own when its title is not text, and does not draw the title', () => {
    render(page([details, { id: 'broken', kind: 'list', title: { secret: true }, rows: [{ id: 'one', title: 'x' }] } as unknown as DetailSection, recent]));

    expectTheRestStays();
    expect(within(section('broken')).getByRole('alert')).toHaveTextContent('This section failed to display.');
  });

  it('leaves out what is no section at all, as it leaves out a kind it does not know, and draws the others', () => {
    render(page([details, null, undefined, 7, { id: 'chart', kind: 'chart', title: 'Chart' }, recent] as unknown as readonly DetailSection[]));

    expectTheRestStays();
    expect(document.querySelectorAll('[data-detail-section]')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
