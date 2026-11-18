import { describe, expect, it, vi } from 'vitest';
import type { DetailPageDefinition, DetailSection, DetailSource, DetailState, DetailView } from './detailDefinition';
import { DEFAULT_PRIORITY, deriveDetailModel, hasContent, overviewColumns } from './detailView';

// The page is plugin-agnostic, so the tests are too: an invented widget in an invented bay.
const definition: DetailPageDefinition = {
  kind: 'Widget',
  tile: { icon: 'box', tone: 'blue' },
  identity: { name: 'name', facets: ['bay'] },
  list: { page: 'widgets', label: 'Widgets' },
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'parts', label: 'Parts' },
  ],
};

const params = { name: 'lathe-4', bay: 'north' };

const view = (over: Partial<DetailView> = {}): DetailView => ({
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'Widget' }, { text: 'north' }],
  counts: { parts: 3 },
  tabs: { overview: { kind: 'overview', sections: [] }, parts: { kind: 'custom', content: 'the parts' } },
  ...over,
});

const source = (state: DetailState, shown?: DetailView, over: Partial<DetailSource> = {}): DetailSource => ({
  state,
  view: shown,
  refreshing: false,
  refresh: async () => undefined,
  ...over,
});

const model = (given: DetailSource, tab: string | undefined = undefined, route: Record<string, unknown> = params) => deriveDetailModel(definition, route, given, { tab });

describe('deriveDetailModel: the header and the strip are the route\'s and the definition\'s', () => {
  it('names the object by the route and draws the strip before any data is read', () => {
    const loading = model(source({ kind: 'loading' }));

    expect(loading.name).toBe('lathe-4');
    expect(loading.heading).toBe('lathe-4');
    expect(loading.tabs.map((tab) => [tab.id, tab.label, tab.count])).toEqual([
      ['overview', 'Overview', undefined],
      ['parts', 'Parts', undefined],
    ]);
    expect(loading.selected).toBe('overview');
    expect(loading.shown).toBe(false);
  });

  it('shows a progress word and the kind as its fact while the object is on its way, so the identity line is there from the first frame', () => {
    const loading = model(source({ kind: 'loading' }));

    expect(loading.state).toEqual({ role: 'progress', label: 'Loading' });
    expect(loading.facts).toEqual([{ text: 'Widget' }]);
    expect(loading.commands).toBeUndefined();
    expect(loading.body).toEqual({ kind: 'loading', label: 'lathe-4' });
  });

  it('takes the state, the facts, the commands and the counts from the object once it is read', () => {
    const run = vi.fn();
    const ready = model(source({ kind: 'ready' }, view({ commands: { primary: { id: 'run', label: 'Run', onSelect: run } } })));

    expect(ready.shown).toBe(true);
    expect(ready.state).toEqual({ role: 'running', label: 'Running' });
    expect(ready.facts).toEqual([{ text: 'Widget' }, { text: 'north' }]);
    expect(ready.commands?.primary?.label).toBe('Run');
    expect(ready.tabs.find((tab) => tab.id === 'parts')?.count).toBe(3);
  });

  it('makes the kind the one fact when the plugin gives neither a state nor a fact, and leaves a state alone', () => {
    expect(model(source({ kind: 'ready' }, view({ state: undefined, facts: undefined }))).facts).toEqual([{ text: 'Widget' }]);
    expect(model(source({ kind: 'ready' }, view({ state: undefined, facts: [] }))).facts).toEqual([{ text: 'Widget' }]);
    expect(model(source({ kind: 'ready' }, view({ facts: undefined }))).facts).toEqual([]);
  });

  it('is the kind alone for a route with no name', () => {
    const nameless = model(source({ kind: 'not-found' }), undefined, { bay: 'north' });

    expect(nameless.name).toBe('');
    expect(nameless.heading).toBe('Widget');
    expect(nameless.body).toMatchObject({ kind: 'not-found', title: 'Widget was not found', hint: 'Widget doesn\'t exist here. It may have been deleted.' });
  });

  it('opens the tab asked for when the definition has it, and the first when it has not', () => {
    const ready = source({ kind: 'ready' }, view());

    expect(model(ready, 'parts').selected).toBe('parts');
    expect(model(ready, 'parts').body).toEqual({ kind: 'tab', tab: 'parts', content: { kind: 'custom', content: 'the parts' } });
    expect(model(ready, 'gone').selected).toBe('overview');
    expect(model(ready).selected).toBe('overview');
  });

  it('shows nothing in a tab the view has no content for', () => {
    expect(model(source({ kind: 'ready' }, view({ tabs: {} }))).body).toEqual({ kind: 'tab', tab: 'overview', content: undefined });
  });
});

describe('deriveDetailModel: the states', () => {
  it('words not found, denied and a failure in the page\'s own words, with the plugin\'s detail under them', () => {
    expect(model(source({ kind: 'not-found' })).body).toEqual({ kind: 'not-found', title: 'lathe-4 was not found', hint: 'Widget lathe-4 doesn\'t exist here. It may have been deleted.' });
    expect(model(source({ kind: 'not-found', message: 'It was retired in May.' })).body).toMatchObject({ hint: 'It was retired in May.' });
    expect(model(source({ kind: 'denied' })).body).toEqual({ kind: 'denied', title: 'Access to lathe-4 is denied', message: 'You don\'t have permission to read it.' });
    expect(model(source({ kind: 'denied', message: 'Ask the bay owner.' })).body).toMatchObject({ message: 'Ask the bay owner.' });
    const retry = vi.fn();
    expect(model(source({ kind: 'failed', message: 'The read timed out.', retry })).body).toEqual({ kind: 'failed', title: 'Couldn\'t load lathe-4', message: 'The read timed out.', retry });
  });

  it('offers a Retry only when the plugin gave one', () => {
    const body = model(source({ kind: 'failed' })).body;

    expect(body).toMatchObject({ kind: 'failed', retry: undefined });
  });

  it('keeps the header, the strip and the tab\'s own state in every one of them: only the body changes', () => {
    const states: DetailState[] = [{ kind: 'loading' }, { kind: 'not-found' }, { kind: 'denied' }, { kind: 'failed' }];
    for (const state of states) {
      const shown = model(source(state));
      expect(shown.tabs.map((tab) => tab.id)).toEqual(['overview', 'parts']);
      expect(shown.heading).toBe('lathe-4');
      expect(shown.facts).toEqual([{ text: 'Widget' }]);
    }
  });

  it('does not take away what was shown when a failure follows it, and does when the object is gone or may not be read', () => {
    const shown = view();

    expect(model(source({ kind: 'failed', message: 'Offline' }, shown)).shown).toBe(true);
    expect(model(source({ kind: 'failed', message: 'Offline' }, shown)).body.kind).toBe('tab');
    expect(model(source({ kind: 'not-found' }, shown)).shown).toBe(false);
    expect(model(source({ kind: 'not-found' }, shown)).body.kind).toBe('not-found');
    expect(model(source({ kind: 'denied' }, shown)).body.kind).toBe('denied');
  });

  it('is loading while a source says ready and has no view yet, and a progress word for the same reason', () => {
    const early = model(source({ kind: 'ready' }));

    expect(early.body.kind).toBe('loading');
    expect(early.state).toEqual({ role: 'progress', label: 'Loading' });
  });

  it('hands the plugin\'s own operation to the header, and nothing when it has none', () => {
    const operation = { title: 'Restart', state: 'running', text: 'Restarting', progress: 'indeterminate' } as const;

    expect(model(source({ kind: 'ready' }, view({ operation }))).operation).toBe(operation);
    expect(model(source({ kind: 'ready' }, view())).operation).toBeUndefined();
  });

  it('reports a read that failed after the object was shown, with the plugin\'s words and Retry, and keeps what was shown', () => {
    const retry = vi.fn();
    const failed = model(source({ kind: 'failed', message: 'The read timed out.', retry }, view()));

    expect(failed.failure).toEqual({ title: 'Couldn\'t refresh lathe-4', message: 'The read timed out.', retry });
    expect(failed.shown).toBe(true);
    expect(failed.body.kind).toBe('tab');
  });

  it('has no failure to report while the object is read, loading, gone or denied, and none for a failure that left nothing to show (its body is that failure)', () => {
    for (const state of [{ kind: 'ready' }, { kind: 'loading' }, { kind: 'not-found' }, { kind: 'denied' }] as const) {
      expect(model(source(state, view())).failure, state.kind).toBeUndefined();
    }

    expect(model(source({ kind: 'failed', message: 'Offline' })).failure).toBeUndefined();
  });
});

const kv = (id: string, over: Partial<Extract<DetailSection, { kind: 'kv' }>> = {}): DetailSection => ({ id, kind: 'kv', title: id, rows: [{ label: 'A', value: 'b' }], ...over });

describe('hasContent: a section that has nothing to say is not drawn', () => {
  it('is false for no rows, no items, and a kind this version does not know', () => {
    expect(hasContent(kv('a', { rows: [] }))).toBe(false);
    expect(hasContent({ id: 't', kind: 'table', title: 't', columns: [], rows: [], getRowKey: () => '' })).toBe(false);
    expect(hasContent({ id: 'l', kind: 'list', title: 'l', rows: [] })).toBe(false);
    expect(hasContent({ id: 'g', kind: 'tags', title: 'g', items: [] })).toBe(false);
    expect(hasContent({ id: 'x', kind: 'chart', title: 'x', rows: [{}] } as unknown as DetailSection)).toBe(false);
  });

  it('is true for one row, one item', () => {
    expect(hasContent(kv('a'))).toBe(true);
    expect(hasContent({ id: 'g', kind: 'tags', title: 'g', items: [{ key: 'a' }] })).toBe(true);
    expect(hasContent({ id: 'l', kind: 'list', title: 'l', rows: [{ id: 'r', title: 'r' }] })).toBe(true);
    expect(hasContent({ id: 't', kind: 'table', title: 't', columns: [], rows: [{}], getRowKey: () => '' })).toBe(true);
  });
});

describe('overviewColumns', () => {
  const ids = (sections: readonly DetailSection[]) => sections.map((section) => section.id);

  it('puts a section in the column it asks for, the main column by default', () => {
    const columns = overviewColumns([kv('a'), kv('b', { placement: 'aside' }), kv('c', { placement: 'main' })]);

    expect(ids(columns.main)).toEqual(['a', 'c']);
    expect(ids(columns.aside)).toEqual(['b']);
  });

  it('orders each column by priority, lowest first, and keeps the order given among equals', () => {
    const columns = overviewColumns([kv('a', { priority: 30 }), kv('b'), kv('c', { priority: 10 }), kv('d', { priority: 30 }), kv('e', { priority: DEFAULT_PRIORITY }), kv('f', { priority: 10 })]);

    // Lowest first: 10, 10, 30, 30, then the two of the default 50; each pair keeps the order it was given in.
    expect(ids(columns.main)).toEqual(['c', 'f', 'a', 'd', 'b', 'e']);
  });

  it('leaves out the sections with nothing to say, so the other sections close the gap', () => {
    const columns = overviewColumns([kv('a'), kv('b', { rows: [] }), kv('c', { placement: 'aside', rows: [] }), kv('d')]);

    expect(ids(columns.main)).toEqual(['a', 'd']);
    expect(columns.aside).toEqual([]);
  });

  it('never puts a table in the aside: a table there would scroll sideways', () => {
    const table = { id: 't', kind: 'table', title: 't', placement: 'aside', columns: [], rows: [{}], getRowKey: () => '' } as unknown as DetailSection;
    const columns = overviewColumns([table]);

    expect(ids(columns.main)).toEqual(['t']);
    expect(columns.aside).toEqual([]);
  });

  it('draws no aside at all when no section asks for one', () => {
    expect(overviewColumns([kv('a'), kv('b')]).aside).toEqual([]);
  });
});
