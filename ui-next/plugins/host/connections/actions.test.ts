import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Route, TabsStore } from '../../../shell';
import type { PluginEntry } from '../pluginStore';
import { createConnectionActions, type ConnectionActions } from './actions';
import type { ConnectionsStore } from './store';
import type { ConnectOutcome } from './types';

// What choosing a connection does (HM1): the connection is started first and only a connected one is routed to; the tab keeps its page when it is a list, goes to the list when it is an object's page, and a failure leaves the tab where it was.

const route = (contribution: string, connection?: string): Route => ({ plugin: 'acme', contribution, params: connection === undefined ? {} : { connection } });

const entry = {
  id: 'acme',
  phase: 'ready',
  contribution: {
    home: 'items',
    pages: {
      items: { kind: 'list', definition: { title: 'Items' } },
      jobs: { kind: 'list', definition: { title: 'Jobs' } },
      overview: { kind: 'overview', definition: { title: 'Overview' } },
      item: { kind: 'detail', definition: { list: { page: 'items', label: 'Items' } } },
      orphan: { kind: 'detail', definition: {} },
    },
  },
} as unknown as PluginEntry;

type World = {
  readonly actions: ConnectionActions;
  readonly connect: Mock;
  readonly navigate: Mock;
  readonly open: Mock;
  readonly move: (to: Route | undefined) => void;
};

function world(first: Route | undefined, outcome: Promise<ConnectOutcome> | ConnectOutcome = { status: 'connected' }): World {
  let current = first;
  const connect = vi.fn(async () => outcome);
  const navigate = vi.fn(() => ({ status: 'done', id: 't1' }));
  const open = vi.fn(() => ({ status: 'done', id: 't2', focused: true }));
  const tabs = {
    getSnapshot: () => ({ active: current === undefined ? null : 't1', tabs: current === undefined ? {} : { t1: { location: { route: current } } } }),
    navigate,
    open,
  } as unknown as TabsStore;
  const plugins = { getSnapshot: () => [entry], subscribe: () => () => undefined };
  const actions = createConnectionActions({ tabs, plugins, connections: { connect } as unknown as ConnectionsStore });
  return {
    actions,
    connect,
    navigate,
    open,
    move: (to) => {
      current = to;
    },
  };
}

describe('switching the tab on screen to another connection', () => {
  it('starts the connection first and then replaces the tab\'s history entry with the same list page in the new connection, unless another tab already shows it (reuse)', async () => {
    const w = world(route('jobs', 'north'));

    await expect(w.actions.switchTab('t1', 'south')).resolves.toEqual({ ok: true });

    expect(w.connect).toHaveBeenCalledWith('acme', 'south');
    expect(w.navigate).toHaveBeenCalledWith('t1', { route: route('jobs', 'south') }, { history: 'replace', source: 'connection', reuse: true });
    expect(w.connect.mock.invocationCallOrder[0]).toBeLessThan(w.navigate.mock.invocationCallOrder[0] ?? 0);
  });

  it('keeps an overview page when the connection changes: it is the page of a scope, not of an object, so the new connection has its own and the tab does not go to a list', async () => {
    const w = world(route('overview', 'north'));

    await expect(w.actions.switchTab('t1', 'south')).resolves.toEqual({ ok: true });

    expect(w.navigate).toHaveBeenCalledWith('t1', { route: route('overview', 'south') }, { history: 'replace', source: 'connection', reuse: true });
  });

  it('takes an object\'s page to the list it belongs to, since the object is the old connection\'s, and to the plugin\'s first page when it has none', async () => {
    const object = world({ plugin: 'acme', contribution: 'item', params: { connection: 'north', name: 'orders-api' } });
    await object.actions.switchTab('t1', 'south');
    expect(object.navigate).toHaveBeenCalledWith('t1', { route: route('items', 'south') }, expect.anything());

    const orphan = world(route('orphan', 'north'));
    await orphan.actions.switchTab('t1', 'south');
    expect(orphan.navigate).toHaveBeenCalledWith('t1', { route: route('items', 'south') }, expect.anything());
  });

  it('goes to the plugin\'s first page when the tab is on a page the plugin no longer has', async () => {
    const w = world(route('gone', 'north'));

    await w.actions.switchTab('t1', 'south');

    expect(w.navigate).toHaveBeenCalledWith('t1', { route: route('items', 'south') }, expect.anything());
  });

  it('leaves the tab where it is, and says why, when the connection did not start', async () => {
    const w = world(route('items', 'north'), { status: 'failed', state: 'unauthorized', reason: 'The connection needs you to sign in.' });

    await expect(w.actions.switchTab('t1', 'south')).resolves.toEqual({ ok: false, reason: 'The connection needs you to sign in.' });

    expect(w.navigate).not.toHaveBeenCalled();
  });

  it('changes nothing when the tab is already in that connection', async () => {
    const w = world(route('items', 'south'));

    await expect(w.actions.switchTab('t1', 'south')).resolves.toEqual({ ok: true });

    expect(w.navigate).not.toHaveBeenCalled();
  });

  it('applies the later choice only: the earlier one answers and changes nothing', async () => {
    const slow = Promise.withResolvers<ConnectOutcome>();
    const w = world(route('items', 'north'), slow.promise);

    const first = w.actions.switchTab('t1', 'south');
    const second = w.actions.switchTab('t1', 'east');
    slow.resolve({ status: 'connected' });
    await Promise.all([first, second]);

    expect(w.navigate).toHaveBeenCalledTimes(1);
    expect(w.navigate).toHaveBeenCalledWith('t1', { route: route('items', 'east') }, expect.anything());
  });

  it('answers a superseded choice that fails with ok: the failure belongs to the choice that stands, which here connected', async () => {
    const w = world(route('items', 'north'));
    const south = Promise.withResolvers<ConnectOutcome>();
    const east = Promise.withResolvers<ConnectOutcome>();
    w.connect.mockImplementationOnce(async () => south.promise).mockImplementationOnce(async () => east.promise);

    const first = w.actions.switchTab('t1', 'south');
    const second = w.actions.switchTab('t1', 'east');
    east.resolve({ status: 'connected' });
    south.resolve({ status: 'failed', reason: 'The server did not answer.' } as ConnectOutcome);

    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(w.navigate).toHaveBeenCalledTimes(1);
    expect(w.navigate).toHaveBeenCalledWith('t1', { route: route('items', 'east') }, expect.anything());
  });

  it('leaves a tab alone that went to another plugin while the connection started', async () => {
    const slow = Promise.withResolvers<ConnectOutcome>();
    const w = world(route('items', 'north'), slow.promise);

    const pending = w.actions.switchTab('t1', 'south');
    w.move({ plugin: 'other', contribution: 'x', params: {} });
    slow.resolve({ status: 'connected' });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it('refuses a tab that is closed', async () => {
    const w = world(undefined);

    await expect(w.actions.switchTab('t1', 'south')).resolves.toEqual({ ok: false, reason: 'This tab is closed.' });
  });
});

describe('going to a connection from anywhere', () => {
  it('starts it and opens the plugin\'s first page in it with the options it was given', async () => {
    const w = world(undefined);

    await expect(w.actions.go('acme', 'south', { how: 'background', source: 'home' })).resolves.toEqual({ ok: true });

    expect(w.open).toHaveBeenCalledWith({ route: route('items', 'south') }, { how: 'background', source: 'home' });
  });

  it('opens nothing, and says why, when the connection did not start', async () => {
    const w = world(undefined, { status: 'failed', state: 'unreachable', reason: 'The server did not answer.' });

    await expect(w.actions.go('acme', 'south', { how: 'smart' })).resolves.toEqual({ ok: false, reason: 'The server did not answer.' });

    expect(w.open).not.toHaveBeenCalled();
  });

  it('from the palette switches the tab on screen when it is the plugin\'s, and opens a tab when it is another plugin\'s', async () => {
    const mine = world(route('jobs', 'north'));
    await mine.actions.goOrSwitch('acme', 'south');
    expect(mine.navigate).toHaveBeenCalledTimes(1);
    expect(mine.open).not.toHaveBeenCalled();

    const other = world({ plugin: 'other', contribution: 'x', params: {} });
    await other.actions.goOrSwitch('acme', 'south');
    expect(other.open).toHaveBeenCalledWith({ route: route('items', 'south') }, { how: 'smart', source: 'palette' });
    expect(other.navigate).not.toHaveBeenCalled();
  });
});
