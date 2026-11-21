import { describe, expect, it, vi } from 'vitest';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import type { UnloadCause } from '../loader/failure';
import { acme, fakeEvents } from '../testing';
import { listenForLifecycle, readRunning, readUnloaded } from './lifecycle';
import { PluginStore } from './pluginStore';

// What the window does with the two things the host says of a plugin that stops and returns (`backend/pkg/plugin/events.go`): `plugin/unloaded` (the plugin's id and one of four words) and
// `plugin/state_change` (read for the plugin's id and whether it runs again). No runtime, no host: the events are a table of handlers the test calls, as the runtime's are.

const plugins = () => ({ unload: vi.fn<(id: string, cause: UnloadCause) => void>(), revive: vi.fn(async (_id: string) => undefined) });

describe('what the host says of a plugin that stopped', () => {
  it('is read from the two events and no others: the one that says a plugin stopped, and the one that says what phase a plugin is in', () => {
    const events = fakeEvents();

    listenForLifecycle(plugins(), events.source);

    expect(events.names()).toEqual(['plugin/state_change', 'plugin/unloaded']);
  });

  it.each(['crashed', 'reloaded', 'uninstalled', 'disabled'] as const)('unloads the plugin it names, with the cause %s', (cause) => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/unloaded', { pluginID: 'acme', cause });

    expect(target.unload).toHaveBeenCalledExactlyOnceWith('acme', cause);
  });

  it('reads the id and the cause and nothing else: what else a payload carries, text above all, goes no further', () => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'crashed', error: 'panic at /Users/me/.omniview/plugins/acme: token=abc', message: 'anything', timestamp: 1 });

    expect(target.unload).toHaveBeenCalledExactlyOnceWith('acme', 'crashed');
    expect(JSON.stringify(target.unload.mock.calls)).not.toMatch(/Users|token|anything/);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'acme'],
    ['a list', ['acme', 'crashed']],
    ['an empty object', {}],
    ['no id', { cause: 'crashed' }],
    ['an empty id', { pluginID: '', cause: 'crashed' }],
    ['an id that is not text', { pluginID: 3, cause: 'crashed' }],
    ['no cause', { pluginID: 'acme' }],
    ['a cause that is not one of the four', { pluginID: 'acme', cause: 'exploded' }],
    ['a cause with the case of another word', { pluginID: 'acme', cause: 'Crashed' }],
    ['a cause that is not text', { pluginID: 'acme', cause: 1 }],
    ['the zero cause the bindings name', { pluginID: 'acme', cause: '' }],
  ])('ignores a payload that is %s: it names no plugin and no cause', (_name, payload) => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/unloaded', payload);

    expect(target.unload).not.toHaveBeenCalled();
    expect(readUnloaded(payload)).toBeUndefined();
  });
});

describe('what the host says of a plugin that runs', () => {
  it('revives the plugin whose phase became Running', () => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/state_change', { pluginID: 'acme', from: 'Starting', to: 'Running', reason: 'force: plugin loaded successfully', timestamp: '2026-11-20T21:00:00Z' });

    expect(target.revive).toHaveBeenCalledExactlyOnceWith('acme');
  });

  it.each(['Recovering', 'Stopped', 'Stopping', 'Failed', 'Starting', 'Degraded', 'Installed', 'Validating', 'running', ''])('does nothing for a phase that is %s', (to) => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/state_change', { pluginID: 'acme', from: 'Running', to, reason: 'crash detected' });

    expect(target.revive).not.toHaveBeenCalled();
    expect(target.unload).not.toHaveBeenCalled();
  });

  it('never reads the reason of a state change: it is the host\'s own text, and on a failure it holds the error', () => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/state_change', { pluginID: 'acme', from: 'Starting', to: 'Running', reason: 'force: /Users/me/.omniview/plugins/acme/bin/plugin exited: token=abc' });

    expect(JSON.stringify([...target.unload.mock.calls, ...target.revive.mock.calls])).not.toMatch(/Users|token/);
  });

  it.each([
    ['nothing', undefined],
    ['text', 'Running'],
    ['no id', { to: 'Running' }],
    ['an empty id', { pluginID: '', to: 'Running' }],
    ['an id that is not text', { pluginID: 1, to: 'Running' }],
  ])('ignores a state change that is %s', (_name, payload) => {
    const events = fakeEvents();
    const target = plugins();
    listenForLifecycle(target, events.source);

    events.emit('plugin/state_change', payload);

    expect(target.revive).not.toHaveBeenCalled();
    expect(readRunning(payload)).toBeUndefined();
  });
});

describe('listening', () => {
  it('stops when told to: both handlers go, and a listener that stopped hears nothing', () => {
    const events = fakeEvents();
    const target = plugins();
    const stop = listenForLifecycle(target, events.source);
    expect(events.held()).toBe(2);

    stop();
    events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'crashed' });
    events.emit('plugin/state_change', { pluginID: 'acme', to: 'Running' });

    expect(events.held()).toBe(0);
    expect(target.unload).not.toHaveBeenCalled();
    expect(target.revive).not.toHaveBeenCalled();
  });

  it('holds two handlers while it listens however many times it was started and stopped: a window that mounts the host again leaves none behind', () => {
    const events = fakeEvents();
    const target = plugins();

    for (let round = 0; round < 20; round += 1) {
      const stop = listenForLifecycle(target, events.source);
      expect(events.held()).toBe(2);
      stop();
      expect(events.held()).toBe(0);
    }
  });
});

describe('with the store', () => {
  it('drops a plugin that stopped and loads it again when it runs, from what the host said and nothing the test calls on the store', async () => {
    const events = fakeEvents();
    const store = new PluginStore({ importBundle: async () => ({ [CONTRIBUTION_EXPORT_V1]: acme() }), clearBundle: () => undefined, log: () => undefined });
    await store.load({ id: 'acme', name: 'Acme plugin' });
    listenForLifecycle(store, events.source);
    expect(store.getSnapshot()).toMatchObject([{ id: 'acme', phase: 'ready' }]);

    events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'crashed' });
    expect(store.getSnapshot()).toMatchObject([{ id: 'acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'crashed' } }]);

    events.emit('plugin/state_change', { pluginID: 'acme', from: 'Recovering', to: 'Running' });
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject([{ id: 'acme', phase: 'ready' }]);
    });
  });
});
