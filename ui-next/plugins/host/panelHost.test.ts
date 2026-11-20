import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogStreams, createPanelStore, LOGS_TOOL, type LogStreams, type PanelStore } from '../../shell';
import { fakeFeed } from '../../shell/panel/logs/testing';
import type { LogTargetV1, PanelHostV1 } from '../contract/v1';
import { panelHostsOf } from './panelHost';

// What a plugin's `ctx.panel` is: the host's Logs registry, bound to the plugin that holds it. The registry is tested in ui-next/shell/panel/logs; what is under test here is the plugin's side of the
// handle: a target in the plugin's words (a `RouteV1`, no plugin id) becomes the host's descriptor in the plugin's name, and the plugin gets back a session it may close.

type Harness = { readonly store: PanelStore; readonly streams: LogStreams; readonly hostOf: (plugin: string) => PanelHostV1 };

function harness(): Harness {
  const store = createPanelStore();
  store.registerTool(LOGS_TOOL);
  store.syncPlugins([
    { id: 'acme', tools: [] },
    { id: 'beta', tools: [] },
  ]);
  const streams = createLogStreams(store);
  streams.attach();
  return { store, streams, hostOf: panelHostsOf(streams) };
}

const target = (patch: Partial<LogTargetV1> = {}): LogTargetV1 => ({ id: 'item/orders-api/app', title: 'orders-api/app', scope: 'north', open: () => fakeFeed(), ...patch });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the handle a plugin gets (`ctx.panel`)', () => {
  it('is one handle for a plugin, however often the host asks: a context that holds it stays the same object', () => {
    const { hostOf } = harness();
    expect(hostOf('acme')).toBe(hostOf('acme'));
    expect(hostOf('acme')).not.toBe(hostOf('beta'));
  });

  it('opens a Logs session in the plugin\'s name, on the target it handed over', () => {
    const { store, hostOf } = harness();
    const opened = hostOf('acme').logs.open(target());
    expect(opened?.id).toBeDefined();
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north' });
  });

  it('cannot open a session in another plugin\'s name, whatever the target says: the handle knows whose it is', () => {
    const { store, hostOf } = harness();
    const forged: LogTargetV1 = Object.assign(target(), { plugin: 'beta' });
    const opened = hostOf('acme').logs.open(forged);
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.plugin).toBe('acme');
  });

  it('writes the resource\'s route as a route of the tab model in the plugin: its page, its connection and its parameters', () => {
    const { streams, hostOf } = harness();
    const opened = hostOf('acme').logs.open(
      target({ resource: { label: 'Item orders-api', kind: 'Item', icon: 'layers', route: { page: 'item', connection: 'north-1', params: { name: 'orders-api', group: 'north-yard' } } } }),
    );
    expect(streams.recordOf(opened?.id ?? '')?.resource).toEqual({
      label: 'Item orders-api',
      kind: 'Item',
      icon: 'layers',
      route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api', group: 'north-yard', connection: 'north-1' } },
    });
  });

  it('hands back a session that closes: its tab goes, and the stream with it', () => {
    const { store, hostOf } = harness();
    const feed = fakeFeed();
    const opened = hostOf('acme').logs.open(target({ open: () => feed }));
    opened?.close();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
  });

  it('answers `undefined`, and the console says why, when the host could not open it', () => {
    const { store, hostOf } = harness();
    store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(hostOf('acme').logs.open(target())).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('answers `undefined` for a target that is not an object, as it does for any that is not well formed, and does not throw into the plugin', () => {
    const { hostOf } = harness();
    expect(hostOf('acme').logs.open(undefined as unknown as LogTargetV1)).toBeUndefined();
    expect(hostOf('acme').logs.open(null as unknown as LogTargetV1)).toBeUndefined();
    expect(hostOf('acme').logs.open({} as LogTargetV1)).toBeUndefined();
  });
});

describe('a target that is not well formed', () => {
  it('does not make the handle throw for a resource that is not an object: the session opens with no resource, and what the registry must refuse it still refuses', () => {
    const { store, hostOf } = harness();
    const opened = hostOf('acme').logs.open({ ...target(), resource: null } as unknown as LogTargetV1);
    expect(opened?.id).toBeDefined();
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ tool: 'logs', plugin: 'acme' });
  });
});
