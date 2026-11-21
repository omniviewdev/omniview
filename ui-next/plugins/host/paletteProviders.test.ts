import type { IconName } from '@omniviewdev/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaletteStore, type PaletteScope, type PaletteSeam, type PaletteStore } from '../../shell';
import type { DetailPageV1, PaletteCommandV1, PaletteMatchProviderV1, PaletteProviderV1, PaletteRowV1, PaletteSearchProviderV1, PaletteV1 } from '../contract/v1';
import { acme, answering } from '../testing';
import { commandOf, providersOf, runCommand } from './paletteProviders';
import type { PluginEntry } from './pluginStore';

// What a plugin's palette becomes in the host (paletteProviders.ts): the model's providers made of the plugin's declaration, each answer read row by row, a failure told in the host's words, and the plugin's commands found
// again at the moment they run. Against an invented plugin (Acme: widgets and gadgets, one detail page). The palette store is the real one, so what a row is, and what the palette says of a provider, is read as a view reads it.

const sprocket: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Sprocket', tile: { icon: 'box' }, identity: { name: 'name' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: () => ({ source: { state: { kind: 'loading' }, view: undefined, refreshing: false, refresh: async () => undefined } }),
};

const pages = () => ({ ...acme().pages, sprocket });

const ready = (palette: PaletteV1 | undefined, id = 'acme', name = 'Acme'): Extract<PluginEntry, { phase: 'ready' }> => ({
  id,
  name: `${name} plugin`,
  phase: 'ready',
  contribution: acme({ plugin: { name }, pages: pages(), palette }),
});

const widgets = (id: string, label = id): PaletteRowV1 => ({ id, label, icon: 'box', route: { page: 'widgets', params: {} } });
const match = (rows: readonly PaletteRowV1[] | ((query: string) => readonly PaletteRowV1[]), patch: Partial<Omit<PaletteMatchProviderV1, 'kind'>> = {}): PaletteMatchProviderV1 => ({
  kind: 'match',
  section: 'Pages',
  match: typeof rows === 'function' ? rows : () => rows,
  ...patch,
});
const search = (answer: PaletteSearchProviderV1['search'], patch: Partial<Omit<PaletteSearchProviderV1, 'kind'>> = {}): PaletteSearchProviderV1 => ({ kind: 'search', section: 'Things', search: answer, ...patch });

const NOWHERE: PaletteScope = { plugin: null, chips: [], scope: null, kind: 'all' };

/** What the tab model answers a place that opened: the palette's own tests are not about tabs, so the seam is a stand-in. */
const opened = (): ReturnType<PaletteSeam['open']> => ({ status: 'done', id: 't1', change: 'created', focused: true });

let reports: Array<[string, string]>;
const options = (icon: string | undefined = 'layers') => ({
  icon,
  report: (provider: string, message: string) => {
    reports.push([provider, message]);
  },
});

/** A palette store with the plugin's providers registered, open on `query` and past the debounce; what the model made of them. */
async function ask(entry: Extract<PluginEntry, { phase: 'ready' }>, query: string, opening: Parameters<PaletteStore['open']>[0] = {}) {
  const store = createPaletteStore({ open: opened, onError: () => undefined });
  for (const provider of providersOf(entry, options())) {
    expect(store.registerProvider(provider)).toMatchObject({ ok: true });
  }

  store.open(opening);
  store.setQuery(query);
  await vi.advanceTimersByTimeAsync(200);
  return store;
}

const titlesOf = (store: PaletteStore, section: string): string[] => store.getSnapshot().sections.find((candidate) => candidate.id === section)?.rows.map((row) => row.title.text) ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  reports = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('providersOf: what a plugin\'s palette becomes in the model', () => {
  it('makes a provider of the model for each the plugin declares, named by the plugin and its own id, in the plugin\'s section, with the plugin\'s name and glyph', () => {
    const providers = providersOf(ready({ providers: { pages: match([]), things: search(async () => []) } }), options('server'));

    expect(providers.map((provider) => ({ id: provider.id, plugin: provider.plugin, pluginName: provider.pluginName, pluginIcon: provider.pluginIcon, title: provider.title, section: provider.section }))).toEqual([
      { id: 'acme:pages', plugin: 'acme', pluginName: 'Acme', pluginIcon: 'server', title: 'Pages', section: { id: 'pages', title: 'Pages', kind: 'goto' } },
      { id: 'acme:things', plugin: 'acme', pluginName: 'Acme', pluginIcon: 'server', title: 'Things', section: { id: 'things', title: 'Things', kind: 'goto' } },
    ]);
  });

  it('gives a provider exactly the one way to answer it declared, and puts a section under Commands when the plugin says so', () => {
    const [pagesProvider, thingsProvider, commandsProvider] = providersOf(ready({ providers: { pages: match([]), things: search(async () => []), commands: match([], { filter: 'commands' }) } }), options());

    expect([typeof pagesProvider?.match, typeof pagesProvider?.search]).toEqual(['function', 'undefined']);
    expect([typeof thingsProvider?.match, typeof thingsProvider?.search]).toEqual(['undefined', 'function']);
    expect(commandsProvider?.section).toEqual({ id: 'commands', title: 'Pages', kind: 'commands' });
  });

  it('makes nothing for a plugin with no palette, or with none of its own to offer', () => {
    expect(providersOf(ready(undefined), options())).toEqual([]);
    expect(providersOf(ready({}), options())).toEqual([]);
    expect(providersOf(ready({ providers: {} }), options())).toEqual([]);
    expect(providersOf(ready({ commands: { reset: { run: () => undefined } } }), options())).toEqual([]);
  });

  it('makes providers the model takes, each with a section of the plugin\'s own', () => {
    const store = createPaletteStore({ open: opened });
    for (const provider of providersOf(ready({ providers: { pages: match([]), things: search(async () => []) } }), options())) {
      expect(store.registerProvider(provider)).toEqual({ ok: true, reason: '', remove: expect.any(Function) });
    }
  });

  it('asks a provider\'s scope test in the plugin\'s own terms, and offers none when the plugin has none', () => {
    const supports = vi.fn((scope: { readonly plugin: string | null }) => scope.plugin === 'acme');
    const [plain, tested] = providersOf(ready({ providers: { pages: match([]), things: match([], { supports }) } }), options());

    expect(plain?.supports).toBeUndefined();
    expect(tested?.supports?.({ ...NOWHERE, plugin: 'acme' })).toBe(true);
    expect(tested?.supports?.(NOWHERE)).toBe(false);
  });
});

describe('a match provider', () => {
  it('is asked the query and the scope as data of the plugin\'s own kind: the plugin, the chips below the plugin\'s own with what the plugin knows them by, and the filter', async () => {
    const asked = vi.fn((_query: string, _scope: unknown): readonly PaletteRowV1[] => [widgets('w', 'wid')]);
    const provider: PaletteMatchProviderV1 = { kind: 'match', section: 'Pages', match: asked };
    const store = await ask(ready({ providers: { pages: provider } }), 'wid', {
      scope: [
        { kind: 'plugin', id: 'acme', label: 'Acme', plugin: 'acme', noun: 'plugin', icon: 'layers' },
        { kind: 'scope', id: 'north', label: 'north', plugin: 'acme', noun: 'scope', icon: 'server' },
        { kind: 'type', id: 'sprockets', label: 'Sprockets', plugin: 'acme', noun: 'type', icon: 'box' },
      ],
    });

    expect(titlesOf(store, 'acme:pages')).toEqual(['wid']);
    expect(asked.mock.calls.at(-1)).toEqual(['wid', { plugin: 'acme', chips: [{ kind: 'scope', id: 'north', label: 'north' }, { kind: 'type', id: 'sprockets', label: 'Sprockets' }], kind: 'all' }]);
    expect(Object.isFrozen(asked.mock.calls.at(-1)?.[1])).toBe(true);
  });

  it('answers rows as the model\'s candidates: a page, in the plugin\'s own route space, with the words, the glyph and the connection the row names; a command under the id the host will run it by', async () => {
    const rows: PaletteRowV1[] = [
      { id: 'w', label: 'Widgets', secondary: 'Hardware', keywords: 'wdg', icon: 'layers', route: { page: 'widgets', connection: 'north', params: {} } },
      { id: 's', label: 'Sprocket a', icon: 'box', route: { page: 'sprocket', params: { name: 'a' } } },
      { id: 'r', label: 'Reset widgets', icon: 'refresh', command: { id: 'reset', arg: { all: true } } },
    ];
    const entry = ready({ providers: { pages: match(rows) }, commands: { reset: { run: () => undefined } } });
    const store = await ask(entry, '', { kind: 'goto' });
    const found = store.getSnapshot().sections.find((candidate) => candidate.id === 'acme:pages')?.rows ?? [];

    expect(found.map((row) => [row.kind, row.noun, row.title.text, row.context.text, row.tile?.icon, row.plugin])).toEqual([
      ['page', 'Page', 'Widgets', 'Hardware', 'layers', 'acme'],
      ['page', 'Page', 'Sprocket a', '', 'box', 'acme'],
      ['command', 'Command', 'Reset widgets', '', 'refresh', 'acme'],
    ]);
    expect(found[0]?.route).toEqual({ plugin: 'acme', contribution: 'widgets', params: { connection: 'north' } });
    expect(found[1]?.route).toEqual({ plugin: 'acme', contribution: 'sprocket', params: { name: 'a' } });
    expect(found[0]?.action).toMatchObject({ type: 'open', destination: { route: { plugin: 'acme', contribution: 'widgets' } } });
    expect(found[2]?.action).toEqual({ type: 'run', command: { id: 'acme:reset', arg: { all: true } } });
  });

  it('is found by the plugin\'s name and by the words a row keeps unseen, as the host\'s own pages are', async () => {
    const entry = ready({ providers: { pages: match([{ ...widgets('w', 'Widgets'), keywords: 'wdg' }, widgets('g', 'Gadgets')]) } });

    expect(titlesOf(await ask(entry, 'wdg'), 'acme:pages')).toEqual(['Widgets']);
    expect(titlesOf(await ask(entry, 'acme'), 'acme:pages')).toEqual(['Gadgets', 'Widgets']);
  });

  it('leaves a row out that is not valid and keeps the others, and tells the provider\'s problem once however often it is asked', async () => {
    const entry = ready({ providers: { pages: match([widgets('a'), { ...widgets('b'), icon: 'no-such-glyph' as IconName }, { ...widgets('c'), route: { page: 'elsewhere', params: {} } }, widgets('d')]) } });
    const store = await ask(entry, 'a');
    store.setQuery('');
    store.setQuery('d');
    await vi.advanceTimersByTimeAsync(200);

    expect(titlesOf(store, 'acme:pages')).toEqual(['d']);
    expect(reports).toEqual([
      ['acme:pages', 'row "b": the glyph "no-such-glyph" is not one the kit has'],
      ['acme:pages', 'row "c": route.page "elsewhere" is not one of the plugin\'s pages'],
    ]);
  });

  it('reads at most a thousand rows of an answer and says the rest were not read: a set that large is a search provider', async () => {
    const many = Array.from({ length: 1500 }, (_, index) => widgets(`w${String(index)}`, `widget ${String(index)}`));
    const entry = ready({ providers: { pages: match(many) } });
    const store = await ask(entry, 'widget 14');

    expect(titlesOf(store, 'acme:pages')[0]).toBe('widget 14');
    expect(store.getSnapshot().rows.some((row) => row.title.text === 'widget 1499')).toBe(false);
    expect(reports).toEqual([['acme:pages', 'returned 1500 rows: at most 1000 are read; a set that large is a search provider']]);
  });

  it('is contained when it throws: the palette says the source did not answer in the host\'s words, the plugin\'s are in the error\'s cause, and the other providers answer', async () => {
    const boom = new Error('connect ECONNREFUSED 10.0.0.1:6443');
    const errors: Array<{ error: unknown; where: string }> = [];
    const store = createPaletteStore({ open: opened, onError: (error, where) => errors.push({ error, where }) });
    const entry = ready({ providers: { broken: match(() => {
      throw boom; 
    }, { section: 'Broken' }), pages: match([widgets('a')]) } });
    for (const provider of providersOf(entry, options())) {
      store.registerProvider(provider);
    }

    store.open();
    store.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);

    expect(titlesOf(store, 'acme:pages')).toEqual(['a']);
    const state = store.getSnapshot();
    expect(state.runs.map((run) => [run.label, run.message])).toEqual([['Broken: Unavailable', 'Broken did not answer.']]);
    expect(JSON.stringify(state)).not.toContain('ECONNREFUSED');
    expect(errors.length).toBeGreaterThan(0);
    for (const { error, where } of errors) {
      expect(where).toBe('match() of acme:broken');
      expect((error as Error).message).toBe('Broken did not answer.');
      expect((error as Error).cause).toBe(boom);
    }
  });

  it('is contained when it answers what is not a list', async () => {
    const entry = ready({ providers: { pages: match((() => 'nothing') as unknown as () => readonly PaletteRowV1[]) } });
    const store = createPaletteStore({ open: opened, onError: () => undefined });
    for (const provider of providersOf(entry, options())) {
      store.registerProvider(provider);
    }

    store.open();
    store.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);

    expect(store.getSnapshot().runs.map((run) => run.label)).toEqual(['Pages: Unavailable']);
  });
});

describe('a search provider', () => {
  it('is asked once the typing has been still for 150 ms, with the query, the scope and a signal', async () => {
    const asked = vi.fn(async (_query: string, _scope: unknown, _signal: AbortSignal) => [widgets('a')]);
    const store = createPaletteStore({ open: opened, onError: () => undefined });
    for (const provider of providersOf(ready({ providers: { things: search(asked) } }), options())) {
      store.registerProvider(provider);
    }

    store.open();
    store.setQuery('wid');
    await vi.advanceTimersByTimeAsync(149);
    expect(asked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]?.[0]).toBe('wid');
    expect(asked.mock.calls[0]?.[1]).toEqual({ plugin: null, chips: [], kind: 'all' });
    expect(asked.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(titlesOf(store, 'acme:things')).toEqual(['a']);
    expect(store.getSnapshot().rows.find((row) => row.title.text === 'a')).toMatchObject({ kind: 'resource', noun: 'Resource' });
  });

  it('keeps twenty rows of a bigger answer and says how many there were; the rows after the twenty are not looked at', async () => {
    const seen = { reads: 0 };
    const many = Array.from({ length: 5000 }, (_, index) => ({
      id: `w${String(index)}`,
      label: `widget ${String(index)}`,
      icon: 'box',
      get route() {
        seen.reads += 1;
        return { page: 'widgets', params: {} };
      },
    })) as unknown as PaletteRowV1[];
    const store = await ask(ready({ providers: { things: search(async () => many) } }), 'widget', { kind: 'goto' });

    expect(titlesOf(store, 'acme:things')).toHaveLength(20);
    expect(seen.reads).toBe(20);
    expect(store.getSnapshot().sources.find((source) => source.id === 'acme:things')).toMatchObject({ state: 'limited', rows: 20, limited: 5000 });
  });

  it('passes on what the answer says of the rest: how many there are, that a part did not answer, and why, in the plugin\'s own sentence of at most 160 characters', async () => {
    const answer = async () => ({ rows: [widgets('a')], limited: 321, partial: true, message: 'The index is still building. Try again in a moment.' });
    const store = await ask(ready({ providers: { things: search(answer) } }), 'a');

    expect(store.getSnapshot().sources.find((source) => source.id === 'acme:things')).toMatchObject({ state: 'partial', limited: 321, message: 'The index is still building. Try again in a moment.' });
    const long = async () => ({ rows: [widgets('a')], partial: true, message: 'x'.repeat(161) });
    expect(((await ask(ready({ providers: { things: search(long) } }), 'a')).getSnapshot().sources[0] ?? { message: 'missing' }).message).toBe('');
  });

  it('leaves a row out that is not valid, keeps the others in the provider\'s order, and tells the problem once', async () => {
    const answer = async () => [widgets('a'), { id: 'b', label: 'b', icon: 'box' }, widgets('c')] as readonly PaletteRowV1[];
    const store = await ask(ready({ providers: { things: search(answer) } }), 'x');

    expect(titlesOf(store, 'acme:things')).toEqual(['a', 'c']);
    expect(reports).toEqual([['acme:things', 'row "b": it opens neither a route nor a command']]);
  });

  it('is contained when it rejects, in the host\'s words: the palette names the source, shows no word of the plugin\'s, and the other providers answer', async () => {
    const boom = new Error('403 Forbidden: secret detail');
    const errors: unknown[] = [];
    const store = createPaletteStore({ open: opened, onError: (error) => errors.push(error) });
    const entry = ready({ providers: { things: search(async () => {
      throw boom; 
    }), pages: match([widgets('a')]) } });
    for (const provider of providersOf(entry, options())) {
      store.registerProvider(provider);
    }

    store.open();
    store.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);

    expect(titlesOf(store, 'acme:pages')).toEqual(['a']);
    expect(store.getSnapshot().runs.map((run) => [run.label, run.message, run.retry])).toEqual([['Things: Unavailable', 'Things did not answer.', true]]);
    expect(JSON.stringify(store.getSnapshot())).not.toContain('secret detail');
    expect((errors[0] as Error).cause).toBe(boom);
  });

  it('is contained when it throws before it answers, and when it answers what is neither a list nor an answer', async () => {
    const entry = ready({ providers: { thrown: search((() => {
      throw new Error('no'); 
    }), { section: 'Thrown' }), odd: search((async () => 7) as never, { section: 'Odd' }) } });
    const store = createPaletteStore({ open: opened, onError: () => undefined });
    for (const provider of providersOf(entry, options())) {
      store.registerProvider(provider);
    }

    store.open();
    store.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);

    expect(store.getSnapshot().runs.map((run) => run.label)).toEqual(['Thrown: Unavailable', 'Odd: Unavailable']);
  });

  it('has failed when it has not answered in five seconds, whatever it does later, and its late answer is never shown', async () => {
    let finish: (rows: readonly PaletteRowV1[]) => void = () => undefined;
    const entry = ready({ providers: { things: search(async () => new Promise((resolve) => {
      finish = resolve; 
    })), pages: match([widgets('p')]) } });
    const store = await ask(entry, 'a');
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.getSnapshot().runs.map((run) => [run.label, run.message])).toEqual([['Things: Timed out', 'Things didn\'t answer in 5 seconds.']]);
    finish([widgets('late')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(titlesOf(store, 'acme:things')).toEqual([]);
    expect(titlesOf(store, 'acme:pages')).toEqual(['p']);
  });

  it('is told to stop when the query moves on, and an answer that comes after it was told is never shown, whether or not the provider listened', async () => {
    const signals: AbortSignal[] = [];
    const answers: Array<(rows: readonly PaletteRowV1[]) => void> = [];
    const entry = ready({ providers: { things: search(async (_query, _scope, signal) => {
      signals.push(signal); return new Promise((resolve) => {
        answers.push(resolve); 
      }); 
    }) } });
    const store = await ask(entry, 'wid');
    store.setQuery('widg');
    await vi.advanceTimersByTimeAsync(200);

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    answers[0]?.([widgets('stale')]);
    answers[1]?.([widgets('fresh')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(titlesOf(store, 'acme:things')).toEqual(['fresh']);
  });

  it('is told to stop when the palette closes, and when its plugin leaves', async () => {
    const signals: AbortSignal[] = [];
    const entry = ready({ providers: { things: search(async (_query, _scope, signal) => {
      signals.push(signal); return new Promise<never>(() => undefined); 
    }) } });
    const store = await ask(entry, 'a');
    store.close();
    expect(signals[0]?.aborted).toBe(true);

    const again = await ask(entry, 'a');
    again.removePlugin('acme');
    expect(signals[1]?.aborted).toBe(true);
    expect(again.getSnapshot().sections).toEqual([]);
  });

  it('does no work on an answer that came after it was told to stop', async () => {
    const reads = { count: 0 };
    let release: (rows: readonly unknown[]) => void = () => undefined;
    const entry = ready({ providers: { things: search((async () => new Promise((resolve) => {
      release = resolve; 
    })) as never) } });
    const store = await ask(entry, 'a');
    store.setQuery('b');
    release([{ id: 'x', label: 'x', icon: 'box', get route() {
      reads.count += 1; return { page: 'widgets', params: {} }; 
    } }]);
    await vi.advanceTimersByTimeAsync(1);

    expect(reads.count).toBe(0);
  });
});

describe('commandOf and runCommand', () => {
  const run = vi.fn<PaletteCommandV1['run']>();
  const entries = (...list: PluginEntry[]): readonly PluginEntry[] => list;

  beforeEach(() => {
    run.mockReset();
  });

  it('finds the command a row names by the id the plugin and the command make together, from the plugins as they are now', () => {
    const live = entries(ready({ commands: { reset: { run } } }), ready({ commands: { other: { run: () => undefined } } }, 'beta', 'Beta'));

    expect(commandOf(live, 'acme:reset')).toMatchObject({ plugin: 'acme', local: 'reset' });
    expect(commandOf(live, 'beta:other')).toMatchObject({ plugin: 'beta', local: 'other' });
  });

  it.each([
    ['a command the plugin does not have', 'acme:launch'],
    ['a command of another plugin, written under this one', 'acme:other'],
    ['a plugin that is not installed', 'gone:reset'],
    ['a member the prototype brings', 'acme:constructor'],
    ['an id with no plugin', 'reset'],
    ['the host\'s own command', 'host.tab.close'],
  ])('finds nothing for %s', (_name, id) => {
    expect(commandOf(entries(ready({ commands: { reset: { run } } })), id)).toBeUndefined();
  });

  it('finds nothing in a plugin that is loading or did not load: the command left with the plugin', () => {
    const loading: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'loading' };
    const failed: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'failed', failure: { kind: 'missing', message: 'x' } };

    expect(commandOf(entries(loading), 'acme:reset')).toBeUndefined();
    expect(commandOf(entries(failed), 'acme:reset')).toBeUndefined();
  });

  it('finds the command of a plugin whose id holds a colon, because the plugin\'s id is what is matched before the command\'s', () => {
    expect(commandOf(entries(ready({ commands: { reset: { run } } }, 'org:acme')), 'org:acme:reset')).toMatchObject({ plugin: 'org:acme', local: 'reset' });
  });

  it('runs it with the argument the row carried and what it may use of the host, and says it ran', () => {
    const panel = { logs: { open: vi.fn() } };
    const found = commandOf(entries(ready({ commands: { reset: { run } } })), 'acme:reset');
    run.mockReturnValue(undefined);

    expect(found && runCommand(found, { all: true }, panel, () => undefined)).toBe(true);
    expect(run).toHaveBeenCalledWith({ all: true }, { plugin: 'acme', panel });
  });

  it.each([
    ['true', true, true],
    ['nothing', undefined, true],
    ['{ ok: true }', { ok: true }, true],
    ['false', false, { ok: false, reason: 'This command did not run.' }],
    ['a refusal with its reason', { ok: false, reason: 'Nothing is selected.' }, { ok: false, reason: 'Nothing is selected.' }],
    ['a refusal with no reason', { ok: false }, { ok: false, reason: 'This command did not run.' }],
    ['a refusal whose reason is not text', { ok: false, reason: 7 }, { ok: false, reason: 'This command did not run.' }],
    ['a refusal whose reason is too long', { ok: false, reason: 'x'.repeat(161) }, { ok: false, reason: 'This command did not run.' }],
    ['a refusal whose reason is over several lines', { ok: false, reason: 'No\n  way.' }, { ok: false, reason: 'No way.' }],
  ])('reads what it answered: %s', (_name, answer, outcome) => {
    const found = commandOf(entries(ready({ commands: { reset: { run } } })), 'acme:reset');
    run.mockReturnValue(answer as never);

    expect(found && runCommand(found, undefined, undefined, () => undefined)).toEqual(outcome);
  });

  it('waits for a command that answers later, and reads its answer the same way', async () => {
    const found = commandOf(entries(ready({ commands: { reset: { run } } })), 'acme:reset');
    run.mockResolvedValue({ ok: false, reason: 'Not now.' });

    await expect(found && runCommand(found, undefined, undefined, () => undefined)).resolves.toEqual({ ok: false, reason: 'Not now.' });
  });

  it('is contained when it throws or rejects: the palette is told the command failed in the host\'s words and the plugin\'s are told to the console', async () => {
    const found = commandOf(entries(ready({ commands: { reset: { run } } })), 'acme:reset');
    const told: unknown[] = [];
    const boom = new Error('private detail');
    run.mockImplementationOnce(() => {
      throw boom;
    });

    expect(found && runCommand(found, undefined, undefined, (error) => told.push(error))).toEqual({ ok: false, reason: 'This command failed.' });
    run.mockRejectedValueOnce(boom);
    await expect(found && runCommand(found, undefined, undefined, (error) => told.push(error))).resolves.toEqual({ ok: false, reason: 'This command failed.' });
    expect(told).toEqual([boom, boom]);
  });
});
