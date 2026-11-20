import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../tabs/testing';
import type { OpenHow } from '../tabs/types';
import { createPaletteSaver } from './saver';
import { command, makePalette, page, type Fixture } from './testing';
import type { ActivateResult, Candidate, ModifierEvent, PaletteState, PersistedPalette } from './types';

// THE ORACLE. The design lab's harness (`tests/shell-model-harness/`: R2Store/unit.cjs, ShellStore/unit.cjs, ShellStore2/ShellStore2-unit.cjs, 4,000 random operations and 140 cases) has
// no unit of its own for the palette: `shell-search.js` was checked by hand and by the audit (`shell-qa-search-feedback.md`). Its cases that the palette depends on are the rules a result
// is opened by, and they are ported here, against the real tab model, so that the palette keeps what the mock proved.
//
// PORTED (harness case, file:line):
//   P1  how(event): the modifier mapping of S64                       R2Store/unit.cjs:314    through a palette row, on both platforms
//   P2  preview tabs (S24): search opens a preview ...               R2Store/unit.cjs:261    a result opens as one, the next replaces it, the settings change it
//   P3  availability (S65): available, degraded, unavailable          R2Store/unit.cjs:113    the row says it; Enter opens, opens the recovery page or refuses with the reason
//   P4  K1: an open singleton is activated and pointed at the place   R2Store/unit.cjs:1598-1711  a setting row is the Settings page with its row as the reveal
//   P5  a plugin whose functions throw never breaks the model (S89)  R2Store/unit.cjs:955    a provider, the host's availability or describe that throws
//   P6  persist: write after a delay, only when changed, flush       ShellStore/unit.cjs:445-479  the recents' saver (the generic one, ../saver.ts)
//   P7  hint only for implemented commands                           ShellStore/unit.cjs:273  the chord of a row is the host's, never invented (A9)
//   Q1  QA-SF-09: commands are told apart by identity, never by title   shell-qa-search-feedback.md
//
// NOT PORTED, and why:
//   router: modal layer blocks, the guards (IME, 229, AltGr), `host.search` on ⌘K    ShellStore/unit.cjs:289-433  the chord router is `core/chords.ts` and the host's: the palette takes a key
//                                                                                   only once the view has decided it is the palette's. Its own IME rule is tested in activate.test.ts.
//   live model: modal and palette close when the tab changes                        R2Store/unit.cjs:1090  the host closes the palette (`close()`, tested in store.test.ts) when the tab changes
//   New tab menu data, view(): destinations for tab rows, openNew                   R2Store/unit.cjs:1555-1597  the + menu and All tabs are menus: they share the destination (a `Row`), their own view model is not this step
//   command registration validation, commands.list, dynamic titles                  ShellStore/unit.cjs:234-272  the command registry is the host's and does not exist yet; the palette takes commands as candidates
//   storage envelope, storage unavailable, session persistence, a corrupted store   ShellStore/unit.cjs:435-505, R2Store/unit.cjs:1208-1345  the window's session is `session/` (S3a); the recents document has its own restore tests (recents.test.ts)
//   announce: the live region exists from load                                      ShellStore/unit.cjs:563  the live region is the UI's; the model tells it the sentence once (async.test.ts)

afterEach(() => {
  vi.useRealTimers();
});

const state = (f: Fixture): PaletteState => f.palette.getSnapshot();

const instances = (): Candidate => page('instances', 'Instances', { context: 'Cloud · Compute' });
const cloud = (match: () => readonly Candidate[]) => ({ id: 'cloud:pages', plugin: 'cloud', pluginName: 'Cloud', section: 'goto' as const, title: 'Pages', match });

describe('P1: the modifier mapping of S64, on a palette row', () => {
  const mac = [
    [{}, 'smart'],
    [{ altKey: true }, 'here'],
    [{ metaKey: true }, 'background'],
    [{ metaKey: true, shiftKey: true }, 'new'],
    [{ shiftKey: true }, 'window'],
    [{ button: 1 }, 'background'],
    // Ctrl is not the command key on macOS.
    [{ ctrlKey: true }, 'smart'],
  ] as const;
  const other = [
    [{ ctrlKey: true }, 'background'],
    [{ ctrlKey: true, shiftKey: true }, 'new'],
    [{ metaKey: true }, 'smart'],
    [{}, 'smart'],
  ] as const;

  const run = (platform: 'mac' | 'other', cases: ReadonlyArray<readonly [Record<string, unknown>, OpenHow]>): void => {
    const tabs = boot({ home: false });
    const hows: OpenHow[] = [];
    const f = makePalette({
      tabs,
      platform,
      windows: true,
      open: (destination, options) => {
        hows.push(options.how ?? 'smart');
        return tabs.store.open(destination, options);
      },
    });
    f.palette.registerProvider(cloud(() => [instances()]));
    for (const [event, how] of cases) {
      f.palette.open({ kind: 'goto' });
      f.palette.activate(undefined, event);
      expect(hows.at(-1)).toBe(how);
    }
  };

  it('maps the five keys and the middle button on macOS', () => {
    run('mac', mac);
  });

  it('maps Control to the command key on Windows and Linux, and Command to nothing', () => {
    run('other', other);
  });

  it('is smart with no event at all, and passes an explicit disposition as it is', () => {
    const tabs = boot({ home: false });
    const hows: OpenHow[] = [];
    const f = makePalette({
      tabs,
      open: (destination, options) => {
        hows.push(options.how ?? 'smart');
        return tabs.store.open(destination, options);
      },
    });
    f.palette.registerProvider(cloud(() => [instances()]));
    f.palette.open({ kind: 'goto' });
    f.palette.activate();
    f.palette.open({ kind: 'goto' });
    f.palette.activate(undefined, 'new');
    expect(hows).toEqual(['smart', 'new']);
  });

  it('gives every disposition its result: here navigates the tab on screen, background leaves the focus, window is handed back', () => {
    const f = makePalette({ windows: true });
    f.palette.registerProvider(cloud(() => [instances(), page('volumes', 'Volumes')]));
    const first = f.tabs.open({ route: { plugin: 'cloud', contribution: 'buckets' } });
    f.tabs.store.keep(first);
    const open = (query: string, how: ModifierEvent | OpenHow) => {
      f.palette.open();
      f.palette.setQuery(query);
      return f.palette.activate(undefined, how);
    };

    expect(open('vol', { altKey: true })).toMatchObject({ status: 'opened', result: { status: 'done', change: 'navigated', id: first } });
    expect(f.tabs.ids()).toHaveLength(1);
    expect(open('inst', { metaKey: true })).toMatchObject({ status: 'opened', result: { status: 'done', change: 'created', focused: false } });
    expect(f.tabs.active()).toBe(first);
    expect(f.tabs.ids()).toHaveLength(2);
    expect(open('inst', { metaKey: true, shiftKey: true })).toMatchObject({ status: 'opened', result: { status: 'done', change: 'created', focused: true } });
    expect(open('vol', { shiftKey: true })).toMatchObject({ status: 'opened', result: { status: 'window' } });
    expect(f.tabs.ids()).toHaveLength(3);
  });
});

describe('P2: a result opens as a preview tab, and the settings change that (S24)', () => {
  const setup = (): Fixture => {
    const f = makePalette();
    f.palette.registerProvider(
      cloud(() => [
        page('instances', 'Instances', { route: { plugin: 'cloud', contribution: 'instances' } }),
        { id: 'users', kind: 'page', title: 'Users', route: { plugin: 'access', contribution: 'users' } },
        { id: 'service', kind: 'page', title: 'Services', route: { plugin: 'stack', contribution: 'services' } },
      ]),
    );
    f.tabs.open({ route: { plugin: 'host', contribution: 'home' } });
    return f;
  };

  const choose = (f: Fixture, query: string): ActivateResult => {
    f.palette.open();
    f.palette.setQuery(query);
    return f.palette.activate();
  };

  it('opens the first as a preview, and the next of another plugin replaces it in place', () => {
    const f = setup();
    const before = f.tabs.ids().length;
    const first = choose(f, 'inst');
    expect(first).toMatchObject({ status: 'opened', result: { status: 'done', change: 'created' } });
    const previews = () => f.tabs.ids().filter((id) => f.tabs.state().tabs[id]?.flags.preview);
    expect(previews()).toHaveLength(1);
    const preview = previews()[0];
    const place = f.tabs.ids().indexOf(preview ?? '');
    choose(f, 'users');
    expect(previews()).toHaveLength(1);
    expect(f.tabs.state().tabs[preview ?? '']).toBeUndefined();
    expect(f.tabs.ids().indexOf(previews()[0] ?? '')).toBe(place);
    expect(f.tabs.ids()).toHaveLength(before + 1);
    expect(f.tabs.state().closed).toHaveLength(0);
  });

  it('keeps a tab that was kept, and opens the next preview beside it', () => {
    const f = setup();
    choose(f, 'inst');
    const preview = f.tabs.current();
    f.tabs.store.keep(preview);
    choose(f, 'users');
    expect(f.tabs.state().tabs[preview]).toBeDefined();
    expect(f.tabs.ids().filter((id) => f.tabs.state().tabs[id]?.flags.preview)).toHaveLength(1);
  });

  it('follows the setting "Open search results": always a new tab, or always the current one', () => {
    const f = setup();
    f.tabs.preferences.openResults = 'new-tab';
    const created = choose(f, 'inst');
    expect(created.status === 'opened' && created.result.status === 'done' && f.tabs.state().tabs[created.result.id]?.flags.preview).toBe(false);
    f.tabs.preferences.openResults = 'current-tab';
    const here = f.tabs.current();
    const navigated = choose(f, 'users');
    expect(navigated.status === 'opened' && navigated.result.status === 'done' && navigated.result.id).toBe(here);
    f.tabs.preferences.openResults = 'smart';
    f.tabs.preferences.reusePreview = false;
    const plain = choose(f, 'serv');
    expect(plain.status === 'opened' && plain.result.status === 'done' && f.tabs.state().tabs[plain.result.id]?.flags.preview).toBe(false);
  });
});

describe('P3: availability (S65): available, degraded, unavailable', () => {
  // An unavailable place never leads an empty list (S73): it shows once a query matches it.
  const choose = (f: Fixture) => {
    f.palette.open({ kind: 'goto' });
    f.palette.setQuery('inst');
    return f.palette.activate();
  };

  it('opens a place of a plugin that is failing, to its recovery page, and says the state in its row', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [instances()]));
    f.tabs.world.report('cloud', { state: 'degraded', reason: 'exit 1' });
    f.palette.open({ kind: 'goto' });
    expect(state(f).rows[0]).toMatchObject({ availability: { state: 'degraded', reason: 'exit 1' }, word: 'Degraded' });
    expect(f.palette.activate()).toMatchObject({ status: 'opened', result: { status: 'done' } });
  });

  it('refuses a place of a plugin that is off, with the reason, and keeps the palette (focusable, aria-disabled)', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [instances()]));
    f.tabs.world.report('cloud', { state: 'unavailable', reason: 'Cloud is disabled in Plugins' });
    expect(choose(f)).toMatchObject({ status: 'refused', reason: 'unavailable', message: 'Instances: Cloud is disabled in Plugins' });
    expect(f.announced.at(-1)).toMatch(/Instances: .*disabled in Plugins/);
    expect(state(f).open).toBe(true);
    expect(state(f).rows[0]?.availability.state).toBe('unavailable');
  });

  it('says a plugin that is not installed by name, and a reason the provider gives for a place of its own', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'ghost:pages', plugin: 'ghost', section: 'goto', match: () => [page('g', 'Ghost', { route: { plugin: 'ghost', contribution: 'x' } })] });
    f.palette.registerProvider(cloud(() => [page('c', 'Cluster', { unavailable: 'No cluster is selected' })]));
    f.palette.open({ kind: 'goto' });
    f.palette.setQuery('st');
    expect(state(f).rows.map((row) => row.availability)).toEqual([{ state: 'unavailable', reason: 'ghost is not installed' }, { state: 'unavailable', reason: 'No cluster is selected' }]);
  });

  it('is available again when the plugin is back, once the host says what it says changed', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [instances()]));
    f.tabs.world.report('cloud', { state: 'unavailable', reason: 'off' });
    f.palette.open({ kind: 'goto' });
    f.palette.setQuery('inst');
    f.tabs.world.report('cloud', undefined);
    expect(state(f).rows[0]?.availability.state).toBe('unavailable');
    f.palette.refresh();
    expect(state(f).rows[0]?.availability.state).toBe('available');
  });
});

describe('P4: a setting is the Settings page with its row as the reveal (K1)', () => {
  const settings = (f: Fixture): void => {
    f.palette.registerProvider({
      id: 'host:settings',
      plugin: 'host',
      section: 'settings',
      title: 'Settings',
      match: () => [
        { id: 'motion', kind: 'setting', title: 'Motion', route: { plugin: 'host', contribution: 'settings' }, reveal: { key: 'appearance.motion' } },
        { id: 'theme', kind: 'setting', title: 'Theme', route: { plugin: 'host', contribution: 'settings' }, reveal: { key: 'appearance.theme' } },
      ],
    });
  };

  const choose = (f: Fixture, title: string, how?: ModifierEvent | OpenHow) => {
    f.palette.open({ kind: 'settings' });
    f.palette.setQuery(title);
    return f.palette.activate(undefined, how);
  };

  it('opens the one Settings tab and points it at each row in turn: never a second tab', () => {
    const f = makePalette();
    settings(f);
    f.tabs.open({ route: { plugin: 'cloud', contribution: 'instances' } });
    const first = choose(f, 'motion');
    expect(first).toMatchObject({ status: 'opened', result: { status: 'done', change: 'created' } });
    const id = first.status === 'opened' && first.result.status === 'done' ? first.result.id : '';
    expect(f.tabs.state().tabs[id]?.reveal?.payload).toEqual({ key: 'appearance.motion' });
    f.tabs.store.activate(f.tabs.ids()[0] ?? '');
    const second = choose(f, 'theme');
    expect(second).toMatchObject({ status: 'opened', result: { status: 'done', change: 'activated', id } });
    expect(f.tabs.state().tabs[id]?.reveal?.payload).toEqual({ key: 'appearance.theme' });
    expect(f.tabs.ids().filter((tab) => f.tabs.state().tabs[tab]?.location.route.contribution === 'settings')).toHaveLength(1);
    expect(f.tabs.active()).toBe(id);
  });

  it('with the command key opens it behind the page the user is on and moves nothing', () => {
    const f = makePalette();
    settings(f);
    const here = f.tabs.open({ route: { plugin: 'cloud', contribution: 'instances' } });
    const result = choose(f, 'motion', { metaKey: true });
    expect(result).toMatchObject({ status: 'opened', result: { status: 'done', focused: false } });
    expect(f.tabs.active()).toBe(here);
    expect(f.tabs.ids()).toHaveLength(2);
  });

  it('goes where a page already is: the same place is one tab', () => {
    const f = makePalette();
    f.palette.registerProvider(cloud(() => [instances()]));
    f.palette.open({ kind: 'goto' });
    f.palette.activate();
    f.palette.open({ kind: 'goto' });
    f.palette.activate();
    expect(f.tabs.ids()).toHaveLength(1);
  });
});

describe('P5: a plugin whose functions throw never breaks the model (S89)', () => {
  it('survives a provider that throws, one whose search throws at once, a host that cannot say if a route can open, and a plugin that cannot describe a place', async () => {
    const f = makePalette();
    f.palette.registerProvider({
      id: 'broken:pages',
      plugin: 'broken',
      section: 'goto',
      match: () => {
        throw new Error('match');
      },
    });
    f.palette.registerProvider({
      id: 'broken:names',
      plugin: 'broken',
      section: { id: 'names', title: 'Names' },
      search: () => {
        throw new Error('search');
      },
    });
    f.palette.registerProvider(cloud(() => [instances(), page('b', 'Broken page', { route: { plugin: 'broken', contribution: 'x' } })]));
    f.palette.record({ route: { plugin: 'broken', contribution: 'y' }, title: 'Saved title' });
    f.palette.open();
    f.palette.setQuery('i');
    await f.clock.advance(200);
    // The place of the plugin that cannot say is taken to be available: a failed check never locks the user out of a page.
    expect(state(f).rows.map((row) => [row.title.text, row.availability.state])).toEqual([['Instances', 'available']]);
    f.palette.setQuery('broken');
    await f.clock.advance(200);
    expect(state(f).rows.map((row) => [row.title.text, row.availability.state])).toEqual([['Broken page', 'available']]);
    // The failures were reported, one for each, and said for the provider alone.
    expect(f.errors.map((error) => error.where)).toEqual(expect.arrayContaining(['match() of broken:pages', 'search() of broken:names', 'availability() of broken']));
    expect(state(f).runs.map((run) => run.id)).toEqual(expect.arrayContaining(['broken:pages', 'broken:names']));
    // A recent whose plugin cannot describe it keeps the name it was saved with.
    f.palette.close();
    f.tabs.world.report('broken', { state: 'available' });
    f.palette.open();
    expect(state(f).rows.map((row) => row.title.text)).toEqual(['Saved title']);
  });
});

describe('P6: the saved recents are written after a delay, only when they changed, and on demand', () => {
  it('writes once, 300 ms after the last change, and never for a query', () => {
    vi.useFakeTimers();
    const f = makePalette();
    const writes: PersistedPalette[] = [];
    const saver = createPaletteSaver({ store: f.palette, write: (value) => writes.push(value), delay: 300 });
    f.palette.open();
    f.palette.setQuery('vol');
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([]);
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes' });
    f.palette.record({ route: { plugin: 'cloud', contribution: 'buckets' }, title: 'Buckets' });
    vi.advanceTimersByTime(299);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.recents.map((recent) => recent.title)).toEqual(['Buckets', 'Volumes']);
    saver.dispose();
  });

  it('flushes what is owed at once, and writes nothing twice', () => {
    vi.useFakeTimers();
    const f = makePalette();
    const writes: PersistedPalette[] = [];
    const saver = createPaletteSaver({ store: f.palette, write: (value) => writes.push(value), delay: 50 });
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes' });
    saver.flush();
    expect(writes).toHaveLength(1);
    saver.flush();
    vi.advanceTimersByTime(500);
    expect(writes).toHaveLength(1);
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes' });
    vi.advanceTimersByTime(500);
    expect(writes).toHaveLength(1);
    saver.dispose();
  });
});

describe('P7: a chord is shown only when the host binds it (A9)', () => {
  it('draws the host\'s chord for a command, and none for one the host did not bind', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'host:c', plugin: 'host', section: 'commands', match: () => [command('a', 'Reopen closed tab', { shortcut: '⌘⇧T' }), command('b', 'Toggle panel')] });
    f.palette.open({ kind: 'commands' });
    expect(state(f).rows.map((row) => [row.title.text, row.shortcut])).toEqual([['Reopen closed tab', '⌘⇧T'], ['Toggle panel', undefined]]);
  });
});

describe('Q1 (QA-SF-09): commands are told apart by identity, never by title', () => {
  it('lists two commands with one title once each, and one command a provider lists twice once', () => {
    const f = makePalette();
    f.palette.registerProvider({
      id: 'host:c',
      plugin: 'host',
      section: 'commands',
      match: () => [command('panel.find', 'Find in terminal', { context: 'Panel' }), command('terminal.find', 'Find in terminal', { context: 'Terminal' }), command('panel.find', 'Find in terminal', { context: 'Panel' })],
    });
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('find');
    expect(state(f).rows.map((row) => [row.title.text, row.context.text])).toEqual([['Find in terminal', 'Panel'], ['Find in terminal', 'Terminal']]);
  });
});
