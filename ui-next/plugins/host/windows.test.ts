import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore } from '../../shell/core/panel';
import { boot, cloudPage, hostPage, type Harness } from '../../shell/core/tabs/testing';
import { checkInvariants, STATE_VERSION as TABS_VERSION, type TabReceiver, type TabsStore } from '../../shell/core/tabs';
import type { PluginEntry } from './pluginStore';
import { createConnectionActions } from './connections/actions';
import type { ConnectionsStore } from './connections/store';
import { withWindows, type WindowService } from './windows';

// A window opening another, over the host's window service (a recording stand-in, so what is under test is what the host asks of it and what the model does with the answer).

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// What the host's events do: every window hears an event, a moment after it was sent.
function bus() {
  const heard = new Map<string, Set<(data: unknown) => void>>();
  return {
    emit: vi.fn<WindowService['emit']>(async (event, data) => {
      for (const listener of heard.get(event) ?? []) {
        queueMicrotask(() => {
          listener(data);
        });
      }
    }),
    on: (event: string, listener: (data: unknown) => void) => {
      heard.set(event, (heard.get(event) ?? new Set()).add(listener));
      return () => heard.get(event)?.delete(listener);
    },
  };
}

// The service's drag session over the bus, as `backend/window/drag.go` runs it: the window under the pointer is the one the test names (none, at first); it is told hover, leave and drop, and answers the drop with what that window
// says; every window hears the begin and the end. `log` says what the source asked of the service, in order.
function coordinator(events: ReturnType<typeof bus>) {
  const sessions = new Map<string, { payload: string; over: string | undefined }>();
  const answers = new Map<string, PromiseWithResolvers<boolean>>();
  const pointer: { over: string | undefined } = { over: undefined };
  const log: string[] = [];
  const say = async (event: string, data: Record<string, unknown>) => events.emit(`windows/drag/${event}`, data);
  const point = async (sessionId: string, event: 'hover' | 'drop', x: number, y: number) => {
    const session = sessions.get(sessionId);
    if (session?.over !== undefined && session.over !== pointer.over) {
      await say('leave', { sessionId, targetWindow: session.over });
    }

    if (session !== undefined) {
      session.over = event === 'hover' ? pointer.over : undefined;
    }

    if (pointer.over !== undefined) {
      await say(event, { sessionId, targetWindow: pointer.over, payload: session?.payload, clientX: x, clientY: y });
    }
  };

  return {
    pointer,
    log,
    beginDrag: vi.fn<WindowService['beginDrag']>(async ({ sessionId, sourceWindow, dragType, payload }) => {
      log.push('begin');
      sessions.set(sessionId, { payload, over: undefined });
      await say('begin', { sessionId, sourceWindow, dragType });
    }),
    moveDrag: vi.fn<WindowService['moveDrag']>(async (sessionId, x, y) => {
      log.push('move');
      await point(sessionId, 'hover', x, y);
    }),
    endDrag: vi.fn<WindowService['endDrag']>(async (sessionId, x, y) => {
      log.push('end');
      const answer = Promise.withResolvers<boolean>();
      answers.set(sessionId, answer);
      const target = pointer.over;
      await point(sessionId, 'drop', x, y);
      const accepted = target !== undefined && (await answer.promise);
      sessions.delete(sessionId);
      await say('end', { sessionId });
      return { accepted, targetWindow: target ?? '' };
    }),
    cancelDrag: vi.fn<WindowService['cancelDrag']>(async (sessionId) => {
      log.push('cancel');
      const over = sessions.get(sessionId)?.over;
      if (over !== undefined) {
        await say('leave', { sessionId, targetWindow: over });
      }

      sessions.delete(sessionId);
      await say('end', { sessionId });
    }),
    respondDrop: vi.fn<WindowService['respondDrop']>(async (sessionId, accepted) => {
      answers.get(sessionId)?.resolve(accepted);
    }),
  };
}

type Listed = ReadonlyArray<{ readonly name: string; readonly kind: string }>;

function world(name = 'main', panel = createPanelStore(), events = bus(), listed: Listed = [{ name, kind: 'workspace' }], drag = coordinator(events), naming: WindowService['name'] = async () => name) {
  const h = boot();
  const service = {
    name: vi.fn(naming),
    open: vi.fn<WindowService['open']>(async () => 'window-2'),
    close: vi.fn<WindowService['close']>(async () => undefined),
    focus: vi.fn<WindowService['focus']>(async () => undefined),
    place: vi.fn<WindowService['place']>(async () => undefined),
    viewport: vi.fn<WindowService['viewport']>(async () => undefined),
    list: vi.fn<WindowService['list']>(async () => listed),
    ...events,
    beginDrag: drag.beginDrag,
    moveDrag: drag.moveDrag,
    endDrag: drag.endDrag,
    cancelDrag: drag.cancelDrag,
    respondDrop: drag.respondDrop,
  };
  const tabs: TabsStore = withWindows(h.store, panel, service);
  return { h, panel, service, tabs, events, drag };
}

const sessionOf = (text: string | undefined) => JSON.parse(text ?? 'null') as { version: number; tabs: { version: number; active: string; tabs: Array<{ id: string; route: unknown }> } };
const sidebarView = { kind: 'extension-view', plugin: 'cloud', point: 'tools', offer: 'peer/manager', connection: 'west' } as const;

// The stand-in service answers at once, so what the host does after an answer has happened within a few microtask turns (a drag that ends in a window of its own takes some tens).
const settled = async () => {
  for (let turn = 0; turn < 80; turn += 1) {
    await Promise.resolve();
  }
};

describe('how: window in a native window', () => {
  it('opens one window of the workspace with a session of one tab at the route, and leaves this window as it was', () => {
    const { h, service, tabs } = world();
    const before = h.state();

    const result = tabs.open(cloudPage('buckets'), { how: 'window' });

    expect(result).toMatchObject({ status: 'window', route: { plugin: 'cloud', contribution: 'buckets' } });
    expect(service.open).toHaveBeenCalledTimes(1);
    const session = sessionOf(service.open.mock.calls[0]?.[0]);
    expect(session.tabs.tabs).toHaveLength(1);
    expect(session.tabs.tabs[0]).toMatchObject({ route: { plugin: 'cloud', contribution: 'buckets' } });
    expect(session.tabs.active).toBe(session.tabs.tabs[0]?.id);
    expect(h.state()).toBe(before);
  });

  it('starts a fresh window with only the mounted locator, not a copy of the source history or authority', () => {
    const { h, service, tabs } = world();
    const source = h.state();
    expect(tabs.open({ route: sidebarView }, { how: 'window' })).toMatchObject({ status: 'window', route: sidebarView });
    const session = sessionOf(service.open.mock.calls[0]?.[0]);
    expect(session.tabs).toEqual({ version: TABS_VERSION, active: session.tabs.active, tabs: [{ id: session.tabs.active, route: sidebarView }] });
    expect(h.state()).toBe(source);
  });

  it('moves a singleton that is open: the new window starts with that tab, and once it exists the tab leaves this strip', async () => {
    const { h, service, tabs } = world();
    const settings = h.open(hostPage('settings'), { how: 'new' });

    tabs.open(hostPage('settings'), { how: 'window' });

    expect(sessionOf(service.open.mock.calls[0]?.[0]).tabs.tabs[0]?.id).toBe(settings);
    await settled();
    expect(h.ids()).not.toContain(settings);
  });

  it.each([
    ['opens over a singleton', hostPage('settings'), (tabs: TabsStore) => tabs.open(hostPage('settings'), { how: 'window' })],
    ['is moved to a new window', cloudPage('buckets'), (tabs: TabsStore, id: string) => tabs.windows?.moveToNew(id)],
    ['is released outside the strip', cloudPage('buckets'), (tabs: TabsStore, id: string) => {
      const way = tabs.windows?.dragOut(id);
      way?.move(640, 320);
      way?.drop(640, 320);
    }],
  ])('keeps the tab where it is, and warns, when the window cannot be opened for a tab that %s', async (_how, page, go) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, service, tabs } = world();
    const id = h.open(page, { how: 'new' });
    service.open.mockRejectedValue(new Error('no window'));

    go(tabs, id);
    await settled();

    expect(h.ids()).toContain(id);
    expect(warn).toHaveBeenCalled();
  });

  it('asks first when the singleton has unsaved changes, and opens nothing', () => {
    const { h, service, tabs } = world();
    const settings = h.open(hostPage('settings'), { how: 'new' });
    h.store.setUnsaved(settings, true);

    expect(tabs.open(hostPage('settings'), { how: 'window' })).toEqual({ status: 'confirm', action: 'close', tabs: [settings] });
    expect(service.open).not.toHaveBeenCalled();
  });
});

describe('how: window where the app has no windows (a browser tab)', () => {
  const browser = () => {
    const h = boot();
    return { h, tabs: withWindows(h.store, createPanelStore(), undefined) };
  };

  it('is refused with a reason and changes nothing', () => {
    const { h, tabs } = browser();
    const before = h.state();
    expect(tabs.open(cloudPage('buckets'), { how: 'window' })).toMatchObject({ status: 'refused', message: expect.stringContaining('desktop app') });
    expect(h.state()).toBe(before);
  });

  it('refuses a mounted view in a new window without changing the source history or selection', () => {
    const { h, tabs } = browser();
    const source = h.state();
    expect(tabs.open({ route: sidebarView }, { how: 'window' })).toMatchObject({ status: 'refused', reason: 'unavailable' });
    expect(h.state()).toBe(source);
  });

  it('is not a success for the connection action that asked for it, and is one in a native window', async () => {
    const entry = { id: 'cloud', phase: 'ready', contribution: { home: 'instances', pages: {} } } as unknown as PluginEntry;
    const connections = { connect: async () => ({ status: 'connected' }) } as unknown as ConnectionsStore;
    const plugins = { getSnapshot: () => [entry], subscribe: () => () => undefined };

    const { tabs } = browser();
    const refused = await createConnectionActions({ tabs, plugins, connections }).go('cloud', 'east', { how: 'window', source: 'sidebar' });
    expect(refused.ok).toBe(false);

    const native = world();
    await expect(createConnectionActions({ tabs: native.tabs, plugins, connections }).go('cloud', 'east', { how: 'window', source: 'sidebar' })).resolves.toEqual({ ok: true });
    expect(native.service.open).toHaveBeenCalledTimes(1);
  });
});

describe('a window whose last tab leaves (S30)', () => {
  it.each([
    ['closed', (h: Harness) => h.store.close(h.current())],
    ['moved out', (h: Harness, tabs: TabsStore) => tabs.detach(h.current())],
  ])('closes itself when it is not the main window, once its last tab is %s', async (_how, leave) => {
    const { h, service, tabs } = world('window-2');
    leave(h, tabs);
    await settled();
    expect(service.close).toHaveBeenCalledExactlyOnceWith('window-2');
  });

  it('stays open while another tab is left, and in the main window, which has an empty state of its own (A17)', async () => {
    const second = world('window-2');
    second.h.openAll(['instances']);
    second.h.store.close(second.h.current());
    await settled();
    expect(second.service.close).not.toHaveBeenCalled();

    const main = world('main');
    main.h.store.close(main.h.current());
    await settled();
    expect(main.service.close).not.toHaveBeenCalled();
  });

  it('stays open while a panel session is starting or running, so its terminal is not stranded, and closes when none is', async () => {
    const panel = createPanelStore();
    panel.openSession({ tool: 'terminal', plugin: 'host', title: 'zsh', state: 'running' });
    const { h, service } = world('window-2', panel);
    h.store.close(h.current());
    await settled();
    expect(service.close).not.toHaveBeenCalled();

    const ended = createPanelStore();
    ended.openSession({ tool: 'terminal', plugin: 'host', title: 'zsh', state: 'ended' });
    const other = world('window-2', ended);
    other.h.store.close(other.h.current());
    await settled();
    expect(other.service.close).toHaveBeenCalledExactlyOnceWith('window-2');
  });

  it('stays open when a tab arrives before the window knows its name: the last tab is checked again just before the window closes', async () => {
    const { h, service } = world('window-2');
    await settled();
    h.store.close(h.current());
    h.openAll(['instances']);
    await settled();
    expect(service.close).not.toHaveBeenCalled();
  });

  it('stays open when a session starts before the window knows its name: the sessions are read again just before the window closes', async () => {
    const name = Promise.withResolvers<string>();
    const panel = createPanelStore();
    const { h, service } = world('window-2', panel, undefined, undefined, undefined, async () => name.promise);
    h.store.close(h.current());
    panel.openSession({ tool: 'terminal', plugin: 'host', title: 'zsh', state: 'running' });
    name.resolve('window-2');
    await settled();
    expect(service.close).not.toHaveBeenCalled();
  });

  it('asks the service for its name again after it failed once: a rejection is not kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const name = vi.fn<WindowService['name']>().mockRejectedValueOnce(new Error('not yet')).mockResolvedValue('window-2');
    const { h, service } = world('window-2', undefined, undefined, undefined, undefined, name);
    await settled();
    h.store.close(h.current());
    await settled();
    expect(service.close).toHaveBeenCalledExactlyOnceWith('window-2');
  });
});

const windowNames = (tabs: TabsStore) => tabs.windows?.others().map((other) => [other.name, other.label]);

describe('the other windows', () => {
  const three: Listed = [{ name: 'main', kind: 'workspace' }, { name: 'settings', kind: 'settings' }, { name: 'window-2', kind: 'workspace' }, { name: 'window-3', kind: 'workspace' }];

  it('are the other workspace windows, named by their order of creation, and follow the service as windows come and go', async () => {
    const { events, tabs } = world('window-2', createPanelStore(), bus(), three);
    await settled();
    expect(windowNames(tabs)).toEqual([['main', 'Window 1'], ['window-3', 'Window 3']]);

    void events.emit('windows/changed', { windows: [{ name: 'main', kind: 'workspace' }, { name: 'window-2', kind: 'workspace' }] });
    await settled();
    expect(windowNames(tabs)).toEqual([['main', 'Window 1']]);

    void events.emit('windows/changed', { windows: [{ name: 'window-2', kind: 'workspace' }] });
    await settled();
    expect(windowNames(tabs)).toEqual([]);
  });
});

describe('moving a tab to a new window', () => {
  const moving = () => {
    const w = world();
    const id = w.h.open(cloudPage('buckets'), { how: 'new' });
    w.h.store.navigate(id, cloudPage('volumes'));
    w.h.store.pin(id);
    return { ...w, id };
  };

  it('opens a window that starts with that tab, as it is saved, and takes it out of this strip only once the window exists, without a place under Recently closed', async () => {
    const { h, id, service, tabs } = moving();
    const closed = h.state().closed;
    let exists: () => void = () => undefined;
    service.open.mockReturnValue(new Promise((resolve) => {
      exists = () => {
        resolve('window-2');
      };
    }));

    expect(tabs.windows?.moveToNew(id)).toEqual({ status: 'done' });
    await settled();

    const started = sessionOf(service.open.mock.calls[0]?.[0]).tabs.tabs[0];
    expect(started).toMatchObject({ id, pinned: true, route: { contribution: 'volumes' }, history: { entries: expect.arrayContaining([expect.anything(), expect.anything()]) as unknown[] } });
    expect(h.ids()).toContain(id);

    exists();
    await settled();
    expect(h.ids()).not.toContain(id);
    expect(h.state().closed).toBe(closed);
    expect(checkInvariants(h.state())).toEqual([]);
  });

  it.each([
    ['navigated', (h: Harness, id: string) => h.store.navigate(id, cloudPage('snapshots'))],
    ['became unsaved', (h: Harness, id: string) => h.store.setUnsaved(id, true)],
  ])('keeps the tab, and warns, when it %s while the window was opening: what is there is not what was sent', async (_how, change) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, id, service, tabs } = moving();
    const exists = Promise.withResolvers<string>();
    service.open.mockReturnValue(exists.promise);

    tabs.windows?.moveToNew(id);
    await settled();
    change(h, id);
    exists.resolve('window-2');
    await settled();

    expect(h.ids()).toContain(id);
    expect(warn).toHaveBeenCalled();
  });

  it('asks first when the tab has unsaved changes, and opens nothing', () => {
    const { h, id, service, tabs } = moving();
    h.store.setUnsaved(id, true);

    expect(tabs.windows?.moveToNew(id)).toEqual({ status: 'confirm', action: 'close', tabs: [id] });
    expect(service.open).not.toHaveBeenCalled();
    expect(tabs.windows?.moveToNew(id, { confirmed: true })).toEqual({ status: 'done' });
    expect(service.open).toHaveBeenCalledTimes(1);
  });
});

describe('moving a tab to another window', () => {
  const two = () => {
    const events = bus();
    const listed: Listed = [{ name: 'main', kind: 'workspace' }, { name: 'window-2', kind: 'workspace' }];
    const here = world('main', createPanelStore(), events, listed);
    const there = world('window-2', createPanelStore(), events, listed);
    const id = here.h.open(cloudPage('buckets'), { how: 'new' });
    here.h.store.navigate(id, cloudPage('volumes'));
    here.h.store.pin(id);
    return { here, there, id, events };
  };

  it('delivers the tab to that window, which shows it with its id, route, history and pin, and then takes it out of this one and focuses the other', async () => {
    const { here, there, id } = two();
    const saved = here.h.store.serialise().tabs.find((tab) => tab.id === id);
    const closed = here.h.state().closed;

    expect(here.tabs.windows?.moveTo('window-2', id)).toEqual({ status: 'done' });
    await settled();

    expect(there.h.store.serialise().tabs.find((tab) => tab.id === id)).toEqual(saved);
    expect(there.h.active()).toBe(id);
    expect(here.h.ids()).not.toContain(id);
    expect(here.h.state().closed).toBe(closed);
    expect(here.service.focus).toHaveBeenCalledExactlyOnceWith('window-2');
    expect(checkInvariants(there.h.state())).toEqual([]);
    expect(checkInvariants(here.h.state())).toEqual([]);
  });

  it('transfers mounted history without a face, session origin, or page state, and preserves traversal in the receiver', async () => {
    const { here, there, id } = two();
    here.tabs.navigate(id, { route: sidebarView });
    here.tabs.setPageState(id, { privateDraft: 'in this window only' });
    const saved = here.tabs.serialise().tabs.find((tab) => tab.id === id);
    expect(saved).not.toHaveProperty('face');
    expect(saved).not.toHaveProperty('key');
    here.tabs.windows?.moveTo('window-2', id);
    await settled();
    expect(here.h.ids()).not.toContain(id);
    expect(there.h.state().tabs[id]).toMatchObject({ location: { route: sidebarView }, face: { title: 'View unavailable' }, pageState: null, history: saved?.history });
    expect(there.tabs.back(id)).toMatchObject({ status: 'done' });
    expect(there.h.state().tabs[id]?.location.route).toMatchObject({ contribution: 'volumes' });
    there.tabs.forward(id);
    expect(there.h.state().tabs[id]?.location.route).toEqual(sidebarView);
  });

  it('leaves this window once the other has the tab, though focusing the other fails: that is only a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, there, id } = two();
    here.service.focus.mockRejectedValue(new Error('no focus'));

    here.tabs.windows?.moveTo('window-2', id);
    await settled();

    expect(there.h.ids()).toContain(id);
    expect(here.h.ids()).not.toContain(id);
    expect(warn).toHaveBeenCalled();
  });

  it('changes nothing in a window the delivery is not addressed to, and the sender keeps its tab', async () => {
    vi.useFakeTimers();
    const { here, there, id, events } = two();
    const bystander = world('window-3', createPanelStore(), events);
    const before = bystander.h.state();

    here.tabs.windows?.moveTo('window-2', id);
    await vi.advanceTimersByTimeAsync(0);

    expect(there.h.ids()).toContain(id);
    expect(bystander.h.state()).toBe(before);
    expect(events.emit.mock.calls.filter(([event]) => event === 'windows/tab/delivered')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('keeps the tab when no window answers within 2000 ms', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, id } = two();

    here.tabs.windows?.moveTo('window-9', id);
    await vi.advanceTimersByTimeAsync(1999);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(warn).toHaveBeenCalled();
    expect(here.h.ids()).toContain(id);
    expect(here.service.focus).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each([
    ['the window refuses it', (there: TabsStore) => vi.spyOn(there, 'adopt').mockReturnValue({ status: 'refused', reason: 'invalid', message: 'no' })],
    ['the event cannot be sent', (_there: TabsStore, emit: Mock<WindowService['emit']>) => emit.mockRejectedValue(new Error('no bus'))],
  ])('keeps the tab when %s', async (_why, fail) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, there, id } = two();
    fail(there.h.store, here.service.emit);

    here.tabs.windows?.moveTo('window-2', id);
    await settled();

    expect(here.h.ids()).toContain(id);
    expect(here.service.focus).not.toHaveBeenCalled();
  });
});

describe('a tab released outside the strip, over no window (S58)', () => {
  const at = { x: 640, y: 320 };
  /** A window with a second tab, that tab being the one released. */
  const crowded = (name: string) => {
    const w = world(name);
    return { ...w, id: w.h.open(cloudPage('buckets'), { how: 'new' }) };
  };

  /** The pointer takes the tab out of the strip and releases it at `at`: the way out the strip is given by the windows. */
  const release = (tabs: TabsStore, id: string) => {
    const way = tabs.windows?.dragOut(id);
    way?.move(at.x, at.y);
    way?.drop(at.x, at.y);
  };

  it('opens a window under the point of the release, anchored in this window, that starts with the tab as it is saved, and takes the tab out of this strip once that window exists', async () => {
    const { h, id, service, tabs } = crowded('window-2');
    const exists = Promise.withResolvers<string>();
    service.open.mockReturnValue(exists.promise);

    release(tabs, id);
    await settled();

    expect(service.open).toHaveBeenCalledTimes(1);
    expect(sessionOf(service.open.mock.calls[0]?.[0]).tabs.tabs[0]).toMatchObject({ id, route: { contribution: 'buckets' } });
    expect(service.open.mock.calls[0]?.[1]).toEqual({ window: 'window-2', ...at });
    expect(h.ids()).toContain(id);

    exists.resolve('window-3');
    await settled();
    expect(h.ids()).not.toContain(id);
    expect(service.place).not.toHaveBeenCalled();
    expect(service.close).not.toHaveBeenCalled();
  });

  it('moves the window under the pointer instead for the only tab of a window other than the main one: nothing opens, and the tab and the window stay', async () => {
    const { h, service, tabs } = world('window-2');
    const only = h.current();

    release(tabs, only);
    await settled();

    expect(service.place.mock.calls).toEqual([['window-2', at.x, at.y]]);
    expect(service.open).not.toHaveBeenCalled();
    expect(h.ids()).toEqual([only]);
    expect(service.close).not.toHaveBeenCalled();
  });

  it('opens a window for the only tab of the main window, which is left with none (A17)', async () => {
    const { h, service, tabs } = world('main');

    release(tabs, h.current());
    await settled();

    expect(service.open).toHaveBeenCalledTimes(1);
    expect(service.place).not.toHaveBeenCalled();
    expect(h.ids()).toEqual([]);
  });
});

describe('a tab dragged out of the strip over another window (the service\'s drag session)', () => {
  /** Three windows that share the service: the tab is in `here`, the pointer is over `there`, whose strip is the receiver, which says the tab goes first; `start` is the pointer taking the tab out of its strip, and `dragAndDrop` takes it out and releases it over `there`. */
  const crossing = () => {
    const events = bus();
    const drag = coordinator(events);
    const listed: Listed = [{ name: 'main', kind: 'workspace' }, { name: 'window-2', kind: 'workspace' }, { name: 'window-3', kind: 'workspace' }];
    const here = world('main', createPanelStore(), events, listed, drag);
    const there = world('window-2', createPanelStore(), events, listed, drag);
    const strip = vi.fn<TabReceiver>(() => ({ to: 0, pinned: undefined }));
    there.tabs.windows?.receive(strip);
    const id = here.h.open(cloudPage('buckets'), { how: 'new' });
    drag.pointer.over = 'window-2';
    const start = () => here.tabs.windows?.dragOut(id);
    const dragAndDrop = async () => {
      const way = start();
      way?.move(500, 20);
      way?.drop(500, 20);
      await settled();
    };

    return { here, there, drag, strip, id, events, listed, start, dragAndDrop };
  };

  it('is taken by the window it is dropped on, which shows it where it was dropped with its id, route, history and pin, and then it leaves this window, which focuses the other', async () => {
    const { here, there, drag, strip, id, start } = crossing();
    const saved = here.h.store.serialise().tabs.find((tab) => tab.id === id);
    const closed = here.h.state().closed;
    const way = start();

    way?.move(500, 20);
    await settled();
    expect(strip).toHaveBeenLastCalledWith({ x: 500, y: 20 });
    expect(there.h.ids()).toEqual(['t1']);

    way?.drop(510, 22);
    await settled();

    expect(strip).toHaveBeenCalledWith({ x: 510, y: 22 });
    expect(there.h.ids()).toEqual([id, 't1']);
    expect(there.h.store.serialise().tabs.find((tab) => tab.id === id)).toEqual(saved);
    expect(there.h.active()).toBe(id);
    expect(here.h.ids()).not.toContain(id);
    expect(here.h.state().closed).toBe(closed);
    expect(here.service.focus).toHaveBeenCalledExactlyOnceWith('window-2');
    expect(drag.respondDrop).toHaveBeenCalledExactlyOnceWith(expect.any(String), true, id);
    expect(strip).toHaveBeenLastCalledWith(undefined);
    expect(drag.log).toEqual(['begin', 'move', 'end']);
    expect(here.service.open).not.toHaveBeenCalled();
    expect(checkInvariants(there.h.state())).toEqual([]);
    expect(checkInvariants(here.h.state())).toEqual([]);
  });

  it('puts the tab on the side of the pinned tabs the strip says it was dropped on: a pinned tab dropped after them is not pinned', async () => {
    const { here, there, strip, id, dragAndDrop } = crossing();
    here.h.store.pin(id);
    strip.mockReturnValue({ to: 1, pinned: false });
    await dragAndDrop();

    expect(there.h.ids()).toEqual(['t1', id]);
    expect(there.h.state().tabs[id]?.flags.pinned).toBe(false);
  });

  it.each([
    ['the strip says the point is not over it', (strip: Mock<TabReceiver>) => strip.mockReturnValue(undefined)],
    ['the window cannot take the tab', (_strip: Mock<TabReceiver>, store: TabsStore) => vi.spyOn(store, 'adopt').mockReturnValue({ status: 'refused', reason: 'invalid', message: 'no' })],
  ])('keeps the tab and opens no window when %s, and the marker is gone', async (_why, refuse) => {
    const { here, there, drag, strip, id, dragAndDrop } = crossing();
    refuse(strip, there.h.store);
    await dragAndDrop();

    expect(here.h.ids()).toContain(id);
    expect(there.h.ids()).toEqual(['t1']);
    expect(drag.respondDrop).toHaveBeenCalledExactlyOnceWith(expect.any(String), false, '');
    expect(here.service.open).not.toHaveBeenCalled();
    expect(here.service.focus).not.toHaveBeenCalled();
    expect(strip).toHaveBeenLastCalledWith(undefined);
  });

  it.each([
    ['opens a window of its own when no window was under the pointer at the drop, though one was a moment before', true, '', 1],
    ['keeps the tab when a window declined it, though no hover of that window reached this one', false, 'window-2', 0],
  ] as const)('takes the answer to the drop and not the events before it: it %s', async (_what, moved, targetWindow, opened) => {
    const { here, drag, id, start } = crossing();
    drag.endDrag.mockResolvedValue({ accepted: false, targetWindow });
    const way = start();
    if (moved) {
      way?.move(500, 20);
      await settled();
    }

    way?.drop(500, 20);
    await settled();

    expect(here.service.open).toHaveBeenCalledTimes(opened);
    expect(here.h.ids().includes(id)).toBe(opened === 0);
  });

  it('keeps the tab when the service cannot end the drag', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, drag, id, dragAndDrop } = crossing();
    drag.endDrag.mockRejectedValue(new Error('no service'));
    await dragAndDrop();

    expect(here.h.ids()).toContain(id);
    expect(here.service.open).not.toHaveBeenCalled();
  });

  it('cancels the session when the drag is cancelled, after what was asked before it, and the other window has no marker left', async () => {
    const { here, drag, strip, id, start } = crossing();
    const way = start();

    way?.move(500, 20);
    await settled();
    expect(strip).toHaveBeenLastCalledWith({ x: 500, y: 20 });
    way?.cancel();
    await settled();

    expect(drag.log).toEqual(['begin', 'move', 'cancel']);
    expect(strip).toHaveBeenLastCalledWith(undefined);
    expect(here.h.ids()).toContain(id);
    expect(here.service.open).not.toHaveBeenCalled();
    expect(drag.endDrag).not.toHaveBeenCalled();
  });

  it('drops nothing for a tab with unsaved changes, and the other window is asked nothing: the session is cancelled', async () => {
    const { here, there, drag, id, dragAndDrop } = crossing();
    here.h.store.setUnsaved(id, true);
    await dragAndDrop();

    expect(drag.log).toEqual(['begin', 'move', 'cancel']);
    expect(here.h.ids()).toContain(id);
    expect(there.h.ids()).toEqual(['t1']);
  });

  it('sends one move at a time, and a newer point replaces the one that waits: 1000 moves while one is in flight make at most two calls, and begin and drop reach the service in order (HSH-27)', async () => {
    const { drag, start } = crossing();
    const inFlight = Promise.withResolvers<undefined>();
    drag.moveDrag.mockImplementationOnce(async () => {
      drag.log.push('move');
      await inFlight.promise;
    });
    const way = start();

    way?.move(0, 20);
    await settled();
    expect(drag.moveDrag).toHaveBeenCalledTimes(1);
    for (let x = 1; x <= 1000; x += 1) {
      way?.move(x, 20);
    }

    await settled();
    expect(drag.moveDrag).toHaveBeenCalledTimes(1);
    inFlight.resolve(undefined);
    await settled();
    expect(drag.moveDrag.mock.calls.map(([, x]) => x)).toEqual([0, 1000]);

    way?.drop(1000, 20);
    await settled();
    expect(drag.log).toEqual(['begin', 'move', 'move', 'end']);
  });

  it('changes nothing in a window the events are not addressed to, and asks the service nothing there (HSH-32)', async () => {
    const { events, listed, drag, strip, id, dragAndDrop } = crossing();
    const bystander = world('window-3', createPanelStore(), events, listed, drag);
    const watching = vi.fn<TabReceiver>();
    bystander.tabs.windows?.receive(watching);
    const before = bystander.h.state();
    await dragAndDrop();

    expect(strip).toHaveBeenCalledWith({ x: 500, y: 20 });
    expect(watching.mock.calls.every(([at]) => at === undefined)).toBe(true);
    expect(bystander.h.state()).toBe(before);
    expect(drag.respondDrop).toHaveBeenCalledTimes(1);
    expect(bystander.h.ids()).not.toContain(id);
  });
});

describe('the window\'s viewport, by which the service places a window and finds the one under a drag', () => {
  it('is told when the window starts, and again only when its size changes', async () => {
    const { service } = world('window-2');
    await settled();
    expect(service.viewport.mock.calls).toEqual([['window-2', window.innerWidth, window.innerHeight]]);

    window.dispatchEvent(new Event('resize'));
    await settled();
    expect(service.viewport).toHaveBeenCalledTimes(1);

    vi.stubGlobal('innerWidth', 800);
    window.dispatchEvent(new Event('resize'));
    await settled();
    expect(service.viewport.mock.calls).toEqual([['window-2', 1024, 768], ['window-2', 800, 768]]);
  });

  it('is told again when a drag begins, whatever the size: every window reports then, so the service can find the window under the pointer', async () => {
    const { h, service, tabs } = world('window-2');
    await settled();
    expect(service.viewport).toHaveBeenCalledTimes(1);

    tabs.windows?.dragOut(h.current());
    await settled();

    expect(service.viewport).toHaveBeenCalledTimes(2);
  });
});
