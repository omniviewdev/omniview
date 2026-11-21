import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContributionV1, PanelToolV1 } from '../contract/v1';
import type { LoadFailure } from '../loader/failure';
import { cardOfSession, newSessionOf, panelPluginsOf, routeAddressOf, routeInputOf, routeV1Of, sessionV1, toolOf } from './panel';
import type { PluginEntry } from './pluginStore';
import { parseRoute } from './route';

// The host's side of the panel contribution (contract/v1.ts, `panel`): what each ready plugin brings to the panel, which plugin's body and card answer for a session, and how the plugin's
// route (a page, a connection, text parameters) and the model's (a plugin, a page, plain data) are written one in the other.

const body = () => null;
const tool = (patch: Partial<PanelToolV1> = {}): PanelToolV1 => ({ label: 'Streams', icon: 'server', order: 40, Body: body, ...patch });

const contribution = (panel: ContributionV1['panel']): ContributionV1 => ({
  plugin: { name: 'Acme' },
  sidebar: { label: 'Acme', title: 'Acme', nodes: [] },
  pages: {},
  home: 'items',
  panel,
});

const ready = (id: string, panel: ContributionV1['panel']): PluginEntry => ({ id, name: id, phase: 'ready', contribution: contribution(panel) });
const loading = (id: string): PluginEntry => ({ id, name: id, phase: 'loading' });

describe('what the plugins bring to the panel', () => {
  it('is, for each plugin that is ready, the tools it brings by its own ids; a plugin that brings none is live all the same', () => {
    const plugins = panelPluginsOf([ready('acme', { tools: { streams: tool(), other: tool({ label: 'Other', order: undefined }) } }), ready('beta', undefined), loading('gamma')]);
    expect(plugins).toEqual([
      { id: 'acme', tools: [{ id: 'streams', label: 'Streams', icon: 'server', order: 40 }, { id: 'other', label: 'Other', icon: 'server', order: undefined }] },
      { id: 'beta', tools: [] },
    ]);
  });

  it('is nothing for a plugin that is loading or did not load: it is not live', () => {
    const failure: LoadFailure = { kind: 'broken', message: 'The plugin did not load.' };
    const failed: PluginEntry = { id: 'delta', name: 'delta', phase: 'failed', failure };
    expect(panelPluginsOf([loading('gamma'), failed])).toEqual([]);
  });

  // R2: the order the plugins are handed to the panel in is the order the model keeps for what ties, so it is the rail's, which is the same whatever order the plugin store lists the plugins in and whichever plugin loaded first.
  it('lists the plugins in the order of the rail and not the order of the entries: a plugin that declares a lower place leads, one that declares none follows by name', () => {
    const placed = (id: string, order: number | undefined): PluginEntry => ({
      id,
      name: id,
      phase: 'ready',
      contribution: { ...contribution({ tools: { streams: tool() } }), plugin: { name: id }, rail: order === undefined ? true : { icon: 'layers', order } },
    });
    const entries = [placed('a-last', 30), placed('b-none', undefined), placed('c-first', 10), placed('d-second', 20)];
    expect(panelPluginsOf(entries).map((plugin) => plugin.id)).toEqual(['c-first', 'd-second', 'a-last', 'b-none']);
    expect(panelPluginsOf([...entries].reverse()).map((plugin) => plugin.id)).toEqual(['c-first', 'd-second', 'a-last', 'b-none']);
  });
});

describe('which plugin\'s tool a tool id is', () => {
  const entries = [ready('acme', { tools: { streams: tool() } }), ready('beta', { tools: { streams: tool({ label: 'Beta streams' }) } })];

  it('is read from the id the panel makes: the plugin, a colon, the plugin\'s own id', () => {
    expect(toolOf(entries, 'acme:streams')?.tool.label).toBe('Streams');
    expect(toolOf(entries, 'beta:streams')?.tool.label).toBe('Beta streams');
    expect(toolOf(entries, 'acme:streams')).toMatchObject({ plugin: 'acme', local: 'streams' });
  });

  it('is nothing for a tool of the host, a plugin that is not ready, or a tool the plugin does not have', () => {
    expect(toolOf(entries, 'logs')).toBeUndefined();
    expect(toolOf(entries, 'acme:nope')).toBeUndefined();
    expect(toolOf([loading('acme')], 'acme:streams')).toBeUndefined();
    expect(toolOf(entries, 'gamma:streams')).toBeUndefined();
  });

  it('does not take a plugin whose id starts another\'s for it', () => {
    const similar = [ready('acme', { tools: { streams: tool() } }), ready('acme-two', { tools: { streams: tool({ label: 'Two' }) } })];
    expect(toolOf(similar, 'acme-two:streams')?.tool.label).toBe('Two');
  });
});

describe('a tool id that is a name every object has', () => {
  // A plugin's `tools` is a plain object, and a session of the panel may name any tool id: `acme:constructor` is not a tool unless the plugin brought one (CodeRabbit, state.ts:27).
  const entries = [ready('acme', { tools: { streams: tool() } })];

  it('is no tool, and so has no body, no card and no `+`', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(toolOf(entries, `acme:${name}`), name).toBeUndefined();
      expect(newSessionOf(entries, `acme:${name}`, () => undefined), name).toBeUndefined();
    }
  });

  it('is a tool when the plugin brought one by that name', () => {
    const named = [ready('acme', { tools: { constructor: tool({ label: 'Ctor' }) } })];
    expect(toolOf(named, 'acme:constructor')?.tool.label).toBe('Ctor');
  });
});

describe('a route as the plugin writes it and as the model does', () => {
  it('a plugin\'s route becomes a model route: the page is the contribution, the connection is a parameter', () => {
    expect(routeInputOf('acme', { page: 'item', connection: 'north', params: { name: 'worker' } })).toEqual({ plugin: 'acme', contribution: 'item', params: { name: 'worker', connection: 'north' } });
    expect(routeInputOf('acme', { page: 'items', params: {} })).toEqual({ plugin: 'acme', contribution: 'items', params: {} });
  });

  it('and back: the connection leaves the parameters, and a parameter that is not text is dropped', () => {
    expect(routeV1Of({ plugin: 'acme', contribution: 'item', params: { connection: 'north', name: 'worker', n: 3 } })).toEqual({ page: 'item', connection: 'north', params: { name: 'worker' } });
    expect(routeV1Of({ plugin: 'acme', contribution: 'items', params: {} })).toEqual({ page: 'items', connection: undefined, params: {} });
  });

  it('a session as the plugin reads it has its resource as the plugin\'s own route', () => {
    const route = { plugin: 'acme', contribution: 'item', params: { connection: 'north', name: 'worker' } };
    expect(sessionV1({ id: 's1', tool: 'acme:streams', plugin: 'acme', title: 'worker', scope: 'dev', state: 'running', since: 5, cause: '', route })).toEqual({
      id: 's1',
      tool: 'acme:streams',
      title: 'worker',
      scope: 'dev',
      state: 'running',
      since: 5,
      cause: '',
      route: { page: 'item', connection: 'north', params: { name: 'worker' } },
    });
    expect(sessionV1({ id: 's2', tool: 'logs', plugin: 'acme', title: 'x', scope: '', state: 'ended', since: 5, cause: 'done' }).route).toBeUndefined();
  });
});

describe('the address of a route: what a link a card draws carries (CodeRabbit, PluginHost.tsx:509)', () => {
  it('names the plugin, the page, the connection and the text parameters, so a copied address opens where the route was', () => {
    const route = { plugin: 'acme', contribution: 'item', params: { name: 'worker', connection: 'north' } };
    expect(routeAddressOf(route)).toBe('#/acme/item?connection=north&name=worker');
    expect(parseRoute(routeAddressOf(route))).toEqual({ plugin: 'acme', page: 'item', connection: 'north', params: { name: 'worker' } });
  });

  it('has no connection when the route has none, and leaves out a parameter that is not text', () => {
    expect(routeAddressOf({ plugin: 'acme', contribution: 'items', params: {} })).toBe('#/acme/items');
    expect(routeAddressOf({ plugin: 'acme', contribution: 'item', params: { name: 'worker', n: 3 } })).toBe('#/acme/item?name=worker');
  });
});

describe('the card of a session', () => {
  const session = { id: 's1', tool: 'acme:streams', plugin: 'acme', title: 'worker', scope: '', state: 'running' as const, since: 5, cause: '' };
  const route = { page: 'item', params: { name: 'worker' } };

  it('is the tool\'s own `card` for a session in a tool of the plugin\'s own, with its resource as a model route', () => {
    const entries = [ready('acme', { tools: { streams: tool({ card: () => ({ kind: 'Stream', resource: { label: 'Item worker', kind: 'Item', route }, actions: [{ label: 'Stop', onSelect: () => undefined }] }) }) } })];
    const card = cardOfSession(entries, session);
    expect(card?.kind).toBe('Stream');
    expect(card?.resource).toEqual({ label: 'Item worker', kind: 'Item', icon: undefined, route: { plugin: 'acme', contribution: 'item', params: { name: 'worker' } } });
    expect(card?.actions?.map((action) => action.label)).toEqual(['Stop']);
  });

  it('is the plugin\'s card for sessions in a tool of the host, when the session\'s tool is not the plugin\'s own', () => {
    const entries = [ready('acme', { sessions: { logs: { card: () => ({ kind: 'Logs' }) } } })];
    expect(cardOfSession(entries, { ...session, tool: 'logs' })?.kind).toBe('Logs');
  });

  it('is nothing when the plugin says nothing, or is not ready, or the card says none', () => {
    expect(cardOfSession([ready('acme', { tools: { streams: tool() } })], session)).toBeUndefined();
    expect(cardOfSession([loading('acme')], session)).toBeUndefined();
    expect(cardOfSession([ready('acme', { tools: { streams: tool({ card: () => undefined }) } })], session)).toBeUndefined();
    expect(cardOfSession([ready('acme', undefined)], { ...session, tool: 'logs' })).toBeUndefined();
  });

  it('is asked of the plugin that opened the session, whatever the tool', () => {
    const entries = [ready('acme', { sessions: { logs: { card: () => ({ kind: 'Acme' }) } } }), ready('beta', { sessions: { logs: { card: () => ({ kind: 'Beta' }) } } })];
    expect(cardOfSession(entries, { ...session, tool: 'logs', plugin: 'beta' })?.kind).toBe('Beta');
  });

  it('lets a card that throws throw: the card\'s component answers for it, with the host\'s own card', () => {
    const entries = [ready('acme', { tools: { streams: tool({ card: () => {
      throw new Error('no'); 
    } }) } })];
    expect(() => cardOfSession(entries, session)).toThrow('no');
  });
});

describe('how a session starts from a tool', () => {
  it('is the tool\'s `+`: its label, and a start that opens what the plugin answers in the tool, owned by the plugin', () => {
    const opened: unknown[] = [];
    const entries = [ready('acme', { tools: { streams: tool({ newSession: { label: 'New stream', open: () => ({ title: 'alpha', scope: 'dev', route: { page: 'item', params: { name: 'alpha' } }, state: 'running' }) } }) } })];
    const fresh = newSessionOf(entries, 'acme:streams', (input) => opened.push(input));
    expect(fresh?.label).toBe('New stream');
    fresh?.start();
    expect(opened).toEqual([{ tool: 'acme:streams', plugin: 'acme', title: 'alpha', scope: 'dev', route: { plugin: 'acme', contribution: 'item', params: { name: 'alpha' } }, state: 'running', cause: undefined }]);
  });

  it('opens nothing when the plugin answers nothing', () => {
    const opened: unknown[] = [];
    const entries = [ready('acme', { tools: { streams: tool({ newSession: { label: 'New stream', open: () => undefined } }) } })];
    newSessionOf(entries, 'acme:streams', (input) => opened.push(input))?.start();
    expect(opened).toEqual([]);
  });

  it('is nothing for a tool with no `+`, a tool of the host, or a plugin that is not ready', () => {
    expect(newSessionOf([ready('acme', { tools: { streams: tool() } })], 'acme:streams', () => undefined)).toBeUndefined();
    expect(newSessionOf([ready('acme', { tools: { streams: tool() } })], 'logs', () => undefined)).toBeUndefined();
    expect(newSessionOf([loading('acme')], 'acme:streams', () => undefined)).toBeUndefined();
  });
});

describe('a plugin\'s `open` that throws (CodeRabbit, panel.ts:121)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const throwing = (error: unknown) => [ready('acme', { tools: { streams: tool({ newSession: { label: 'New stream', open: () => {
    throw error;
  } } }) } })];

  it('is contained in the start: nothing opens, nothing is thrown at the click, and the failure goes to the log under the panel\'s name', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const opened: unknown[] = [];
    const fresh = newSessionOf(throwing(new Error('no stream')), 'acme:streams', (input) => opened.push(input));
    expect(() => {
      fresh?.start();
    }).not.toThrow();
    expect(opened).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('[panel]');
    expect(String(log.mock.calls[0]?.[0])).toContain('acme');
    expect(log.mock.calls[0]?.[1]).toEqual(new Error('no stream'));
  });

  it('is contained whatever it throws, and a second press tries again', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = newSessionOf(throwing('a string'), 'acme:streams', () => undefined);
    fresh?.start();
    fresh?.start();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('still opens what the plugin answers when it does not throw', () => {
    const opened: unknown[] = [];
    newSessionOf([ready('acme', { tools: { streams: tool({ newSession: { label: 'New stream', open: () => ({ title: 'alpha' }) } }) } })], 'acme:streams', (input) => opened.push(input))?.start();
    expect(opened).toHaveLength(1);
  });
});
