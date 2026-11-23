import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, RESTORED_CAUSE, type PanelStore } from '../core/panel';
import { createTabsStore, type TabsStore } from '../core/tabs';
import { cloudPage, FIXTURE_PLUGINS, makeWorld, stackPage, type World } from '../core/tabs/testing';
import { createRailChoice, loadSession, MIGRATIONS, QUARANTINE_PREFIX, SESSION_VERSION, type Lifecycle, type LoadedSession, type RailChoice, type Restored, type SessionOptions, type SessionStorage } from './index';
import { flag, memoryStorage, type Flag, type Memory } from './testing';

// The session: loaded before the window draws, restored into the two models, saved one burst at a time, and never the reason the window does not start. The cases are the ones the assignment of
// step S3a names (round trip, migration from an older version, quarantine, a plugin that is not there yet) and the ones that follow from "never a crash, never a blank window".

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The notes the session wrote to its log. */
function notes() {
  const log = vi.fn<(message: string, detail?: unknown) => void>();
  return { log, messages: () => log.mock.calls.map(([message]) => message) };
}

const optionsOf = (log: SessionOptions['log'], extra: Partial<SessionOptions> = {}): SessionOptions => ({ now: () => NOW, log, ...extra });

type Life = {
  readonly world: World;
  readonly tabs: TabsStore;
  readonly panel: PanelStore;
  readonly rail: RailChoice;
  readonly screenReader: Flag;
  readonly stop: () => void;
  readonly restored: Restored;
  readonly hide: () => void;
};

/** A fake page lifecycle: `hide` is the window going away. */
function pageLifecycle() {
  const listeners = new Set<() => void>();
  const lifecycle: Lifecycle = {
    onHide: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    lifecycle,
    hide: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    count: () => listeners.size,
  };
}

/** One life of the window: the session restored into a tab model and a panel model over a world of plugins, and attached. `plugins` leaves out the ones that have not loaded yet. */
function live(loaded: LoadedSession, { world = makeWorld(), without = [] as readonly string[] } = {}): Life {
  world.setHome(false);
  for (const id of without) {
    world.uninstall(id);
  }

  const restored = loaded.restore({ contributions: world.contributions });
  let counter = 0;
  const tabs = createTabsStore({ contributions: world.contributions, newId: () => `t${String((counter += 1))}`, ...(restored.tabs === undefined ? {} : { initial: restored.tabs }) });
  const panel = createPanelStore({ ...(restored.panel === undefined ? {} : { initial: restored.panel }), newId: () => `s${String((counter += 1))}` });
  const rail = createRailChoice(restored.rail ?? null);
  const screenReader = flag(restored.terminalScreenReader);
  const page = pageLifecycle();
  const stop = loaded.attach({ tabs, panel, rail, terminalScreenReader: screenReader, lifecycle: page.lifecycle });
  return { world, tabs, panel, rail, screenReader, stop, restored, hide: page.hide };
}

const titles = (tabs: TabsStore) => tabs.getSnapshot().order.map((id) => tabs.getSnapshot().tabs[id]?.face.title);
const settle = async (ms = 400) => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** The tools of the window the way the host registers them: the host's `logs`, and what each live plugin brings. */
function equip(panel: PanelStore, plugins: readonly string[] = ['cloud', 'stack']) {
  panel.registerTool({ id: 'logs', label: 'Logs', icon: 'box', order: 20 });
  panel.syncPlugins(plugins.map((id) => ({ id, tools: id === 'cloud' ? [{ id: 'streams', label: 'Streams', icon: 'box' }] : [] })));
}

describe('a window that is saved and comes back', () => {
  it('has its tabs, the one on screen, the rail and the panel as the user left them, written in one document', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    expect(first.restored).toEqual({ tabs: undefined, panel: undefined, rail: undefined, terminalScreenReader: false });
    first.tabs.open(cloudPage('instances'));
    first.tabs.open(stackPage('services', { connection: 'north' }), { how: 'new' });
    equip(first.panel);
    first.panel.show({ tool: 'cloud:streams' });
    first.panel.resize({ size: 333 });
    first.rail.set('cloud');
    await settle();

    expect(memory.writes).toHaveLength(1);
    const document: unknown = JSON.parse(memory.writes[0] ?? '');
    expect(document).toMatchObject({ version: SESSION_VERSION, rail: 'cloud', tabs: { version: 1 }, panel: { version: 1, open: true, height: 333, tool: 'cloud:streams' } });

    const second = live(await loadSession(memory.storage, optionsOf(notes().log)));
    expect(titles(second.tabs)).toEqual(['Instances', 'Services']);
    expect(second.tabs.getSnapshot().active).toBe(first.tabs.getSnapshot().active);
    expect(second.tabs.getSnapshot().order).toEqual(first.tabs.getSnapshot().order);
    expect(second.rail.getSnapshot()).toBe('cloud');
    expect(second.panel.getSnapshot()).toMatchObject({ open: true, height: 333, tool: 'cloud:streams' });
    // Only the tab on screen has a page: a restored tab is mounted when it is shown.
    expect(second.tabs.getSnapshot().mounted).toEqual([second.tabs.getSnapshot().active]);
    // What was saved is what is held now: restoring wrote nothing.
    await settle(1000);
    expect(memory.writes).toHaveLength(1);
  });

  it('brings the Terminal\'s screen reader mode back as the person left it: off in a window that never chose, saved with the burst when it is chosen, on in the next run', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    expect(first.screenReader.getSnapshot()).toBe(false);
    first.screenReader.set(true);
    await settle(399);
    expect(memory.writes).toEqual([]);
    await settle(1);
    expect(memory.writes).toHaveLength(1);
    expect(JSON.parse(memory.writes[0] ?? '')).toMatchObject({ version: SESSION_VERSION, terminalScreenReader: true });

    const second = live(await loadSession(memory.storage, optionsOf(notes().log)));
    expect(second.restored.terminalScreenReader).toBe(true);
    expect(second.screenReader.getSnapshot()).toBe(true);
    // What was saved is what is held now: restoring wrote nothing.
    await settle(1000);
    expect(memory.writes).toHaveLength(1);

    second.screenReader.set(false);
    await settle();
    expect(JSON.parse(memory.writes[1] ?? '')).toMatchObject({ terminalScreenReader: false });
  });

  it('brings a session saved by the first release (version 1, no screen reader choice) back with the mode off, and writes the current version from the next change on', async () => {
    const memory = memoryStorage(JSON.stringify({ version: 1, tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1, open: true, height: 301, tool: 'logs', active: {}, sessions: [] } }));
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    expect(life.restored).toMatchObject({ rail: 'cloud', terminalScreenReader: false });
    expect(life.screenReader.getSnapshot()).toBe(false);
    expect(messages()).toEqual([]);
    expect(memory.kept.size).toBe(0);
    await settle(1000);
    expect(memory.writes).toEqual([]);

    life.screenReader.set(true);
    await settle();
    expect(JSON.parse(memory.writes[0] ?? '')).toMatchObject({ version: SESSION_VERSION, rail: 'cloud', terminalScreenReader: true });
  });

  it('writes one document for a burst of changes of the tabs, the panel and the rail, 400 ms after the last, and nothing for a change that comes back', async () => {
    const memory = memoryStorage();
    const life = live(await loadSession(memory.storage, optionsOf(notes().log)));
    life.tabs.open(cloudPage('instances'));
    await settle(300);
    equip(life.panel);
    life.rail.set('stack');
    await settle(399);
    expect(memory.writes).toEqual([]);
    await settle(1);
    expect(memory.writes).toHaveLength(1);

    life.rail.set('cloud');
    life.rail.set('stack');
    await settle(400);
    expect(memory.writes).toHaveLength(1);
  });

  it('does not write for what is not saved: a page\'s state and a tab being shown again', async () => {
    const memory = memoryStorage();
    const life = live(await loadSession(memory.storage, optionsOf(notes().log)));
    const id = life.tabs.open(cloudPage('instances'));
    expect(id.status).toBe('done');
    await settle();
    const written = memory.writes.length;
    const tab = life.tabs.getSnapshot().active ?? '';
    life.tabs.setPageState(tab, { scroll: 120 });
    life.tabs.activate(tab);
    await settle(1000);
    expect(memory.writes).toHaveLength(written);
  });

  it('brings a window with no tab in it back as an empty window, and says nothing about it', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    first.tabs.open(cloudPage('instances'));
    first.tabs.close();
    first.rail.set('cloud');
    await settle();

    const quiet = notes();
    const second = live(await loadSession(memory.storage, optionsOf(quiet.log)));
    expect(second.tabs.getSnapshot().order).toEqual([]);
    expect(second.restored.tabs).toBeUndefined();
    expect(second.rail.getSnapshot()).toBe('cloud');
    expect(quiet.messages()).toEqual([]);
    expect(memory.kept.size).toBe(0);
  });

  it('brings the panel back as the user left it when it holds no session, and closed, with its sessions ended, when it holds one (S116)', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    equip(first.panel);
    first.panel.show({ tool: 'logs' });
    first.panel.resize({ size: 301 });
    await settle();
    const bare = live(await loadSession(memory.storage, optionsOf(notes().log)));
    expect(bare.panel.getSnapshot()).toMatchObject({ open: true, height: 301, tool: 'logs' });
    bare.stop();

    const opened = first.panel.openSession({ tool: 'logs', plugin: 'cloud', title: 'worker', scope: 'north' });
    expect(opened.status).toBe('done');
    if (opened.status === 'done') {
      first.panel.setSessionState(opened.id, { state: 'running' });
    }

    await settle();
    const second = live(await loadSession(memory.storage, optionsOf(notes().log)));
    equip(second.panel);
    const state = second.panel.getSnapshot();
    expect(state).toMatchObject({ open: false, height: 301, tool: 'logs' });
    const restored = Object.values(state.sessions);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ title: 'worker', scope: 'north', plugin: 'cloud', state: 'ended', cause: RESTORED_CAUSE });
    expect(second.panel.selectors.sessionIds(second.panel.getSnapshot(), 'logs')).toEqual(restored.map((session) => session.id));
  });

  it('keeps the tab of a plugin that has not loaded yet, as it was drawn, and describes it when the plugin registers', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    first.tabs.open(cloudPage('instances'));
    first.tabs.open(stackPage('services', { connection: 'north' }), { how: 'new' });
    await settle();

    // The second run: the plugin of the second tab has not registered yet, and the window is drawn without it.
    const second = live(await loadSession(memory.storage, optionsOf(notes().log)), { without: ['stack'] });
    expect(titles(second.tabs)).toEqual(['Instances', 'Services']);
    expect(second.tabs.getSnapshot().active).toBe(first.tabs.getSnapshot().active);
    const [, pending] = second.tabs.getSnapshot().order;
    expect(second.tabs.getSnapshot().tabs[pending ?? '']?.location.route).toMatchObject({ plugin: 'stack', contribution: 'services', params: { connection: 'north' } });

    // It registers, and says something else: the tab is described again and is the same tab.
    const stack = FIXTURE_PLUGINS.find((plugin) => plugin.id === 'stack');
    if (stack === undefined) {
      throw new Error('the fixture has no stack plugin');
    }

    second.world.install(stack);
    second.world.retitle('stack', () => 'Services of north');
    second.world.changed();
    expect(titles(second.tabs)).toEqual(['Instances', 'Services of north']);
    expect(second.tabs.getSnapshot().order[1]).toBe(pending);
  });

  it('keeps a tab whose plugin never registers: it stays in the strip, with its route, and is saved again', async () => {
    const memory = memoryStorage();
    const first = live(await loadSession(memory.storage, optionsOf(notes().log)));
    first.tabs.open(stackPage('services', { connection: 'north' }));
    await settle();
    const saved = memory.text();

    const second = live(await loadSession(memory.storage, optionsOf(notes().log)), { without: ['stack'] });
    second.rail.set('cloud');
    await settle();
    expect(second.tabs.getSnapshot().order).toHaveLength(1);
    expect(second.tabs.getSnapshot().tabs[second.tabs.getSnapshot().order[0] ?? '']?.location.route).toMatchObject({ plugin: 'stack', contribution: 'services' });
    // What the next run reads still names the tab: losing a plugin for one run does not lose its tabs.
    const third = live(await loadSession(memory.storage, optionsOf(notes().log)), { without: ['stack'] });
    expect(titles(third.tabs)).toEqual(['Services']);
    expect(saved).toContain('services');
  });
});

describe('a session that cannot be used is kept aside and the window starts empty', () => {
  const unusable: ReadonlyArray<readonly [string, string, string]> = [
    ['is not JSON', '{"version":1,"tabs":', 'unreadable'],
    ['is not a document', '"just words"', 'unreadable'],
    ['has no version', JSON.stringify({ tabs: { version: 1, tabs: [] } }), 'unreadable'],
    ['was saved by a newer version', JSON.stringify({ version: SESSION_VERSION + 1, tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1 } }), 'foreign-version'],
  ];

  it.each(unusable)('a session that %s', async (_name, text, reason) => {
    const memory = memoryStorage(text);
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    expect(life.restored).toEqual({ tabs: undefined, panel: undefined, rail: undefined, terminalScreenReader: false });
    expect(life.tabs.getSnapshot().order).toEqual([]);
    await settle(0);

    // Kept aside whole, under a name that says what it is and when, with why; and never deleted: the text is in the record exactly as it was.
    const name = `${QUARANTINE_PREFIX}${String(NOW)}`;
    expect([...memory.kept.keys()]).toEqual([name]);
    expect(JSON.parse(memory.kept.get(name) ?? '')).toMatchObject({ at: NOW, reason, text });
    expect(messages()).toEqual([expect.stringContaining('kept aside') as string]);
    expect(messages()[0]).toContain(name);
    expect(messages()[0]).toContain('starts empty');

    // The place that held it holds a session of this version from now on, not the text that was kept.
    expect(JSON.parse(memory.text() ?? '')).toMatchObject({ version: SESSION_VERSION, tabs: { tabs: [] }, rail: null });
  });

  it('does not keep a second copy of the same text for each run that starts and stops before anything changes', async () => {
    const memory = memoryStorage('not json');
    live(await loadSession(memory.storage, optionsOf(notes().log)));
    await settle(0);
    expect(memory.kept.size).toBe(1);
    const again = notes();
    live(await loadSession(memory.storage, optionsOf(again.log)));
    await settle(0);
    expect(memory.kept.size).toBe(1);
    expect(again.messages()).toEqual([]);
  });

  it('keeps a text per time, so two different ones never replace each other', async () => {
    const memory = memoryStorage('first bad text');
    live(await loadSession(memory.storage, optionsOf(notes().log)));
    await settle(0);
    memory.set('second bad text');
    live(await loadSession(memory.storage, optionsOf(notes().log, { now: () => NOW + 5 })));
    await settle(0);
    expect([...memory.kept.keys()]).toEqual([`${QUARANTINE_PREFIX}${String(NOW)}`, `${QUARANTINE_PREFIX}${String(NOW + 5)}`]);
    expect([...memory.kept.values()].map((record) => (JSON.parse(record) as { text: string }).text)).toEqual(['first bad text', 'second bad text']);
  });

  it('uses the part that can be read and keeps the whole text aside when the other cannot: a tab model of a newer version does not cost the panel', async () => {
    const text = JSON.stringify({
      version: SESSION_VERSION,
      tabs: { version: 99, active: null, tabs: [] },
      rail: 'cloud',
      panel: { version: 1, open: true, height: 300, tool: 'logs', active: {}, sessions: [] },
    });
    const memory = memoryStorage(text);
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    expect(life.restored.tabs).toBeUndefined();
    expect(life.restored.panel).toMatchObject({ open: true, height: 300, tool: 'logs' });
    expect(life.restored.rail).toBe('cloud');
    await settle(0);
    expect([...memory.kept.keys()]).toEqual([`${QUARANTINE_PREFIX}${String(NOW)}`]);
    expect(JSON.parse(memory.kept.get(`${QUARANTINE_PREFIX}${String(NOW)}`) ?? '')).toMatchObject({ reason: 'foreign-version', text });
    expect(messages()).toEqual([expect.stringContaining('tabs') as string]);
  });

  it('keeps the text aside when tabs were listed and none can be read, and not when the list is empty', async () => {
    const damaged = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: 'a', tabs: [{ id: 'a', route: 5 }, 'junk'] }, rail: null, panel: { version: 1 } });
    const memory = memoryStorage(damaged);
    live(await loadSession(memory.storage, optionsOf(notes().log)));
    await settle(0);
    expect(memory.kept.size).toBe(1);
  });

  it('repairs a session whose tabs are partly damaged: the tabs that can be read come back, a note says what was dropped, and nothing is kept aside', async () => {
    const world = makeWorld();
    const route = { plugin: 'cloud', contribution: 'instances', params: {} };
    const text = JSON.stringify({
      version: SESSION_VERSION,
      tabs: { version: 1, active: 'b', tabs: [{ id: 'a', route }, { id: 'broken', route: 5 }, { id: 'b', route: { ...route, contribution: 'buckets' } }] },
      rail: null,
      panel: { version: 1 },
    });
    const memory = memoryStorage(text);
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)), { world });
    expect(life.tabs.getSnapshot().order).toEqual(['a', 'b']);
    expect(life.tabs.getSnapshot().active).toBe('b');
    expect(messages()).toEqual([expect.stringContaining('repaired') as string]);
    expect(memory.kept.size).toBe(0);
  });

  it('writes nothing, ever, when the text could not be kept aside: it would replace what was not saved anywhere else', async () => {
    const memory = memoryStorage('bad text');
    memory.fail('keep', new Error('the disk is full'));
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    life.tabs.open(cloudPage('instances'));
    life.rail.set('cloud');
    await settle(2000);
    expect(memory.writes).toEqual([]);
    expect(memory.text()).toBe('bad text');
    expect(messages()).toEqual([expect.stringContaining('could not be kept aside') as string]);
  });

  it('keeps it aside once however often it is restored (a component that renders twice)', async () => {
    const memory = memoryStorage('bad text');
    const loaded = await loadSession(memory.storage, optionsOf(notes().log));
    const world = makeWorld();
    loaded.restore({ contributions: world.contributions });
    loaded.restore({ contributions: world.contributions });
    await settle(0);
    expect(memory.kept.size).toBe(1);
  });
});

describe('a place that cannot be read', () => {
  it('starts the window empty, says so, and writes nothing: what it holds is not known, and a write would replace it', async () => {
    const memory = memoryStorage('{"version":1}');
    memory.fail('read', new Error('the window is not registered'));
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    life.tabs.open(cloudPage('instances'));
    await settle(2000);
    expect(life.restored).toEqual({ tabs: undefined, panel: undefined, rail: undefined, terminalScreenReader: false });
    expect(memory.writes).toEqual([]);
    expect(messages()).toEqual([expect.stringContaining('could not be read') as string]);
    expect(messages()[0]).toContain('the window is not registered');
  });

  it('gives up waiting for a place that does not answer, and an answer that comes late changes nothing', async () => {
    const memory = memoryStorage();
    const slow = memory.hold();
    const { log, messages } = notes();
    const loading = loadSession(memory.storage, optionsOf(log, { deadline: 500 }));
    await settle(499);
    let done = false;
    void loading.then(() => {
      done = true;
    });
    await settle(0);
    expect(done).toBe(false);
    await settle(1);
    const loaded = await loading;
    const life = live(loaded);
    slow.release(JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1 } }));
    life.tabs.open(cloudPage('instances'));
    await settle(2000);
    expect(life.restored).toEqual({ tabs: undefined, panel: undefined, rail: undefined, terminalScreenReader: false });
    expect(memory.writes).toEqual([]);
    expect(messages()).toEqual([expect.stringContaining('did not answer') as string]);
  });
});

describe('a session of an older version', () => {
  it('is migrated before it is read, and is saved at the version this build writes', async () => {
    // Version 0 of the wrapper held the rail's choice under `railPlugin`; the step from version 1 is the real one, which adds the Terminal's screen reader choice, off.
    const old = JSON.stringify({ version: 0, tabs: { version: 1, active: null, tabs: [] }, railPlugin: 'stack', panel: { version: 1 } });
    const memory = memoryStorage(old);
    const steps = {
      0: (value: Record<string, unknown>) => {
        const { railPlugin, ...rest } = value;
        return { ...rest, version: 1, rail: railPlugin };
      },
      ...MIGRATIONS,
    };
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log, { steps })));
    expect(life.rail.getSnapshot()).toBe('stack');
    expect(life.screenReader.getSnapshot()).toBe(false);
    expect(messages()).toEqual([]);
    expect(memory.kept.size).toBe(0);
    life.tabs.open(cloudPage('instances'));
    await settle();
    expect(JSON.parse(memory.text() ?? '')).toMatchObject({ version: SESSION_VERSION, rail: 'stack' });
  });
});

describe('the writing', () => {
  it('writes one at a time and in order: a write starts after the one before it has answered', async () => {
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const storage: SessionStorage = {
      read: async () => undefined,
      write: async (text) => {
        started.push(text);
        const { promise, resolve } = Promise.withResolvers<void>();
        gates.push(resolve);
        return promise;
      },
      keep: async () => undefined,
    };
    const life = live(await loadSession(storage, optionsOf(notes().log)));
    life.rail.set('cloud');
    await settle();
    life.rail.set('stack');
    await settle();
    expect(started).toHaveLength(1);
    gates[0]?.();
    await settle(0);
    expect(started).toHaveLength(2);
    expect(JSON.parse(started[1] ?? '')).toMatchObject({ rail: 'stack' });
  });

  it('says when a write failed, goes on, and writes the next change', async () => {
    const memory = memoryStorage();
    const { log, messages } = notes();
    const life = live(await loadSession(memory.storage, optionsOf(log)));
    memory.fail('write', new Error('refused'));
    life.rail.set('cloud');
    await settle();
    expect(memory.writes).toEqual([]);
    expect(messages()).toEqual([expect.stringContaining('could not be saved') as string]);
    memory.fail('write', undefined);
    life.rail.set('stack');
    await settle();
    expect(memory.writes).toHaveLength(1);
    expect(JSON.parse(memory.writes[0] ?? '')).toMatchObject({ rail: 'stack' });
  });

  it('writes at once when the window is going away, and stops listening when it is stopped', async () => {
    const memory = memoryStorage();
    const life = live(await loadSession(memory.storage, optionsOf(notes().log)));
    life.rail.set('cloud');
    life.hide();
    await settle(0);
    expect(memory.writes).toHaveLength(1);

    life.rail.set('stack');
    life.stop();
    await settle(0);
    expect(memory.writes).toHaveLength(2);
    life.rail.set('cloud');
    life.hide();
    await settle(1000);
    expect(memory.writes).toHaveLength(2);
  });
});

describe('the rail\'s choice', () => {
  it('is a value that tells its subscribers when it changes, and only then', () => {
    const rail = createRailChoice();
    expect(rail.getSnapshot()).toBeNull();
    const heard = vi.fn();
    const stop = rail.subscribe(heard);
    rail.set('cloud');
    rail.set('cloud');
    rail.set(null);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    rail.set('stack');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(rail.getSnapshot()).toBe('stack');
  });
});

describe('what the session logs by default', () => {
  it('goes to the console as a warning, under the session\'s name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const memory: Memory = memoryStorage('not json');
    live(await loadSession(memory.storage, { now: () => NOW }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[session]'), expect.anything());
    warn.mockRestore();
  });
});
