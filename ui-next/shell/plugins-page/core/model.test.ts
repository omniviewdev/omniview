import { describe, expect, it, vi } from 'vitest';
import { unloadedFailure } from '../../../plugins/loader/failure';
import type { PluginEntry } from '../../../plugins/host/pluginStore';
import { createPluginsModel } from './model';
import { acme } from '../../../plugins/testing';
import { fakeEntries, harness, inventoryEntry, settle } from './testing';
import type { InventoryEntry } from './types';

// The page's model: what the host's inventory, the window's plugin store and the host's events say of the installed plugins, as one list of rows. Nothing here runs a plugin or a host: the inventory is a function the test
// answers, the plugin store a table the test sets, the events a table of handlers the test calls (`testing.ts`).

const gone = (id: string, cause: 'crashed' | 'reloaded' | 'failed' | 'timeout'): PluginEntry => ({ id, name: id, phase: 'failed', failure: unloadedFailure(cause) });
const four = [inventoryEntry('delta'), inventoryEntry('alpha'), inventoryEntry('gamma'), inventoryEntry('beta')];

describe('opening', () => {
  it('says it is loading until the host has listed the plugins', () => {
    const { deps } = harness(four);
    const model = createPluginsModel(deps);

    expect(model.getSnapshot()).toMatchObject({ status: 'loading', ids: [], selected: null });
  });

  it('lists the plugins by name when the host answers, and shows the first one', async () => {
    const { deps } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    expect(model.getSnapshot()).toMatchObject({ status: 'ready', ids: ['alpha', 'beta', 'delta', 'gamma'], selected: 'alpha' });
    expect(model.row('delta')?.plugin.name).toBe('Delta');
  });

  it('is ready from the first look when it was given the list the window already has, and still asks the host', async () => {
    const { deps, read } = harness(four, { seed: () => four.slice(0, 2) });
    const model = createPluginsModel(deps);

    expect(model.getSnapshot()).toMatchObject({ status: 'ready', ids: ['alpha', 'delta'] });

    model.refresh();
    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(model.getSnapshot().ids).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('says it could not list the plugins when the host does not answer and there is nothing to show, and lists them when asked again', async () => {
    const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, read } = harness(four);
    read.mockRejectedValueOnce(new Error('the host is not there'));
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    expect(model.getSnapshot().status).toBe('failed');

    model.refresh();
    await settle();

    expect(model.getSnapshot()).toMatchObject({ status: 'ready', ids: ['alpha', 'beta', 'delta', 'gamma'] });
    expect(report).toHaveBeenCalledExactlyOnceWith('[plugins] the list of installed plugins could not be read', expect.any(Error));
    report.mockRestore();
  });

  it('keeps the list it has when a later read fails: the plugins are still there', async () => {
    const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, read } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();
    read.mockRejectedValueOnce(new Error('the host is not there'));
    model.refresh();
    await settle();

    expect(model.getSnapshot()).toMatchObject({ status: 'ready', ids: ['alpha', 'beta', 'delta', 'gamma'] });
    expect(report).toHaveBeenCalledExactlyOnceWith('[plugins] the list of installed plugins could not be read', expect.any(Error));
    report.mockRestore();
  });

  it('asks the host once at a time: a request that comes while one is out is answered by one more read, not many', async () => {
    const { deps, read } = harness(four);
    let release: () => void = () => undefined;
    read.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = () => {
            resolve(four);
          };
        }),
    );
    const model = createPluginsModel(deps);
    model.refresh();
    model.refresh();
    model.refresh();

    expect(read).toHaveBeenCalledOnce();

    release();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('what the page keeps of the plugin the person was reading', () => {
  it('shows the plugin the page kept, when it is still listed', async () => {
    const { deps } = harness(four, { memory: { read: () => ({ selected: 'gamma', other: 1 }), write: vi.fn() } });
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    expect(model.getSnapshot().selected).toBe('gamma');
  });

  it('shows the first plugin when the one it kept is gone', async () => {
    const { deps } = harness(four, { memory: { read: () => ({ selected: 'removed' }), write: vi.fn() } });
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    expect(model.getSnapshot().selected).toBe('alpha');
  });

  it('writes the choice the person makes, keeping the other members the host holds, and nothing when the choice does not change', async () => {
    const write = vi.fn();
    const { deps } = harness(four, { memory: { read: () => ({ scroll: { top: 40, left: 0 } }), write } });
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    model.select('delta');
    model.select('delta');

    expect(model.getSnapshot().selected).toBe('delta');
    expect(write).toHaveBeenCalledExactlyOnceWith({ scroll: { top: 40, left: 0 }, selected: 'delta' });
  });

  it('refuses to select a plugin that is not listed', async () => {
    const { deps } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    model.select('nobody');

    expect(model.getSnapshot().selected).toBe('alpha');
  });
});

describe('a row is one object until what it says changes', () => {
  it('does not change a row, nor tell anyone, when the host answers what it answered', async () => {
    const { deps } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();
    const before = new Map(model.getSnapshot().ids.map((id) => [id, model.row(id)]));
    const snapshot = model.getSnapshot();
    const onList = vi.fn();
    const onRow = vi.fn();
    model.subscribe(onList);
    model.subscribeRow('beta', onRow);

    model.refresh();
    await settle();

    expect(onList).not.toHaveBeenCalled();
    expect(onRow).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toBe(snapshot);
    for (const [id, row] of before) {
      expect(model.row(id)).toBe(row);
    }
  });

  it('changes only the row of the plugin whose phase changed, and tells only that row', async () => {
    const { deps, list } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();
    const alpha = model.row('alpha');
    const beta = model.row('beta');
    const snapshot = model.getSnapshot();
    const onList = vi.fn();
    const onAlpha = vi.fn();
    const onBeta = vi.fn();
    model.subscribe(onList);
    model.subscribeRow('alpha', onAlpha);
    model.subscribeRow('beta', onBeta);

    list.current = four.map((entry) => (entry.id === 'beta' ? { ...entry, phase: 'Degraded' } : entry));
    model.refresh();
    await settle();

    expect(model.row('alpha')).toBe(alpha);
    expect(model.row('beta')).not.toBe(beta);
    expect(model.row('beta')?.state.kind).toBe('degraded');
    expect(onAlpha).not.toHaveBeenCalled();
    expect(onBeta).toHaveBeenCalledOnce();
    expect(onList).not.toHaveBeenCalled();
    expect(model.getSnapshot()).toBe(snapshot);
  });

  it('changes the list when a plugin comes or goes, and keeps the rows of the others', async () => {
    const { deps, list } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();
    const alpha = model.row('alpha');
    const onList = vi.fn();
    model.subscribe(onList);

    list.current = [...four, inventoryEntry('aardvark')];
    model.refresh();
    await settle();

    expect(model.getSnapshot().ids).toEqual(['aardvark', 'alpha', 'beta', 'delta', 'gamma']);
    expect(onList).toHaveBeenCalledOnce();
    expect(model.row('alpha')).toBe(alpha);
  });

  it('has no row for a plugin that is not listed', async () => {
    const { deps } = harness(four);
    const model = createPluginsModel(deps);
    model.refresh();
    await settle();

    expect(model.row('nobody')).toBeUndefined();
  });
});

describe('what the host says while the page is open', () => {
  const open = async (plugins = four) => {
    const set = harness(plugins);
    const model = createPluginsModel(set.deps);
    const detach = model.attach();
    await settle();
    set.read.mockClear();
    return { ...set, model, detach };
  };

  it('is the two events about one plugin and the five that change the list, and no others', async () => {
    const { events, detach } = await open();

    expect(events.names()).toEqual(['plugin/enablement_changed', 'plugin/init_complete', 'plugin/install_finished', 'plugin/inventory_changed', 'plugin/state_change', 'plugin/unloaded', 'plugin/update_complete']);

    detach();
  });

  it('shows the phase a plugin entered at once, from the event, and changes that row and no other', async () => {
    const { model, events, read } = await open();
    const alpha = model.row('alpha');
    const onList = vi.fn();
    const onBeta = vi.fn();
    const onAlpha = vi.fn();
    model.subscribe(onList);
    model.subscribeRow('beta', onBeta);
    model.subscribeRow('alpha', onAlpha);

    events.emit('plugin/state_change', { pluginID: 'beta', from: 'Running', to: 'Stopping', reason: 'a reason of the plugin\'s own' });

    expect(model.row('beta')?.state).toMatchObject({ kind: 'stopping', word: 'Stopping' });
    expect(model.row('alpha')).toBe(alpha);
    expect(onBeta).toHaveBeenCalledOnce();
    expect(onAlpha).not.toHaveBeenCalled();
    expect(onList).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('asks the host again when it hears of a plugin it does not list: it may be new', async () => {
    const { model, events, read, list } = await open();
    list.current = [...four, inventoryEntry('epsilon')];

    events.emit('plugin/state_change', { pluginID: 'epsilon', from: 'Starting', to: 'Running' });
    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(model.getSnapshot().ids).toContain('epsilon');
  });

  it.each(['plugin/inventory_changed', 'plugin/install_finished', 'plugin/update_complete', 'plugin/init_complete'])('asks the host again after %s', async (name) => {
    const { events, read } = await open();

    events.emit(name, undefined);
    await settle();

    expect(read).toHaveBeenCalledOnce();
  });

  it('shows a plugin the person turned off as disabled at once, and asks the host again', async () => {
    const { model, events, read, list } = await open();
    list.current = four.map((entry) => (entry.id === 'gamma' ? { ...entry, enabled: false, phase: 'Installed' } : entry));

    events.emit('plugin/enablement_changed', { pluginID: 'gamma', enabled: false });

    expect(model.row('gamma')?.state).toMatchObject({ kind: 'disabled', word: 'Disabled' });

    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(model.row('gamma')?.state.kind).toBe('disabled');
  });

  it('shows a plugin turned on as no longer disabled', async () => {
    const { model, events, list } = await open([...four.slice(0, 3), inventoryEntry('beta', { enabled: false, phase: 'Installed' })]);
    list.current = [...four.slice(0, 3), inventoryEntry('beta', { enabled: true, phase: 'Installed' })];

    events.emit('plugin/enablement_changed', { pluginID: 'beta', enabled: true });
    await settle();

    expect(model.row('beta')?.state).toMatchObject({ kind: 'stopped', word: 'Stopped' });
  });

  it('takes a plugin off the list the moment the host says it was uninstalled, and moves the selection to its neighbour', async () => {
    const { model, events } = await open();
    model.select('beta');
    const alpha = model.row('alpha');
    const onList = vi.fn();
    model.subscribe(onList);

    events.emit('plugin/unloaded', { pluginID: 'beta', cause: 'uninstalled' });

    expect(model.getSnapshot().ids).toEqual(['alpha', 'delta', 'gamma']);
    expect(model.getSnapshot().selected).toBe('delta');
    expect(model.row('beta')).toBeUndefined();
    expect(model.row('alpha')).toBe(alpha);
    expect(onList).toHaveBeenCalledOnce();
  });

  it('keeps it off the list when a read that was already out says it is still there, and lists it again when a read that began after says so', async () => {
    const { model, events, read, list } = await open();
    let release: (entries: readonly InventoryEntry[]) => void = () => undefined;
    read.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    model.refresh();
    events.emit('plugin/unloaded', { pluginID: 'beta', cause: 'uninstalled' });
    release(four);
    await settle();

    expect(model.getSnapshot().ids).not.toContain('beta');

    // The uninstall was rolled back: a read that began after the event lists the plugin again, and that is the truth.
    list.current = four;
    model.refresh();
    await settle();

    expect(model.getSnapshot().ids).toContain('beta');
  });

  it('says what the event said, not what a read that began before it says', async () => {
    const { model, events, read } = await open();
    let release: (entries: readonly InventoryEntry[]) => void = () => undefined;
    read.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    model.refresh();
    events.emit('plugin/state_change', { pluginID: 'alpha', from: 'Running', to: 'Degraded' });
    release(four);
    await settle();

    expect(model.row('alpha')?.state.kind).toBe('degraded');
  });

  it('says what a read that began after the event says: it is newer than the event', async () => {
    const { model, events, read, list } = await open();
    events.emit('plugin/state_change', { pluginID: 'alpha', from: 'Running', to: 'Degraded' });
    list.current = four;
    read.mockClear();

    model.refresh();
    await settle();

    expect(model.row('alpha')?.state.kind).toBe('running');
  });

  it('asks the host again after an enablement it cannot read, and changes nothing else', async () => {
    const { model, events, read } = await open();
    const snapshot = model.getSnapshot();

    events.emit('plugin/enablement_changed', undefined);
    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(model.getSnapshot()).toBe(snapshot);
  });

  it('ignores what is not an event of the host: a payload with no plugin, a phase it does not have, a cause it does not know', async () => {
    const { model, events, read } = await open();
    const snapshot = model.getSnapshot();

    events.emit('plugin/state_change', { to: 'Running' });
    events.emit('plugin/state_change', { pluginID: 'alpha', to: 'Levitating' });
    events.emit('plugin/unloaded', { pluginID: 'alpha', cause: 'exploded' });
    await settle();

    expect(model.getSnapshot()).toBe(snapshot);
    expect(model.row('alpha')?.state.kind).toBe('running');
    expect(read).not.toHaveBeenCalled();
  });

  it('never holds a handler after it is detached, however often the page was shown and hidden', async () => {
    const { model, events, detach } = await open();
    detach();

    expect(events.held()).toBe(0);

    for (let round = 0; round < 20; round += 1) {
      model.attach()();
    }

    expect(events.held()).toBe(0);
  });

  it('asks the host again when it is shown again: it heard nothing while it was hidden', async () => {
    const { model, read, detach } = await open();
    detach();

    model.attach();
    await settle();

    expect(read).toHaveBeenCalledOnce();
  });
});

describe('what the window says of a plugin\'s interface is what the page says', () => {
  it('shows the rail\'s word for a plugin that stopped, in that row only', async () => {
    const { deps, entries } = harness(four);
    const model = createPluginsModel(deps);
    const detach = model.attach();
    await settle();
    const alpha = model.row('alpha');
    const onBeta = vi.fn();
    model.subscribeRow('beta', onBeta);

    entries.set([gone('beta', 'crashed')]);

    expect(model.row('beta')?.state).toMatchObject({ kind: 'failed', word: 'Stopped', cause: 'crashed', faulted: true });
    expect(model.row('alpha')).toBe(alpha);
    expect(onBeta).toHaveBeenCalledOnce();

    entries.set([]);

    expect(model.row('beta')?.state.kind).toBe('running');
    detach();
  });

  it('keeps a plugin on the list while the host reloads it: the host lists none for the whole reload, and the window still holds it', async () => {
    const { deps, entries, list } = harness(four);
    const model = createPluginsModel(deps);
    const detach = model.attach();
    await settle();

    // The record of a plugin that is being reloaded is gone from the host's list until the load ends.
    list.current = four.filter((entry) => entry.id !== 'gamma');
    entries.set([gone('gamma', 'reloaded')]);
    model.refresh();
    await settle();

    expect(model.getSnapshot().ids).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(model.row('gamma')?.plugin.name).toBe('Gamma');
    expect(model.row('gamma')?.state).toMatchObject({ kind: 'starting', word: 'Starting again', busy: true });

    // The reload ended and the plugin runs again: the host lists it.
    list.current = four;
    entries.set([]);
    model.refresh();
    await settle();

    expect(model.row('gamma')?.state.kind).toBe('running');
    detach();
  });

  it('shows a plugin the window holds and the host does not list yet, by the name the window knows', async () => {
    const { deps, entries } = harness([inventoryEntry('alpha')]);
    const model = createPluginsModel(deps);
    model.attach();
    await settle();

    entries.set([{ id: 'newcomer', name: 'Newcomer', phase: 'failed', failure: unloadedFailure('reloaded') }]);

    expect(model.getSnapshot().ids).toEqual(['alpha', 'newcomer']);
    expect(model.row('newcomer')?.plugin).toMatchObject({ id: 'newcomer', name: 'Newcomer', version: '' });
  });

  it('draws a plugin with the rail\'s glyph and colour once its interface has loaded, and with the host\'s own glyph before', async () => {
    const { deps, entries } = harness(four);
    const model = createPluginsModel(deps);
    const detach = model.attach();
    await settle();

    expect(model.row('beta')?.tile).toEqual({ icon: 'package', accent: undefined });

    entries.set([{ id: 'beta', name: 'Beta', phase: 'ready', contribution: acme({ rail: { label: 'Beta', icon: 'server', order: 1 } }) }]);

    expect(model.row('beta')?.tile).toEqual({ icon: 'server', accent: 'blue' });
    detach();
  });

  it('keeps the glyph and the hue a plugin had while its interface loads again: its accent does not change with a reload', async () => {
    const { deps, entries } = harness(four);
    const model = createPluginsModel(deps);
    const detach = model.attach();
    await settle();
    entries.set([{ id: 'beta', name: 'Beta', phase: 'ready', contribution: acme({ rail: { label: 'Beta', icon: 'server', order: 1 } }) }]);

    entries.set([{ id: 'beta', name: 'Beta', phase: 'failed', failure: unloadedFailure('reloaded') }]);

    expect(model.row('beta')?.tile).toEqual({ icon: 'server', accent: 'blue' });
    detach();
  });

  it('listens to the window\'s store only while it is attached', async () => {
    const entries = fakeEntries();
    const { deps } = harness(four, { entries });
    const model = createPluginsModel(deps);

    expect(entries.listeners()).toBe(0);

    const detach = model.attach();

    expect(entries.listeners()).toBe(1);

    detach();

    expect(entries.listeners()).toBe(0);
  });
});
