import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell/core/panel';
import { boot, cloudPage, hostPage } from '../../shell/core/tabs/testing';
import { checkInvariants, type TabsStore } from '../../shell/core/tabs';
import type { PluginEntry } from './pluginStore';
import { createConnectionActions } from './connections/actions';
import type { ConnectionsStore } from './connections/store';
import { withWindows, type WindowService } from './windows';

// A window opening another, over the host's window service (a recording stand-in, so what is under test is what the host asks of it and what the model does with the answer). The second window was not run natively here.

afterEach(() => {
  vi.restoreAllMocks();
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

type Listed = ReadonlyArray<{ readonly name: string; readonly kind: string }>;

function world(name = 'main', panel = createPanelStore(), events = bus(), listed: Listed = [{ name, kind: 'workspace' }]) {
  const h = boot();
  const service = {
    name: vi.fn(async () => name),
    open: vi.fn<WindowService['open']>(async () => 'window-2'),
    close: vi.fn<WindowService['close']>(async () => undefined),
    focus: vi.fn<WindowService['focus']>(async () => undefined),
    list: vi.fn<WindowService['list']>(async () => listed),
    ...events,
  };
  const tabs: TabsStore = withWindows(h.store, panel, service);
  return { h, panel, service, tabs, events };
}

const sessionOf = (text: string | undefined) => JSON.parse(text ?? 'null') as { version: number; tabs: { version: number; active: string; tabs: Array<{ id: string; route: unknown }> } };

// The stand-in service answers at once, so what the host does after an answer has happened within a few microtask turns.
const settled = async () => {
  for (let turn = 0; turn < 30; turn += 1) {
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

  it('moves a singleton that is open: the new window starts with that tab, and once it exists the tab leaves this strip without a place under Recently closed', async () => {
    const { h, service, tabs } = world();
    const settings = h.open(hostPage('settings'), { how: 'new' });
    const closed = h.state().closed;

    tabs.open(hostPage('settings'), { how: 'window' });

    expect(sessionOf(service.open.mock.calls[0]?.[0]).tabs.tabs[0]?.id).toBe(settings);
    expect(h.ids()).toContain(settings);
    await settled();
    expect(h.ids()).not.toContain(settings);
    expect(h.state().closed).toBe(closed);
    expect(checkInvariants(h.state())).toEqual([]);
  });

  it('keeps the tab where it is when the window cannot be opened', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, service, tabs } = world();
    const settings = h.open(hostPage('settings'), { how: 'new' });
    service.open.mockRejectedValue(new Error('no window'));

    tabs.open(hostPage('settings'), { how: 'window' });
    await settled();

    expect(h.ids()).toContain(settings);
    expect(warn).toHaveBeenCalled();
  });

  it('asks first when the singleton has unsaved changes, and opens nothing', () => {
    const { h, service, tabs } = world();
    const settings = h.open(hostPage('settings'), { how: 'new' });
    h.store.setUnsaved(settings, true);

    expect(tabs.open(hostPage('settings'), { how: 'window' })).toEqual({ status: 'confirm', action: 'close', tabs: [settings] });
    expect(service.open).not.toHaveBeenCalled();
  });

  it('leaves every other disposition to the model', () => {
    const { h, service, tabs } = world();
    expect(tabs.open(cloudPage('buckets'), { how: 'new' })).toMatchObject({ status: 'done', change: 'created' });
    expect(h.ids()).toHaveLength(2);
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
  it('closes itself when it is not the main window', async () => {
    const { h, service } = world('window-2');
    h.store.close(h.current());
    await settled();
    expect(service.close).toHaveBeenCalledExactlyOnceWith('window-2');
  });

  it('closes after a tab was moved out as well', async () => {
    const { h, service, tabs } = world('window-2');
    tabs.detach(h.current());
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

  it('are none in a browser tab, which has no window to move to', () => {
    expect(withWindows(boot().store, createPanelStore(), undefined).windows).toBeUndefined();
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

  it('keeps the tab where it is when the window cannot be opened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h, id, service, tabs } = moving();
    service.open.mockRejectedValue(new Error('no window'));

    tabs.windows?.moveToNew(id);
    await settled();

    expect(h.ids()).toContain(id);
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

  it('keeps the tab when the window refuses it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, there, id } = two();
    vi.spyOn(there.h.store, 'adopt').mockReturnValue({ status: 'refused', reason: 'invalid', message: 'no' });

    here.tabs.windows?.moveTo('window-2', id);
    await settled();

    expect(here.h.ids()).toContain(id);
    expect(here.service.focus).not.toHaveBeenCalled();
  });

  it('keeps the tab when the event cannot be sent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { here, id } = two();
    here.service.emit.mockRejectedValue(new Error('no bus'));

    here.tabs.windows?.moveTo('window-2', id);
    await settled();

    expect(here.h.ids()).toContain(id);
  });
});
