import { describe, expect, it } from 'vitest';
import { seedChips } from './store';
import { after, answer, command, makePalette, page, resource, type Fixture } from './testing';
import { LIMITS, type Candidate, type PaletteState, type Provider, type SearchScope } from './types';

// The asynchronous half of the palette (ch16 S71, S72, SE1), seen through the store: a provider that takes 300 ms never blocks a keystroke; a late answer is merged without moving what
// the user has focused; rows already shown stay, inert, until their source answers; a superseded request is aborted and its answer never shown; a provider that fails, times out or
// returns five thousand rows is contained, bounded and reported for that provider alone; a plugin that leaves takes its pending results with it.

type Call = { readonly query: string; readonly scope: SearchScope; readonly signal: AbortSignal; readonly at: number };

const state = (f: Fixture): PaletteState => f.palette.getSnapshot();
const rows = (f: Fixture): PaletteState['rows'] => state(f).rows;
const titles = (f: Fixture): string[] => rows(f).map((row) => row.title.text);
const sections = (f: Fixture): string[] => state(f).sections.map((section) => section.id);

/** The objects of a connection, asked on demand: takes `ms` of the clock and answers `<query>-api` and `<query>-worker`, or what `rowsOf` says. */
function resources(f: Fixture, options: { readonly ms?: number; readonly calls?: Call[]; readonly honour?: boolean; readonly rowsOf?: (query: string) => readonly Candidate[]; readonly id?: string; readonly plugin?: string } = {}): Provider {
  const { ms = 300, calls = [], honour = true, id = 'stack:names', plugin = 'stack' } = options;
  const rowsOf = options.rowsOf ?? ((query: string) => [resource(`${query}-api`, `${query}-api`), resource(`${query}-worker`, `${query}-worker`)]);
  return {
    id,
    plugin,
    pluginName: 'Stack',
    pluginIcon: 'boxes',
    title: 'Resources',
    section: { id: 'resources', title: 'Resources' },
    search: async (query, scope, signal) => {
      calls.push({ query, scope, signal, at: f.clock.now() });
      return after(f.clock, ms, rowsOf(query), honour ? signal : undefined);
    },
  };
}

const staticWorld = (f: Fixture): void => {
  f.palette.registerProvider({ id: 'cloud:pages', plugin: 'cloud', pluginName: 'Cloud', section: 'goto', title: 'Pages', match: () => [page('charts', 'Charts', { context: 'Helm' })] });
  f.palette.registerProvider({ id: 'host:commands', plugin: 'host', pluginName: 'Omniview', section: 'commands', title: 'Commands', match: () => [command('install', 'Install chart')] });
};

describe('a provider that takes 300 ms', () => {
  it('never blocks a keystroke: the static rows are there at once, the provider is asked 150 ms after the last key, its rows come when it answers', async () => {
    const f = makePalette();
    staticWorld(f);
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open();
    f.palette.setQuery('cart');
    // The call returned: nothing waited for the provider, and the rows of the static providers are in.
    expect(titles(f)).toEqual(['Charts', 'Install chart']);
    expect(state(f)).toMatchObject({ searching: true, slow: false });
    expect(calls).toHaveLength(0);
    await f.clock.advance(150);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ query: 'cart', at: 150 });
    expect(titles(f)).toEqual(['Charts', 'Install chart']);
    await f.clock.advance(300);
    expect(state(f).searching).toBe(false);
    // The best match leads (SE1): cart-api is a prefix of its name, Charts holds the letters of cart in a word.
    expect(sections(f)).toEqual(['stack:resources', 'goto', 'commands']);
    expect(titles(f)).toEqual(['cart-api', 'cart-worker', 'Charts', 'Install chart']);
    expect(state(f).active).toBe(rows(f)[0]?.id);
    expect(state(f).focused).toBe(false);
  });

  it('merges a late answer BELOW what the user has already focused, and moves nothing above it (S71)', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider(resources(f));
    f.palette.open();
    f.palette.setQuery('cart');
    f.palette.move(1);
    const before = rows(f);
    const focused = state(f).active;
    expect(before.map((row) => row.title.text)).toEqual(['Charts', 'Install chart']);
    expect(focused).toBe(before[1]?.id);
    expect(state(f)).toMatchObject({ focused: true, activeIndex: 1 });
    await f.clock.advance(450);
    // The section that would lead is appended: the rows the user has passed, and the one under the cursor, are the same rows in the same places.
    expect(sections(f)).toEqual(['goto', 'commands', 'stack:resources']);
    expect(rows(f).slice(0, 2)).toEqual(before);
    expect(state(f)).toMatchObject({ active: focused, activeIndex: 1, focused: true });
    expect(titles(f)).toEqual(['Charts', 'Install chart', 'cart-api', 'cart-worker']);
  });

  it('lets the pre-selected row follow the best match while the user has not moved (nothing has been focused)', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider(resources(f));
    f.palette.open();
    f.palette.setQuery('cart');
    expect(rows(f)[state(f).activeIndex]?.title.text).toBe('Charts');
    await f.clock.advance(450);
    expect(rows(f)[state(f).activeIndex]?.title.text).toBe('cart-api');
  });

  it('keeps the rows a source gave for the last query, undimmed and inert, until it answers the new one (S71)', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider(resources(f));
    f.palette.open();
    f.palette.setQuery('car');
    await f.clock.advance(450);
    expect(state(f).sections.find((section) => section.id === 'stack:resources')?.rows.map((row) => [row.title.text, row.inert])).toEqual([['car-api', false], ['car-worker', false]]);
    f.palette.setQuery('cart');
    const kept = state(f).sections.find((section) => section.id === 'stack:resources');
    expect(kept?.rows.map((row) => [row.title.text, row.inert])).toEqual([['car-api', true], ['car-worker', true]]);
    expect(f.palette.activate(kept?.rows[0]?.id)).toMatchObject({ status: 'refused', reason: 'inert' });
    expect(state(f).open).toBe(true);
    expect(state(f).searching).toBe(true);
    await f.clock.advance(450);
    expect(state(f).sections.find((section) => section.id === 'stack:resources')?.rows.map((row) => [row.title.text, row.inert])).toEqual([['cart-api', false], ['cart-worker', false]]);
    expect(state(f).searching).toBe(false);
  });

  it('does not let a stale row lead: while pending its rows do not count for the order of the sections', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider(resources(f));
    f.palette.open();
    f.palette.setQuery('car');
    await f.clock.advance(450);
    expect(sections(f)[0]).toBe('stack:resources');
    f.palette.setQuery('chart');
    // The old rows are still on screen, but only the sections that answered lead: they come after the ones that match this query.
    expect(sections(f)).toEqual(['goto', 'commands', 'stack:resources']);
  });

  it('is asked once for fifty keystrokes 20 ms apart, and shows no row of any other query (no stale result is ever delivered)', async () => {
    const f = makePalette();
    staticWorld(f);
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open();
    const seen: PaletteState[] = [];
    f.palette.subscribe(() => seen.push(f.palette.getSnapshot()));
    let typed = '';
    for (let key = 0; key < 50; key += 1) {
      typed += String.fromCharCode(97 + (key % 26));
      f.palette.setQuery(typed);
      await f.clock.advance(20);
    }

    expect(calls).toHaveLength(0);
    await f.clock.advance(150);
    expect(calls).toHaveLength(1);
    await f.clock.advance(300);
    expect(calls).toHaveLength(1);
    const final = f.palette.getSnapshot();
    expect(final.sections.find((section) => section.id === 'stack:resources')?.rows.map((row) => row.title.text)).toEqual([`${typed}-api`, `${typed}-worker`]);
    // Every snapshot ever published: an actionable row of the resources section answers the query shown with it, or there is none.
    for (const snapshot of seen) {
      for (const row of snapshot.rows.filter((r) => r.section === 'stack:resources' && !r.inert)) {
        expect(row.title.text.startsWith(snapshot.query)).toBe(true);
      }
    }
  });

  it('asks again for each keystroke that follows a pause, aborts the one it supersedes, and shows only the last answer', async () => {
    const f = makePalette();
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open();
    let typed = '';
    for (let key = 0; key < 6; key += 1) {
      typed += 'abcdef'[key] ?? '';
      f.palette.setQuery(typed);
      await f.clock.advance(200);
    }

    // Each key that followed a pause of 150 ms was asked for; the next key aborted it before it answered (it takes 300 ms). The last is still in flight.
    expect(calls.map((call) => call.query)).toEqual(['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef']);
    expect(calls.slice(0, 5).every((call) => call.signal.aborted)).toBe(true);
    expect(calls[5]?.signal.aborted).toBe(false);
    expect(titles(f)).toEqual([]);
    await f.clock.advance(300);
    expect(titles(f)).toEqual(['abcdef-api', 'abcdef-worker']);
  });

  it('shows no row of a request the query superseded, even when the provider ignores the signal and answers late', async () => {
    const f = makePalette();
    f.palette.registerProvider(resources(f, { honour: false }));
    f.palette.open();
    f.palette.setQuery('ca');
    await f.clock.advance(150);
    f.palette.setQuery('car');
    await f.clock.advance(350);
    // The answer for "ca" arrived at 450 and was thrown away; "car" is asked at 300 and answers at 600.
    expect(titles(f)).toEqual([]);
    await f.clock.advance(150);
    expect(titles(f)).toEqual(['car-api', 'car-worker']);
  });

  it('shows the loader after a second and not before (S71), and only while something is pending', async () => {
    const f = makePalette();
    f.palette.registerProvider(resources(f, { ms: 3000 }));
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(1029);
    expect(state(f)).toMatchObject({ searching: true, slow: false });
    // The model is told at 1030 ms, so the loader never shows a frame early.
    await f.clock.advance(1);
    expect(state(f)).toMatchObject({ searching: true, slow: true });
    await f.clock.advance(3000);
    expect(state(f)).toMatchObject({ searching: false, slow: false });
  });

  it('asks at once when a chip is entered or the kind changes, with no debounce', async () => {
    const f = makePalette();
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }) });
    await f.clock.advance(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.scope).toMatchObject({ plugin: 'stack', scope: { id: 'prod-eu' } });
  });

  it('asks no provider for an empty unscoped query, for the Tabs kind or for the Settings kind', async () => {
    const f = makePalette();
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open();
    await f.clock.advance(500);
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(150);
    expect(calls).toHaveLength(1);
    f.palette.setKind('tabs');
    expect(calls[0]?.signal.aborted).toBe(true);
    await f.clock.advance(1000);
    expect(calls).toHaveLength(1);
    expect(state(f).sections).toEqual([]);
    f.palette.setKind('settings');
    await f.clock.advance(1000);
    expect(calls).toHaveLength(1);
  });

  it('asks only the scoped plugin\'s providers, and not the others\'', async () => {
    const f = makePalette();
    const stackCalls: Call[] = [];
    const cloudCalls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls: stackCalls }));
    f.palette.registerProvider(resources(f, { calls: cloudCalls, id: 'cloud:names', plugin: 'cloud' }));
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }), query: 'cart' });
    await f.clock.advance(500);
    expect(stackCalls).toHaveLength(1);
    expect(cloudCalls).toHaveLength(0);
  });
});

describe('a provider that returns five thousand rows, fails or never answers', () => {
  it('keeps the first twenty, says how many there were, and shows five in All and all twenty in Go to (S71)', async () => {
    const f = makePalette();
    const big = Array.from({ length: 5000 }, (_, index) => resource(`r${String(index)}`, `cart-${String(index)}`));
    f.palette.registerProvider(resources(f, { rowsOf: () => big, ms: 50 }));
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(250);
    const section = state(f).sections.find((candidate) => candidate.id === 'stack:resources');
    expect(section?.rows.filter((row) => row.kind !== 'more')).toHaveLength(5);
    expect(section?.more).toBe(15);
    expect(state(f).sources[0]).toMatchObject({ id: 'stack:names', state: 'limited', rows: LIMITS.rowsPerProvider, limited: 5000 });
    expect(state(f).runs).toEqual([{ id: 'stack:names', name: 'Stack · Resources', label: 'Resources: first 20 of 5000', tone: 'info', retry: false, message: '' }]);
    f.palette.setKind('goto');
    expect(rows(f).filter((row) => row.section === 'stack:resources')).toHaveLength(20);
  });

  it('says a provider that fails, with its own word and a Retry, and the others still answer', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider({
      id: 'stack:down',
      plugin: 'stack',
      pluginName: 'Stack',
      title: 'Resources',
      section: { id: 'resources', title: 'Resources' },
      search: async () => Promise.reject(Object.assign(new Error('Stack is starting. Try again in a moment.'), { word: 'Starting' })),
    });
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(200);
    expect(titles(f)).toEqual(['Charts', 'Install chart']);
    expect(state(f).runs).toEqual([{ id: 'stack:down', name: 'Stack · Resources', label: 'Resources: Starting', tone: 'error', retry: true, message: 'Stack is starting. Try again in a moment.' }]);
    expect(state(f).sentence).toBe('2 results. 1 source didn\'t answer');
    expect(f.errors.map((error) => error.where)).toEqual(['search() of stack:down']);
  });

  it('times a provider out after five seconds and says so; Retry asks it again at once', async () => {
    const f = makePalette();
    let calls = 0;
    f.palette.registerProvider({
      id: 'stack:stuck',
      plugin: 'stack',
      pluginName: 'Stack',
      title: 'Resources',
      section: { id: 'resources', title: 'Resources' },
      search: async () => {
        calls += 1;
        return calls === 1 ? new Promise<never>(() => undefined) : Promise.resolve(answer([resource('a', 'cart-api')]));
      },
    });
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(150 + 4999);
    expect(state(f).searching).toBe(true);
    await f.clock.advance(1);
    expect(state(f)).toMatchObject({ searching: false, note: { type: 'no-results', query: 'cart' } });
    expect(state(f).runs[0]).toMatchObject({ label: 'Resources: Timed out', retry: true });
    expect(state(f).sources[0]).toMatchObject({ state: 'timeout', attempts: 0 });
    expect(f.palette.retry('stack:stuck')).toBe(true);
    expect(state(f)).toMatchObject({ searching: true });
    await f.clock.advance(0);
    expect(titles(f)).toEqual(['cart-api']);
    expect(state(f).sources[0]).toMatchObject({ state: 'ready', attempts: 1 });
    expect(state(f).runs).toEqual([]);
  });

  it('says partial results, and live updates that stopped, each with a Retry where retry helps (S72)', async () => {
    const f = makePalette();
    f.palette.registerProvider({
      id: 'stack:partial',
      plugin: 'stack',
      pluginName: 'Stack',
      title: 'Resources',
      section: { id: 'resources', title: 'Resources' },
      search: async () => Promise.resolve(answer([resource('a', 'cart-api')], { partial: true, live: false, message: 'One connection did not answer.' })),
    });
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(200);
    expect(state(f).runs.map((run) => [run.id, run.label, run.tone, run.retry])).toEqual([
      ['stack:partial', 'Resources: Partial results', 'warning', true],
      ['@live', 'Live updates unavailable', 'warning', true],
    ]);
  });

  it('folds more than three runs into a count, and a list of the sources that replaces the results in place (S72)', async () => {
    const f = makePalette();
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      f.palette.registerProvider({
        id: `stack:${name}`,
        plugin: 'stack',
        pluginName: 'Stack',
        title: `Source ${name}`,
        section: { id: name, title: `Source ${name}` },
        search: async () => Promise.reject(new Error(`${name} is down`)),
      });
    }

    // Scoped to the plugin with an empty input: the sources are asked at once, and Backspace on the empty input is the way back.
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }) });
    await f.clock.advance(200);
    expect(state(f).runs).toHaveLength(5);
    expect(state(f).folded).toBe(2);
    expect(f.palette.showSources()).toBe(true);
    expect(state(f)).toMatchObject({ view: 'sources', note: undefined });
    expect(state(f).sections.map((section) => section.id)).toEqual(['sources']);
    const first = rows(f)[0];
    expect(first).toMatchObject({ kind: 'source', title: { text: 'Stack · Source a' }, word: 'Unavailable', action: { type: 'retry', source: 'stack:a' } });
    expect(state(f).hints).toEqual([{ keys: 'Enter', label: 'Retry' }, { keys: 'Escape', label: 'Back to results' }]);
    // Escape, and Backspace on the empty input, go back to the results.
    expect(f.palette.key({ key: 'Escape' }).handled).toBe(true);
    expect(state(f).view).toBe('results');
    f.palette.showSources();
    expect(f.palette.key({ key: 'Backspace', target: 'input' }).handled).toBe(true);
    expect(state(f).view).toBe('results');
  });

  it('says the providers it did not ask when there are more than eight (S71)', async () => {
    const f = makePalette();
    const asked: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      f.palette.registerProvider({
        id: `p${String(index)}:x`,
        plugin: `p${String(index)}`,
        title: `Source ${String(index)}`,
        section: { id: 'r', title: 'R' },
        search: async (query) => {
          asked.push(`p${String(index)}`);
          return Promise.resolve(answer([resource(`${query}${String(index)}`, `cart-${String(index)}`)]));
        },
      });
    }

    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(500);
    expect(asked).toHaveLength(8);
    expect(state(f).runs.at(-1)).toMatchObject({ id: 'limit', label: 'Source limit: 2 not searched', tone: 'warning', retry: false });
  });
});

describe('the sentence of the results', () => {
  it('is told to the live region once, when the results have settled and stayed still (S86)', async () => {
    const f = makePalette();
    staticWorld(f);
    f.palette.registerProvider(resources(f, { rowsOf: (query) => (query === 'cart' ? [resource('a', 'cart-api'), resource('b', 'cart-worker')] : []) }));
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(300);
    expect(f.announced).toEqual([]);
    await f.clock.advance(150 + 300 + 100);
    expect(state(f).sentence).toBe('4 results');
    // Not before the results had been still for 450 ms: the answer came at 450, the sentence at 900.
    expect(f.announced).toEqual([]);
    await f.clock.advance(1000);
    expect(f.announced).toEqual(['4 results']);
    f.palette.setQuery('cartx');
    await f.clock.advance(2000);
    expect(f.announced.at(-1)).toBe('No results');
    f.palette.setQuery('cartx');
    await f.clock.advance(2000);
    expect(f.announced.filter((text) => text === 'No results')).toHaveLength(1);
  });

  it('says one result, none, and the sources that did not answer', async () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'cloud:pages', plugin: 'cloud', section: 'goto', match: () => [page('a', 'Alpha')] });
    f.palette.open();
    f.palette.setQuery('alp');
    expect(state(f).sentence).toBe('1 result');
    f.palette.setQuery('zzz');
    expect(state(f).sentence).toBe('No results');
  });
});

describe('a plugin that leaves while it is being searched (PO1)', () => {
  it('takes its request, its answers and its rows with it, and the late answer goes nowhere', async () => {
    const f = makePalette();
    staticWorld(f);
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls, honour: false }));
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(150);
    expect(state(f).searching).toBe(true);
    let heard = 0;
    f.palette.subscribe(() => {
      heard += 1;
    });
    expect(f.palette.removePlugin('stack')).toBe(true);
    expect(heard).toBe(1);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(state(f)).toMatchObject({ searching: false });
    expect(titles(f)).toEqual(['Charts', 'Install chart']);
    await f.clock.advance(1000);
    expect(titles(f)).toEqual(['Charts', 'Install chart']);
    expect(heard).toBe(1);
  });

  it('drops the chips that narrowed the search to it', async () => {
    const f = makePalette();
    f.palette.registerProvider(resources(f));
    f.palette.open({ scope: seedChips({ plugin: 'stack', pluginName: 'Stack', scope: { id: 'prod-eu', label: 'prod-eu' } }), query: 'cart' });
    f.palette.removePlugin('stack');
    expect(state(f).chips).toEqual([]);
    expect(state(f).query).toBe('cart');
  });

  it('answers for a provider that registers while the palette is open', async () => {
    const f = makePalette();
    f.palette.open();
    f.palette.setQuery('cart');
    f.palette.registerProvider(resources(f, { ms: 10 }));
    await f.clock.advance(500);
    expect(titles(f)).toEqual(['cart-api', 'cart-worker']);
  });

  it('closes cleanly: nothing is asked or answered after it', async () => {
    const f = makePalette();
    const calls: Call[] = [];
    f.palette.registerProvider(resources(f, { calls }));
    f.palette.open();
    f.palette.setQuery('cart');
    await f.clock.advance(150);
    f.palette.close();
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(f.clock.pending()).toBe(0);
    await f.clock.advance(1000);
    expect(state(f).rows).toEqual([]);
    expect(f.announced).toEqual([]);
  });
});
