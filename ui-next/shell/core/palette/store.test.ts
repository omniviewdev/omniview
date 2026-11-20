import { describe, expect, it } from 'vitest';
import { LIMITS, type Candidate, type PaletteState, type Provider, type SearchScope } from './types';
import { createPaletteStore, seedChips } from './store';
import { command, commands, makePalette, page, resource, type Fixture } from './testing';

// The palette's store over the providers of a small world (ch16 section D, SE1): what a query shows and in which order, the kinds and their prefixes, the chips, the empty and the
// no-result states. A row is read as data; the DOM is nowhere. The async half has its own file (`async.test.ts`), what a row does when it is chosen is `activate.test.ts`.

const rows = (f: Fixture): PaletteState['rows'] => f.palette.getSnapshot().rows;
const titles = (f: Fixture): string[] => rows(f).map((row) => row.title.text);
const sections = (f: Fixture): string[] => f.palette.getSnapshot().sections.map((section) => section.id);
const state = (f: Fixture): PaletteState => f.palette.getSnapshot();

const pagesOf = (names: readonly string[], extra: Partial<Candidate> = {}): Candidate[] => names.map((name) => page(name.toLowerCase().replaceAll(' ', '-'), name, extra));

function tabsProvider(f: Fixture): Provider {
  return {
    id: 'host:tabs',
    plugin: 'host',
    pluginName: 'Omniview',
    title: 'Tabs',
    section: 'tabs',
    match: () => f.tabs.state().order.map((id) => ({ id, kind: 'tab', title: f.tabs.state().tabs[id]?.face.title ?? '?', tab: id, context: 'Window 1', matchContext: '', route: f.tabs.state().tabs[id]?.location.route })),
  };
}

const cloudPages: Candidate[] = [
  { id: 'home', kind: 'home', title: 'Cloud', context: 'Compute', keywords: 'cloud', icon: 'server', route: { plugin: 'cloud', contribution: 'instances' } },
  page('instances', 'Instances', { context: 'Cloud · Compute', icon: 'server' }),
  page('volumes', 'Volumes', { context: 'Cloud · Storage', icon: 'server' }),
  page('buckets', 'Buckets', { context: 'Cloud · Storage', icon: 'server' }),
  page('charts', 'Charts', { context: 'Helm' }),
];

const cloud = (match: Provider['match'] = () => cloudPages): Provider => ({ id: 'cloud:pages', plugin: 'cloud', pluginName: 'Cloud', pluginIcon: 'server', title: 'Pages', section: 'goto', match });
const host = (match: Provider['match']): Provider => ({ id: 'host:commands', plugin: 'host', pluginName: 'Omniview', title: 'Commands', section: 'commands', match });
const settings = (match: Provider['match']): Provider => ({ id: 'host:settings', plugin: 'host', pluginName: 'Omniview', title: 'Settings', section: 'settings', match });

describe('registering providers', () => {
  it('takes a provider with one way to answer, and gives back the way to withdraw it', () => {
    const f = makePalette();
    const taken = f.palette.registerProvider(cloud());
    expect(taken).toMatchObject({ ok: true, reason: '' });
    f.palette.open();
    expect(titles(f)).toEqual(['Cloud']);
    taken.remove();
    expect(titles(f)).toEqual([]);
  });

  it('refuses a provider that has no id, no plugin, both ways to answer, or none, and says why', () => {
    const f = makePalette();
    const good = cloud();
    const refusals = [
      { ...good, id: '' },
      { ...good, plugin: '' },
      { ...good, search: async () => Promise.resolve([]) },
      { ...good, match: undefined },
      { ...good, section: 'planets' },
    ];
    for (const bad of refusals) {
      const result = f.palette.registerProvider(bad as unknown as Provider);
      expect(result.ok).toBe(false);
      expect(result.reason).not.toBe('');
      expect(() => {
        result.remove();
      }).not.toThrow();
    }
  });

  it('gives an asynchronous provider a section of its own: it may not put its late rows into Go to (S68)', () => {
    const f = makePalette();
    const search = async (): Promise<Candidate[]> => Promise.resolve([]);
    expect(f.palette.registerProvider({ id: 'stack:r', plugin: 'stack', section: 'goto', search }).ok).toBe(false);
    expect(f.palette.registerProvider({ id: 'stack:r', plugin: 'stack', section: { id: 'resources', title: 'Resources' }, search }).ok).toBe(true);
  });

  it('replaces a provider registered again under its id', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [page('a', 'First')]));
    f.palette.registerProvider(cloud(() => [page('b', 'Second')]));
    f.palette.open({ kind: 'goto' });
    expect(titles(f)).toEqual(['Second']);
  });

  it('withdraws every provider of a plugin that left, with what they answered, in one change (PO1)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.registerProvider(host(() => [command('x', 'Reopen closed tab')]));
    f.palette.open();
    f.palette.setQuery('o');
    expect(titles(f)).toContain('Volumes');
    expect(titles(f)).toContain('Reopen closed tab');
    let heard = 0;
    f.palette.subscribe(() => {
      heard += 1;
    });
    expect(f.palette.removePlugin('cloud')).toBe(true);
    expect(heard).toBe(1);
    expect(f.palette.removePlugin('cloud')).toBe(false);
    expect(titles(f)).toEqual(['Reopen closed tab']);
  });
});

describe('an empty query (S73)', () => {
  it('shows the plugin homes and nothing that cannot open, and says nothing it did not match', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [...cloudPages, page('off', 'Disabled page', { unavailable: 'Cloud is disabled in Plugins' })]));
    f.palette.registerProvider(host(() => [command('x', 'Reopen closed tab')]));
    f.palette.open();
    expect(sections(f)).toEqual(['goto']);
    expect(titles(f)).toEqual(['Cloud']);
    expect(state(f).note).toBeUndefined();
    expect(state(f).kind).toBe('all');
  });

  it('shows Recent first, without the place the user is on', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes', context: 'Cloud · Storage' });
    f.palette.record({ route: { plugin: 'cloud', contribution: 'buckets' }, title: 'Buckets', context: 'Cloud · Storage' });
    f.palette.open();
    expect(sections(f)).toEqual(['recent', 'goto']);
    expect(titles(f)).toEqual(['Buckets', 'Volumes', 'Cloud']);
    f.palette.close();
    f.palette.open({ current: { plugin: 'cloud', contribution: 'buckets', params: {} } });
    expect(titles(f)).toEqual(['Volumes', 'Cloud']);
  });

  it('leaves out a recent that cannot open now', () => {
    const f = makePalette();
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes' });
    f.tabs.world.report('cloud', { state: 'unavailable', reason: 'Cloud is disabled in Plugins' });
    f.palette.open();
    expect(titles(f)).toEqual([]);
    expect(state(f).note).toEqual({ type: 'nothing' });
  });

  it('shows what a kind holds when a kind is chosen, as the provider gave it, without ranking it', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.open({ kind: 'goto' });
    expect(titles(f)).toEqual(['Cloud', 'Instances', 'Volumes', 'Buckets', 'Charts']);
    f.palette.setKind('commands');
    expect(state(f).total).toBe(0);
  });

  it('lists the commands that can run when the Commands kind is chosen, and not the ones that cannot', () => {
    const f = makePalette();
    f.palette.registerProvider(host(() => [command('a', 'Reopen closed tab'), command('b', 'Close split view', { unavailable: 'The window is not split' }), command('c', 'Toggle panel')]));
    f.palette.open({ kind: 'commands' });
    expect(titles(f)).toEqual(['Reopen closed tab', 'Toggle panel']);
  });
});

describe('a query (S68, SE1)', () => {
  it('ranks within a section and cuts each label at what matched', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.open();
    f.palette.setQuery('inst');
    const [first] = rows(f);
    expect(first?.title.text).toBe('Instances');
    expect(first?.title.parts).toEqual([{ text: 'Inst', match: true }, { text: 'ances', match: false }]);
    expect(first?.context.text).toBe('Cloud · Compute');
    expect(state(f).query).toBe('inst');
  });

  it('puts the section that holds the best match first, and equal sections in the order Tabs, Go to, Commands, Settings (SE1)', () => {
    const f = makePalette();
    f.tabs.open({ route: { plugin: 'cloud', contribution: 'charts' } });
    f.palette.registerProvider(tabsProvider(f));
    f.palette.registerProvider(cloud(() => [page('charts', 'Charts', { context: 'Helm' })]));
    f.palette.registerProvider(host(() => [command('i', 'Install chart')]));
    f.palette.registerProvider(settings(() => [{ id: 's', kind: 'setting', title: 'Chart colours', route: { plugin: 'host', contribution: 'settings' } }]));
    f.palette.open();
    f.palette.setQuery('cart');
    // Every title holds the letters of cart inside one word and none starts with them: the sections tie, and keep their order.
    expect(sections(f)).toEqual(['tabs', 'goto', 'commands', 'settings']);
    // A prefix of a title leads over a title that holds the query in the middle: the Commands section falls behind the others.
    f.palette.setQuery('chart');
    expect(sections(f)).toEqual(['tabs', 'goto', 'settings', 'commands']);
    // Only one title holds it at all.
    f.palette.setQuery('colo');
    expect(sections(f)).toEqual(['settings']);
  });

  it('puts a prefix match on a name before a match in a command title, whatever section holds it (review pack 30: cart before Charts)', () => {
    const f = makePalette();
    f.palette.registerProvider(host(() => [command('i', 'Install chart')]));
    f.palette.registerProvider(cloud(() => [page('charts', 'Charts', { context: 'Helm' })]));
    f.palette.registerProvider({ id: 'stack:names', plugin: 'stack', pluginName: 'Stack', section: { id: 'names', title: 'Resources' }, match: () => [resource('cart-api', 'cart-api')] });
    f.palette.open();
    f.palette.setQuery('cart');
    expect(sections(f)).toEqual(['stack:names', 'goto', 'commands']);
    expect(state(f).active).toBe(rows(f)[0]?.id);
    expect(rows(f)[0]?.title.text).toBe('cart-api');
  });

  it('shows no row for what no word of the query matches, and every word must match (AND)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.open();
    f.palette.setQuery('cloud storage');
    expect(titles(f)).toEqual(['Volumes', 'Buckets']);
    f.palette.setQuery('cloud nothing');
    expect(state(f).total).toBe(0);
  });

  it('ranks the unavailable like the rest once a query matches them, and says what they are (S73)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [page('off', 'Instances', { unavailable: 'Cloud is disabled in Plugins' }), page('on', 'Instance types')]));
    f.palette.open();
    expect(titles(f)).toEqual([]);
    f.palette.setQuery('instance');
    expect(titles(f)).toEqual(['Instances', 'Instance types']);
    expect(rows(f)[0]).toMatchObject({ word: 'Unavailable', availability: { state: 'unavailable', reason: 'Cloud is disabled in Plugins' } });
    // Enter would refuse it, so it is not the pre-selected row.
    expect(state(f).active).toBe(rows(f)[1]?.id);
  });

  it('keeps each section to its cap in All and says how many more it holds, as a row that opens its kind (S68)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => pagesOf(Array.from({ length: 12 }, (_, index) => `Item ${String(index)}`))));
    f.palette.open();
    f.palette.setQuery('item');
    const [goto] = state(f).sections;
    expect(goto?.rows.filter((row) => row.kind !== 'more')).toHaveLength(8);
    expect(goto?.more).toBe(4);
    const more = goto?.rows.at(-1);
    expect(more).toMatchObject({ kind: 'more', action: { type: 'kind', kind: 'goto' } });
    expect(more?.title.text).toBe('4 more in Go to');
    f.palette.setKind('goto');
    expect(rows(f)).toHaveLength(12);
    expect(rows(f).some((row) => row.kind === 'more')).toBe(false);
  });

  it('trims the whole list to 50 rows, taking from the longest section one row at a time (S68)', () => {
    const f = makePalette();
    const many = (section: Provider['section'], id: string, plugin = 'host'): Provider => ({
      id,
      plugin,
      section,
      match: () => pagesOf(Array.from({ length: 100 }, (_, index) => `Item ${String(index)}`)).map((item) => ({ ...item, id: `${id}-${item.id}` })),
    });
    f.palette.registerProvider(many('tabs', 'a'));
    f.palette.registerProvider(many('goto', 'b'));
    f.palette.registerProvider(many('commands', 'c'));
    f.palette.registerProvider(many('settings', 'd'));
    for (const name of ['e', 'f', 'g', 'h', 'i', 'j']) {
      f.palette.registerProvider(many({ id: name, title: `Many ${name}` }, `stack:${name}`, 'stack'));
    }

    f.palette.open();
    f.palette.setQuery('item');
    // The caps (5, 8, 6, 5 and 5 for each of six more) add up to 54: four rows go, from the longest section each time.
    const counts = state(f).sections.map((section) => section.rows.filter((row) => row.kind !== 'more').length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(LIMITS.rows);
    expect(counts).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(state(f).total).toBe(LIMITS.rows);
    expect(state(f).sections.every((section) => section.more > 0 && section.rows.at(-1)?.kind === 'more')).toBe(true);
  });

  it('scores nothing for a provider that is not asked: a kind asks only the sections it shows', () => {
    const f = makePalette();
    let asked = 0;
    f.palette.registerProvider(cloud(() => {
      asked += 1;
      return cloudPages;
    }));
    f.palette.registerProvider(host(() => [command('x', 'Reopen closed tab')]));
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('o');
    expect(asked).toBe(0);
    f.palette.setKind('goto');
    expect(asked).toBeGreaterThan(0);
  });
});

describe('kinds and their prefixes (S67)', () => {
  it('takes a first character that names a kind out of the query and into the kind', () => {
    const f = makePalette();
    f.palette.registerProvider(host(() => [command('x', 'Open tab')]));
    f.palette.open();
    f.palette.setQuery('>');
    expect(state(f)).toMatchObject({ kind: 'commands', query: '' });
    f.palette.close();
    f.palette.open();
    f.palette.setQuery('>op');
    expect(state(f)).toMatchObject({ kind: 'commands', query: 'op' });
    expect(titles(f)).toEqual(['Open tab']);
    for (const [prefix, kind] of [['/', 'settings'], ['@', 'tabs'], ['#', 'goto']] as const) {
      f.palette.close();
      f.palette.open();
      f.palette.setQuery(`${prefix}x`);
      expect(state(f)).toMatchObject({ kind, query: 'x' });
    }
  });

  it('does not take a prefix typed after the first character, nor while an IME composes, nor into a query that is not empty', () => {
    const f = makePalette();
    f.palette.open();
    f.palette.setQuery('a>');
    expect(state(f)).toMatchObject({ kind: 'all', query: 'a>' });
    f.palette.close();
    f.palette.open();
    f.palette.compositionStart();
    f.palette.setQuery('>');
    expect(state(f)).toMatchObject({ kind: 'all', query: '>', composing: true });
    f.palette.compositionEnd('>');
    expect(state(f)).toMatchObject({ kind: 'commands', query: '', composing: false });
  });

  it('keeps the query at 256 characters', () => {
    const f = makePalette();
    f.palette.open();
    f.palette.setQuery('x'.repeat(400));
    expect(state(f).query).toHaveLength(256);
  });

  it('gives the kinds back with Backspace on an empty input: the chips first, the kind only when none is left (S67, S69)', () => {
    const f = makePalette();
    f.palette.registerProvider(host(() => [command('x', 'Open tab')]));
    f.palette.open({ kind: 'commands', scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }) });
    expect(state(f).chips.map((chip) => chip.label)).toEqual(['Stack', 'prod-eu']);
    expect(f.palette.key({ key: 'Backspace', target: 'input' }).handled).toBe(true);
    expect(state(f).chips.map((chip) => chip.label)).toEqual(['Stack']);
    f.palette.key({ key: 'Backspace', target: 'input' });
    expect(state(f).chips).toEqual([]);
    expect(state(f).kind).toBe('commands');
    f.palette.key({ key: 'Backspace', target: 'input' });
    expect(state(f).kind).toBe('all');
    expect(f.palette.key({ key: 'Backspace', target: 'input' }).handled).toBe(false);
  });
});

describe('no result (S73)', () => {
  it('says so, offers the plugin homes, and keeps the query editable', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.open();
    f.palette.setQuery('zzqq');
    expect(state(f).note).toEqual({ type: 'no-results', query: 'zzqq' });
    expect(sections(f)).toEqual(['suggest']);
    expect(titles(f)).toEqual(['Cloud']);
    expect(state(f).total).toBe(0);
    expect(state(f).sentence).toBe('No results');
    expect(state(f).query).toBe('zzqq');
  });

  it('offers Search everywhere when it is scoped, which removes the chips', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.open({ scope: seedChips({ plugin: 'cloud', pluginName: 'Cloud', scope: { id: 'us-east-1', label: 'us-east-1' } }) });
    f.palette.setQuery('zzqq');
    expect(sections(f)).toEqual(['actions', 'suggest']);
    const everywhere = rows(f)[0];
    expect(everywhere).toMatchObject({ kind: 'everywhere', action: { type: 'everywhere' } });
    expect(everywhere?.title.text).toBe('Search everywhere');
    expect(f.palette.activate(everywhere?.id)).toMatchObject({ status: 'changed' });
    expect(state(f).chips).toEqual([]);
    expect(state(f).query).toBe('zzqq');
  });
});

describe('scope chips (S69)', () => {
  const stackResources = (calls: SearchScope[]): Provider => ({
    id: 'stack:names',
    plugin: 'stack',
    pluginName: 'Stack',
    pluginIcon: 'boxes',
    section: { id: 'names', title: 'Resources' },
    match: (_query, scope) => {
      calls.push(scope);
      return [
        resource('prod', 'prod-eu', { kind: 'scope', context: 'Connection', into: { kind: 'scope', id: 'prod-eu', label: 'prod-eu', noun: 'connection' } }),
        resource('deploys', 'Deployments', { kind: 'type', into: { kind: 'type', id: 'deployments', label: 'Deployments' } }),
        resource('cart', 'cart-api'),
      ];
    },
  });

  it('opens narrowed to the tab\'s scope: the plugin\'s chip, then the scope\'s', () => {
    const chips = seedChips({ plugin: 'stack', pluginName: 'Stack', pluginIcon: 'boxes', scope: { id: 'prod-eu', label: 'a-very-long-connection-name-here' }, scopeNoun: 'connection', scopeIcon: 'map-pin' });
    expect(chips).toEqual([
      { kind: 'plugin', id: 'stack', label: 'Stack', plugin: 'stack', noun: 'plugin', icon: 'boxes' },
      { kind: 'scope', id: 'prod-eu', label: 'a-very-long-connection-…', plugin: 'stack', noun: 'connection', icon: 'map-pin' },
    ]);
    expect(seedChips({ plugin: 'stack', pluginName: 'Stack' })).toEqual([]);
    expect(seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'x', label: 'x' }, seed: false })).toEqual([]);
  });

  it('asks only that plugin\'s providers and the host\'s, and tells them the scope', () => {
    const f = makePalette();
    const stackCalls: SearchScope[] = [];
    let cloudCalls = 0;
    let hostCalls = 0;
    f.palette.registerProvider(stackResources(stackCalls));
    f.palette.registerProvider(cloud(() => {
      cloudCalls += 1;
      return [];
    }));
    f.palette.registerProvider(host(() => {
      hostCalls += 1;
      return [];
    }));
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }) });
    f.palette.setQuery('a');
    expect(stackCalls.at(-1)).toMatchObject({ plugin: 'stack', kind: 'all', scope: { kind: 'scope', id: 'prod-eu' } });
    expect(stackCalls.at(-1)?.chips.map((chip) => chip.id)).toEqual(['prod-eu']);
    expect(cloudCalls).toBe(0);
    expect(hostCalls).toBeGreaterThan(0);
  });

  it('searches inside the active row with → and puts what was typed back when the chip goes', () => {
    const f = makePalette();
    f.palette.registerProvider(stackResources([]));
    f.palette.open();
    f.palette.setQuery('prod');
    expect(rows(f)[0]?.into).toMatchObject({ kind: 'scope', id: 'prod-eu' });
    expect(f.palette.key({ key: 'ArrowRight', target: 'input', caret: { atStart: false, atEnd: true } })).toMatchObject({ handled: true, focus: { target: 'input', caret: 'end' } });
    expect(state(f)).toMatchObject({ query: '', chips: [{ kind: 'plugin', label: 'Stack', icon: 'boxes' }, { kind: 'scope', label: 'prod-eu', noun: 'connection' }] });
    f.palette.removeChip(1);
    expect(state(f).chips.map((chip) => chip.label)).toEqual(['Stack']);
    // What was typed when the chip was entered comes back with it gone, whichever chip goes (the mock remembers it for each).
    expect(state(f).query).toBe('prod');
    f.palette.removeChip(0);
    expect(state(f)).toMatchObject({ chips: [], query: 'prod' });
  });

  it('keeps one chip of a kind, and the plugin\'s chip first', () => {
    const f = makePalette();
    f.palette.registerProvider(stackResources([]));
    f.palette.open();
    f.palette.setQuery('prod');
    f.palette.enter();
    f.palette.setQuery('dep');
    expect(f.palette.enter()).toBe(true);
    expect(state(f).chips.map((chip) => chip.kind)).toEqual(['plugin', 'scope', 'type']);
    f.palette.setQuery('prod');
    expect(f.palette.enter()).toBe(false);
    expect(state(f).chips).toHaveLength(3);
  });

  it('says what each chip does to the arrows: ← from the start selects the last, then walks; → from the last returns to the input', () => {
    const f = makePalette();
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }) });
    expect(f.palette.key({ key: 'ArrowLeft', target: 'input', caret: { atStart: true, atEnd: true } })).toMatchObject({ handled: true, focus: { target: 'chip', index: 1 } });
    expect(state(f).chip).toBe(1);
    expect(f.palette.key({ key: 'ArrowLeft', target: 'chip', index: 1 })).toMatchObject({ handled: true, focus: { target: 'chip', index: 0 } });
    expect(f.palette.key({ key: 'ArrowLeft', target: 'chip', index: 0 }).focus).toEqual({ target: 'chip', index: 0 });
    expect(f.palette.key({ key: 'ArrowRight', target: 'chip', index: 0 }).focus).toEqual({ target: 'chip', index: 1 });
    expect(f.palette.key({ key: 'ArrowRight', target: 'chip', index: 1 }).focus).toEqual({ target: 'input', caret: 'start' });
    expect(state(f).chip).toBe(-1);
    f.palette.selectChip(1);
    expect(f.palette.key({ key: 'Home', target: 'chip', index: 1 }).focus).toEqual({ target: 'chip', index: 0 });
    expect(f.palette.key({ key: 'End', target: 'chip', index: 0 }).focus).toEqual({ target: 'chip', index: 1 });
    // Delete or Backspace on a chip removes it and what depends on it.
    expect(f.palette.key({ key: 'Delete', target: 'chip', index: 0 })).toMatchObject({ handled: true, focus: { target: 'input', caret: 'end' } });
    expect(state(f).chips).toEqual([]);
  });
});

describe('the lifecycle', () => {
  it('is closed with nothing in it until it is opened, and back to that when it closes', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    expect(state(f)).toMatchObject({ open: false, rows: [], sections: [], active: '', activeIndex: -1 });
    expect(f.palette.open({ query: 'inst', kind: 'goto' })).toBe(true);
    expect(f.palette.open()).toBe(false);
    expect(state(f)).toMatchObject({ open: true, query: 'inst', kind: 'goto' });
    expect(titles(f)).toEqual(['Instances']);
    expect(f.palette.close()).toBe(true);
    expect(f.palette.close()).toBe(false);
    expect(state(f)).toMatchObject({ open: false, query: '', kind: 'all', chips: [], rows: [] });
    expect(f.palette.toggle()).toBe(true);
    expect(f.palette.toggle()).toBe(false);
  });

  it('is a snapshot that never changes in place, frozen and free of anything to call, that notifies only when something changed', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    let heard = 0;
    const off = f.palette.subscribe(() => {
      heard += 1;
    });
    f.palette.open();
    const first = f.palette.getSnapshot();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.rows)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(f.palette.getSnapshot())));
    const before = heard;
    f.palette.setQuery('');
    f.palette.setKind('all');
    f.palette.removeChip(3);
    f.palette.focus('nothing|here');
    expect(heard).toBe(before);
    expect(f.palette.getSnapshot()).toBe(first);
    f.palette.setQuery('inst');
    expect(heard).toBe(before + 1);
    expect(f.palette.getSnapshot()).not.toBe(first);
    expect(first.query).toBe('');
    off();
    f.palette.setQuery('vol');
    expect(heard).toBe(before + 1);
  });

  it('tells a slice\'s listener only when the slice changed', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    const seen: string[] = [];
    f.palette.subscribeTo((s) => s.query, (value, previous) => seen.push(`${previous}>${value}`));
    f.palette.open();
    f.palette.setQuery('i');
    f.palette.setQuery('i');
    f.palette.setQuery('in');
    expect(seen).toEqual(['>i', 'i>in']);
  });

  it('contains a provider whose match throws, or answers what is not a list: the others answer, and the failure is said (S72)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud());
    f.palette.registerProvider({
      id: 'host:broken',
      plugin: 'host',
      section: 'commands',
      title: 'Broken',
      match: () => {
        throw new Error('boom');
      },
    });
    f.palette.registerProvider({ id: 'host:nonsense', plugin: 'host', section: 'settings', title: 'Nonsense', match: () => 'oops' as never });
    f.palette.open();
    f.palette.setQuery('inst');
    expect(titles(f)).toEqual(['Instances']);
    expect(state(f).runs.map((run) => [run.id, run.label, run.retry])).toEqual([['host:broken', 'Broken: Unavailable', true], ['host:nonsense', 'Nonsense: Unavailable', true]]);
    expect(f.errors.map((error) => error.where)).toEqual(['match() of host:broken', 'match() of host:nonsense']);
    expect(state(f).sentence).toBe('1 result. 2 sources didn\'t answer');
  });

  it('asks a provider again when told to retry, and again for each keystroke (a sync provider may recover)', () => {
    const f = makePalette();
    let fail = true;
    f.palette.registerProvider({ id: 'host:flaky', plugin: 'host', section: 'commands', title: 'Flaky', match: () => {
      if (fail) {
        throw new Error('down');
      }

      return [command('x', 'Reopen closed tab')];
    } });
    f.palette.open();
    f.palette.setQuery('reopen');
    expect(state(f).runs).toHaveLength(1);
    fail = false;
    expect(f.palette.retry('host:flaky')).toBe(true);
    expect(titles(f)).toEqual(['Reopen closed tab']);
    expect(state(f).runs).toEqual([]);
  });

  it('refreshes what the static providers say when told what they say changed', () => {
    const f = makePalette();
    let names = ['Instances'];
    f.palette.registerProvider(cloud(() => names.map((name) => page(name, name))));
    f.palette.open();
    f.palette.setQuery('i');
    expect(titles(f)).toEqual(['Instances']);
    names = ['Instances', 'Images'];
    expect(titles(f)).toEqual(['Instances']);
    f.palette.refresh();
    expect(titles(f)).toEqual(['Instances', 'Images']);
  });

  it('keeps the recents when it closes and puts them back in the saved document', () => {
    const f = makePalette();
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes', icon: 'server' });
    f.palette.open();
    f.palette.close();
    expect(f.palette.serialise()).toEqual({ version: 1, recents: [{ route: { plugin: 'cloud', contribution: 'volumes', params: {} }, kind: 'page', noun: 'Page', title: 'Volumes', context: 'Cloud · Compute', icon: 'server', tone: 'neutral' }] });
    expect(f.palette.clearRecents()).toBe(true);
    expect(f.palette.clearRecents()).toBe(false);
    expect(f.palette.serialise().recents).toEqual([]);
  });

  it('starts from the recents it is given, and ignores a provider that gives it nothing it can use', () => {
    const f = makePalette({ initial: [] });
    f.palette.registerProvider(cloud(() => [null, 7, { id: '', kind: 'page', title: 'x' }, page('ok', 'Okay')] as unknown as Candidate[]));
    f.palette.open({ kind: 'goto' });
    expect(titles(f)).toEqual(['Okay']);
    expect(state(f).sources.find((source) => source.id === 'cloud:pages')?.invalid).toBe(3);
  });

  it('is told nothing by a provider the host removed while it was open, and never asks a disposed palette anything', () => {
    const f = makePalette();
    let asked = 0;
    f.palette.registerProvider(cloud(() => {
      asked += 1;
      return cloudPages;
    }));
    f.palette.open();
    f.palette.dispose();
    const before = asked;
    f.palette.setQuery('inst');
    expect(asked).toBe(before);
  });
});

describe('a large static set', () => {
  it('ranks ten thousand commands for a query, and shows the best few', () => {
    const f = makePalette();
    const all = commands(10_000);
    f.palette.registerProvider(host(() => all));
    f.palette.open();
    f.palette.setQuery('toggle panel');
    expect(rows(f).length).toBeGreaterThan(0);
    expect(rows(f)[0]?.title.text).toBe('Toggle panel');
  });
});
