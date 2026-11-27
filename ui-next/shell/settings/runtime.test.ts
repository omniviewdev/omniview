import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeClient } from './runtime';

const transport = vi.hoisted(() => {
  const listeners = new Map<string, (event: { data: unknown }) => void>();
  return {
    list: vi.fn<() => Promise<unknown>>(), snapshot: vi.fn(), validate: vi.fn(), commit: vi.fn(), listeners,
    on: (name: string, listener: (event: { data: unknown }) => void) => {
      listeners.set(name, listener);
      return () => { listeners.delete(name); };
    },
  };
});
vi.mock('@omniviewdev/runtime/api', () => ({
  PluginManager: { ListPlugins: transport.list },
  SettingsService: { GetSnapshot: transport.snapshot, Validate: transport.validate, Commit: transport.commit },
  WindowClient: {},
}));
vi.mock('@omniviewdev/runtime/runtime', () => ({ Events: { On: transport.on }, onEventsReconnect: vi.fn() }));

afterEach(() => {
  transport.listeners.clear();
  vi.clearAllMocks();
});

describe('settings transport', () => {
  it('discovers the backend-negotiated settings provider, not a manifest declaration or built-in frontend', async () => {
    transport.list.mockResolvedValueOnce([
      { id: 'kubernetes', capabilities: ['exec', 'resource', 'settings'], lastError: 'Diagnostic text stays out of settings.',
        metadata: { name: 'Kubernetes', description: 'Cluster tools', icon: 'LuBox', capabilities: ['resource', 'exec'] } },
      { id: 'builtin-without-provider', capabilities: [], origin: 'builtin', metadata: { capabilities: ['ui', 'settings'] } },
      { id: 'builtin-with-provider', capabilities: ['settings'], origin: 'builtin', metadata: { name: 'Built in', description: '', icon: '' } },
      { id: 'not-started', capabilities: null, metadata: { capabilities: ['settings'] } },
    ]).mockResolvedValueOnce(null);
    const client = runtimeClient();
    expect(await client.inventory()).toEqual([
      { id: 'kubernetes', name: 'Kubernetes', description: 'Cluster tools', icon: 'LuBox' },
      { id: 'builtin-with-provider', name: 'Built in', description: '', icon: '' },
    ]);
    expect(await client.inventory()).toEqual([]);
    expect(transport.list).toHaveBeenCalledTimes(2);
  });

  it('passes the same scope and opaque key to the service for read, validation, and durable commit', async () => {
    const client = runtimeClient();
    const scope = { kind: 'plugin', pluginId: 'kubernetes' } as const;
    const key = 'connections.context.timeout';
    const patch = { [key]: 17 };
    await client.snapshot(scope);
    await client.validate(scope, key, 17);
    await client.commit(scope, patch);
    expect(transport.snapshot).toHaveBeenCalledWith(scope);
    expect(transport.validate).toHaveBeenCalledWith(scope, key, 17);
    expect(transport.commit).toHaveBeenCalledWith(scope, patch);
  });

  it('dispatches scoped changes, ignores malformed events, and removes transport listeners on close', () => {
    const client = runtimeClient();
    const changed = vi.fn();
    const inventory = vi.fn();
    const stop = client.onChanged(changed);
    const stopInventory = client.onInventoryChanged(inventory);
    const send = (name: string, data: unknown) => transport.listeners.get(name)?.({ data });
    for (const data of [null, {}, { kind: 'plugin' }, { kind: 'plugin', pluginId: '' }, { kind: 'host', pluginId: 'kubernetes' }]) {
      send('settings/changed', data);
    }
    expect(changed).not.toHaveBeenCalled();
    send('settings/changed', { kind: 'plugin', pluginId: 'kubernetes' });
    send('settings/changed', { kind: 'host' });
    expect(changed.mock.calls).toEqual([[{ kind: 'plugin', pluginId: 'kubernetes' }], [{ kind: 'host' }]]);
    send('plugin/state_change', { to: 'Starting' });
    expect(inventory).not.toHaveBeenCalled();
    send('plugin/inventory_changed', undefined);
    send('plugin/unloaded', { pluginID: 'kubernetes', cause: 'reloaded' });
    send('plugin/state_change', { to: 'Running' });
    expect(inventory).toHaveBeenCalledTimes(3);
    stop();
    stopInventory();
    expect(transport.listeners.size).toBe(0);
  });
});
