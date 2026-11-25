import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../shell';
import type { FrameV1, OverviewPageV1 } from '../contract/v1';
import { unloadedFailure } from '../loader/failure';
import { acme } from '../testing';
import { ConnectionNames } from './connectionName';
import { createContributions, describeDetail, HOME_PAGE, routeKey, type PluginChoice, type PluginSource } from './contributions';
import { HOME_ROUTE } from './hostPages';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// What the tab model asks the host, answered from fake entries: no React, no plugin code runs.

const ready = (id = 'acme', name = 'Acme plugin', patch: Parameters<typeof acme>[0] = {}): PluginEntry => ({ id, name, phase: 'ready', contribution: acme(patch) });
const loading = (id = 'slow', name = 'Slow plugin'): PluginEntry => ({ id, name, phase: 'loading' });
const failed = (id = 'broken', name = 'Broken plugin'): PluginEntry => ({ id, name, phase: 'failed', failure: { kind: 'missing', message: 'The plugin\'s interface could not be read.' } });
const gone = (cause: 'crashed' | 'reloaded', id = 'gone', name = 'Gone plugin'): PluginEntry => ({ id, name, phase: 'failed', failure: unloadedFailure(cause) });

const route = (plugin: string, contribution: string, params: Route['params'] = {}): Route => ({ plugin, contribution, params });
const from = (plugin: string, params: Route['params'] = {}) => ({ from: route(plugin, 'widgets', params), source: 'test' });
const nowhere = { from: undefined, source: 'test' };

/** Fake entries the test changes with `set`, which tells whoever listens. */
function world(initial: readonly PluginEntry[]) {
  let entries = initial;
  const listeners = new Set<() => void>();
  const plugins: PluginSource = {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const frames = new Published<FrameV1>();
  const names = new ConnectionNames();
  const contributions = createContributions({ plugins, frames, names });
  return {
    names,
    contributions,
    frames,
    listeners,
    set: (next: readonly PluginEntry[]) => {
      entries = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe('describe', () => {
  it('says nothing about a plugin the host does not have', () => {
    expect(world([ready()]).contributions.describe(route('nobody', 'widgets'))).toBeUndefined();
  });

  it('names a ready plugin\'s page from its definition, its glyph from the sidebar entry, and its path from the plugin and the title', () => {
    const { contributions } = world([ready()]);

    expect(contributions.describe(route('acme', 'gadgets'))).toEqual({
      title: 'Gadgets',
      icon: 'box',
      pluginName: 'Acme',
      path: ['Acme', 'Gadgets'],
      scope: undefined,
      facets: [],
    });
  });

  it('reads the scope from the connection the route names, by the name its page said: the key is the scope\'s id and is never drawn', () => {
    const { contributions, frames } = world([ready()]);
    const at = route('acme', 'widgets', { connection: 'north-0123456789' });
    frames.publish(routeKey(at), { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme', 'north', 'Widgets'], scope: [{ label: 'Connection', icon: 'server', text: 'north' }] });

    const description = contributions.describe(at);
    expect(description?.scope).toEqual({ id: 'north-0123456789', label: 'north' });
    expect(description?.facets).toEqual(['north']);
    expect(description?.path).toEqual(['Acme', 'north', 'Widgets']);
  });

  it('says no connection when no name is known, and never the key: a scope with an empty label and no crumb and no facet that is the key', () => {
    const description = world([ready()]).contributions.describe(route('acme', 'widgets', { connection: 'north-0123456789' }));

    expect(description?.scope).toEqual({ id: 'north-0123456789', label: '' });
    expect(description?.facets).toEqual([]);
    expect(description?.path).toEqual(['Acme', 'Widgets']);
  });

  it('takes the name from the face a page marked as the connection, whatever it is labelled, and from the face labelled Connection of a plugin written before the marker', () => {
    const { contributions, frames } = world([ready()]);
    const marked = route('acme', 'widgets', { connection: 'a-0123456789' });
    const labelled = route('acme', 'gadgets', { connection: 'b-0123456789' });
    frames.publish(routeKey(marked), { tab: { title: 'Widgets', icon: 'box' }, path: ['Widgets'], scope: [{ label: 'Zone', icon: 'server', text: 'all' }, { label: 'Cluster', icon: 'server', text: 'alpha', role: 'connection' }] });
    frames.publish(routeKey(labelled), { tab: { title: 'Gadgets', icon: 'box' }, path: ['Gadgets'], scope: [{ label: 'Connection', icon: 'server', text: 'beta' }] });

    expect(contributions.describe(marked)?.scope).toEqual({ id: 'a-0123456789', label: 'alpha' });
    expect(contributions.describe(labelled)?.scope).toEqual({ id: 'b-0123456789', label: 'beta' });
  });

  it('takes the name the window learned for the connection when the route\'s own page has published nothing: a page of the same connection that was never drawn', () => {
    const { contributions, names } = world([ready()]);
    names.learn('acme', 'north-0123456789', 'north');

    expect(contributions.describe(route('acme', 'gadgets', { connection: 'north-0123456789' }))).toMatchObject({ scope: { id: 'north-0123456789', label: 'north' }, path: ['Acme', 'north', 'Gadgets'], facets: ['north'] });
    expect(contributions.describe(route('acme', 'gadgets', { connection: 'other-0123456789' }))?.scope?.label).toBe('');
  });

  it('puts the name where a path a page published has the key as a crumb, and leaves the crumb out when no name is known', () => {
    const { contributions, frames } = world([ready()]);
    const at = route('acme', 'widgets', { connection: 'north-0123456789' });
    frames.publish(routeKey(at), { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme', 'north-0123456789', 'Widgets'] });
    expect(contributions.describe(at)?.path).toEqual(['Acme', 'Widgets']);

    frames.publish(routeKey(at), { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme', 'north-0123456789', 'Widgets'], scope: [{ label: 'Connection', icon: 'server', text: 'north' }] });
    expect(contributions.describe(at)?.path).toEqual(['Acme', 'north', 'Widgets']);
  });

  it('describes a page the plugin does not have as its home', () => {
    expect(world([ready()]).contributions.describe(route('acme', 'nothing'))?.title).toBe('Widgets');
    expect(world([ready()]).contributions.describe(route('acme', HOME_PAGE))?.title).toBe('Widgets');
  });

  it('takes the title, glyph and path a mounted page published over its own definition', () => {
    const { contributions, frames } = world([ready()]);
    const at = route('acme', 'widgets', { connection: 'north' });
    frames.publish(routeKey(at), { tab: { title: 'Widgets · north', icon: 'server' }, path: ['Acme', 'north', 'Widgets'], scope: [{ label: 'Connection', icon: 'server', text: 'north' }] });

    expect(contributions.describe(at)).toMatchObject({ title: 'Widgets · north', icon: 'server', path: ['Acme', 'north', 'Widgets'] });
    // Another route has published nothing.
    expect(contributions.describe(route('acme', 'widgets'))?.title).toBe('Widgets');
  });

  it('names a plugin that is loading by its name, with the generic glyph, as a stand-in: a tab that already has a face keeps it (S3a: a tab restored from a session)', () => {
    expect(world([loading()]).contributions.describe(route('slow', HOME_PAGE))).toMatchObject({ title: 'Slow plugin', icon: 'box', pluginName: 'Slow plugin', path: ['Slow plugin'], provisional: true });
  });

  it('names a plugin that failed by its name, with the error glyph, and means it: the tab says what happened', () => {
    const description = world([failed()]).contributions.describe(route('broken', HOME_PAGE));

    expect(description).toMatchObject({ title: 'Broken plugin', icon: 'status-error', path: ['Broken plugin'] });
    expect(description).not.toHaveProperty('provisional');
  });

  it('names a plugin whose process crashed with the error glyph, and one that is reloading with the generic glyph: nothing failed in the second', () => {
    const { contributions } = world([gone('crashed', 'crashed', 'Crashed plugin'), gone('reloaded', 'reloading', 'Reloading plugin')]);

    expect(contributions.describe(route('crashed', HOME_PAGE))).toMatchObject({ title: 'Crashed plugin', icon: 'status-error', path: ['Crashed plugin'] });
    expect(contributions.describe(route('reloading', HOME_PAGE))).toMatchObject({ title: 'Reloading plugin', icon: 'box', path: ['Reloading plugin'] });
    expect(contributions.describe(route('crashed', HOME_PAGE))).not.toHaveProperty('provisional');
  });

  it('keeps the connection of a plugin that is not ready by its name when one is known, so its tab is told from a twin, and by nothing when none is: never by the key', () => {
    const { contributions, names } = world([loading()]);
    expect(contributions.describe(route('slow', HOME_PAGE, { connection: 'north-0123456789' }))).toMatchObject({ scope: { id: 'north-0123456789', label: '' }, facets: [] });

    names.learn('slow', 'north-0123456789', 'north');
    expect(contributions.describe(route('slow', HOME_PAGE, { connection: 'north-0123456789' }))).toMatchObject({ scope: { id: 'north-0123456789', label: 'north' }, facets: ['north'] });
  });

  it('describes a detail page by the name of its connection in its path and its facets, and by none without one: the key is only in the route a crumb opens', () => {
    const definition = { kind: 'Sprocket', tile: { icon: 'box' as const }, identity: { name: 'name', facets: ['bay'] }, list: { page: 'widgets', label: 'Widgets' }, tabs: [{ id: 'overview', label: 'Overview' }] };
    const at = route('acme', 'sprocket', { name: 'a', bay: 'east', connection: 'north-0123456789' });
    const labels = (description: ReturnType<typeof describeDetail>): string[] => (description.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label));
    const named = describeDetail('Acme', at, definition, 'north');
    const unnamed = describeDetail('Acme', at, definition, undefined);

    expect(labels(named)).toEqual(['Acme', 'north', 'Widgets', 'a']);
    expect(named.facets).toEqual(['east', 'north']);
    expect(named.scope).toEqual({ id: 'north-0123456789', label: 'north' });
    expect(labels(unnamed)).toEqual(['Acme', 'Widgets', 'a']);
    expect(unnamed.facets).toEqual(['east']);
    expect(unnamed.scope).toEqual({ id: 'north-0123456789', label: '' });
  });

  it('takes the key out of a face a saved tab comes back with, and teaches the window the name a saved face holds', () => {
    const { contributions, names } = world([loading()]);
    const at = route('slow', HOME_PAGE, { connection: 'north-0123456789' });
    const saved = { title: 'Slow plugin', icon: 'box', scope: { id: 'north-0123456789', label: 'north-0123456789' }, path: [{ label: 'Slow plugin' }, { label: 'north-0123456789' }], facets: ['north-0123456789'], pluginName: 'Slow plugin', singleton: false, identity: 'key' as const };

    const restored = contributions.restoreFace?.(saved, at);
    expect(restored?.scope).toEqual({ id: 'north-0123456789', label: '' });
    expect(restored?.facets).toEqual([]);

    const named = contributions.restoreFace?.({ ...saved, scope: { id: 'north-0123456789', label: 'north' } }, at);
    expect(named?.scope).toEqual({ id: 'north-0123456789', label: 'north' });
    expect(names.get('slow', 'north-0123456789')).toBe('north');
  });
});

// The face of an overview page's tab (HM3): the page of a scope is named by its definition, the connection's NAME and the plugin, and nothing else, so it is the same before the page's hook has run (a tab restored in the
// background, never drawn) and after it (the frame the page published): the title is the page's, the glyph the tile's and not the sidebar entry's, the path the plugin and the connection.
describe('describe: an overview page', () => {
  const overview: OverviewPageV1 = {
    kind: 'overview',
    definition: { title: 'Overview', tile: { icon: 'server' }, tabs: [{ id: 'overview', label: 'Overview' }] },
    usePage: () => ({ source: { state: { kind: 'loading' }, view: undefined, refreshing: false, refresh: async () => undefined } }),
  };
  /** A plugin whose home is the overview, with a sidebar entry for it that wears another glyph than the page's tile. */
  const home = (): PluginEntry => {
    const base = acme();
    return ready('acme', 'Acme plugin', { pages: { overview, ...base.pages }, home: 'overview', sidebar: { ...base.sidebar, nodes: [{ id: 'overview', label: 'Overview', icon: 'layers' }, ...base.sidebar.nodes] } });
  };

  const KEY = 'north-0123456789';

  it('names the tab from the definition and the connection\'s name alone, before its page has published anything: the title, the tile\'s glyph, the path, the scope and the qualifier', () => {
    const { contributions, names } = world([home()]);
    names.learn('acme', KEY, 'north');

    expect(contributions.describe(route('acme', 'overview', { connection: KEY }))).toEqual({
      title: 'Overview',
      icon: 'server',
      pluginName: 'Acme',
      path: ['Acme', 'north'],
      scope: { id: KEY, label: 'north' },
      facets: ['north'],
    });
  });

  it('says no connection when none is known: the plugin alone in the path, no qualifier, and the scope the key tells places apart by, with no label', () => {
    const { contributions } = world([home()]);

    expect(contributions.describe(route('acme', 'overview', { connection: KEY }))).toEqual({ title: 'Overview', icon: 'server', pluginName: 'Acme', path: ['Acme'], scope: { id: KEY, label: '' }, facets: [] });
    expect(contributions.describe(route('acme', 'overview'))).toEqual({ title: 'Overview', icon: 'server', pluginName: 'Acme', path: ['Acme'], scope: undefined, facets: [] });
  });

  it('is the face the page publishes: the same title, glyph and path before and after the frame, and the name its lane says is the connection\'s', () => {
    const { contributions, frames } = world([home()]);
    const at = route('acme', 'overview', { connection: KEY });
    const frame: FrameV1 = { tab: { title: 'Overview', icon: 'server' }, path: ['Acme', 'north'], scope: [{ label: 'Zone', icon: 'server', text: 'north', role: 'connection' }] };
    frames.publish(routeKey(at), frame);

    expect(contributions.describe(at)).toEqual({ title: 'Overview', icon: 'server', pluginName: 'Acme', path: ['Acme', 'north'], scope: { id: KEY, label: 'north' }, facets: ['north'] });
  });

  it('describes the plugin\'s home as the overview, and the route a sidebar entry or a connection opens at it: the same face', () => {
    const { contributions, names } = world([home()]);
    names.learn('acme', KEY, 'north');

    expect(contributions.describe(route('acme', HOME_PAGE, { connection: KEY }))).toEqual(contributions.describe(route('acme', 'overview', { connection: KEY })));
  });
});

describe('availability', () => {
  it('refuses a plugin the host does not have, with its reason', () => {
    expect(world([]).contributions.availability?.(route('nobody', 'x'))).toEqual({ state: 'unavailable', reason: 'This plugin is not installed, or is turned off.' });
  });

  it('opens a ready plugin, and a plugin that is loading or failed to a page that says so', () => {
    const { contributions } = world([ready(), loading(), failed()]);

    expect(contributions.availability?.(route('acme', 'widgets'))).toEqual({ state: 'available' });
    expect(contributions.availability?.(route('slow', HOME_PAGE))).toEqual({ state: 'degraded', reason: 'This plugin is loading.' });
    expect(contributions.availability?.(route('broken', HOME_PAGE))).toEqual({ state: 'degraded', reason: 'This plugin did not load.' });
  });

  it('says why a plugin that stopped is degraded, in the host\'s words, not that it did not load', () => {
    const { contributions } = world([gone('crashed', 'crashed'), gone('reloaded', 'reloading')]);

    expect(contributions.availability?.(route('crashed', HOME_PAGE))).toEqual({ state: 'degraded', reason: 'The plugin process stopped unexpectedly, so its pages can\'t load data.' });
    expect(contributions.availability?.(route('reloading', HOME_PAGE))).toEqual({ state: 'degraded', reason: 'The plugin is starting again. The page opens when it is ready.' });
  });
});

describe('complete', () => {
  it('returns the very route when there is nothing to fill in', () => {
    const at = route('acme', 'gadgets');
    expect(world([ready()]).contributions.complete?.(at, nowhere)).toBe(at);
  });

  it('turns the stand-in page, and a page the plugin does not have, into its home', () => {
    const { contributions } = world([ready()]);

    expect(contributions.complete?.(route('acme', HOME_PAGE), nowhere)).toEqual(route('acme', 'widgets'));
    expect(contributions.complete?.(route('acme', 'nothing'), nowhere)).toEqual(route('acme', 'widgets'));
  });

  it('keeps the stand-in while the plugin has not loaded, and for one that failed', () => {
    const { contributions } = world([loading(), failed()]);

    expect(contributions.complete?.(route('slow', HOME_PAGE), nowhere)).toEqual(route('slow', HOME_PAGE));
    expect(contributions.complete?.(route('broken', HOME_PAGE), nowhere)).toEqual(route('broken', HOME_PAGE));
  });

  it('keeps the page of a plugin that is not ready as it is named, since it cannot know the pages', () => {
    expect(world([loading()]).contributions.complete?.(route('slow', 'items'), nowhere)).toEqual(route('slow', 'items'));
  });

  it('opens a page in the connection of the tab it is opened from, in the same plugin', () => {
    const { contributions } = world([ready()]);

    expect(contributions.complete?.(route('acme', 'gadgets'), from('acme', { connection: 'north' }))).toEqual(route('acme', 'gadgets', { connection: 'north' }));
  });

  it('does not take a connection from another plugin\'s tab, and never overrides the one the route names', () => {
    const { contributions } = world([ready(), ready('other', 'Other plugin')]);

    expect(contributions.complete?.(route('acme', 'gadgets'), from('other', { connection: 'north' }))).toEqual(route('acme', 'gadgets'));
    expect(contributions.complete?.(route('acme', 'gadgets', { connection: 'south' }), from('acme', { connection: 'north' }))).toEqual(route('acme', 'gadgets', { connection: 'south' }));
  });

  it('fills in the connection and the home together', () => {
    expect(world([ready()]).contributions.complete?.(route('acme', HOME_PAGE), from('acme', { connection: 'north' }))).toEqual(route('acme', 'widgets', { connection: 'north' }));
  });
});

describe('home', () => {
  it('is a plugin\'s own first page when given its id: the contribution\'s home when ready, the stand-in otherwise', () => {
    const { contributions } = world([ready(), loading(), failed()]);

    expect(contributions.home?.('acme')).toEqual({ plugin: 'acme', contribution: 'widgets' });
    expect(contributions.home?.('slow')).toEqual({ plugin: 'slow', contribution: HOME_PAGE });
    expect(contributions.home?.('broken')).toEqual({ plugin: 'broken', contribution: HOME_PAGE });
    expect(contributions.home?.('nobody')).toBeUndefined();
  });

  it('is none for the window: it opens no page of its own, whatever the plugins are doing (decision A17, S3a)', () => {
    expect(world([failed('a-broken'), ready('b-acme'), ready('c-acme')]).contributions.home?.()).toBeUndefined();
    expect(world([failed('a-broken'), failed('b-broken')]).contributions.home?.()).toBeUndefined();
    expect(world([loading('a-slow'), ready('b-acme')]).contributions.home?.()).toBeUndefined();
    expect(world([]).contributions.home?.()).toBeUndefined();
  });
});

describe('subscribe', () => {
  it('tells the model when the plugins change and when a page publishes a frame', () => {
    const { contributions, set, frames } = world([ready()]);
    const listener = vi.fn();
    contributions.subscribe?.(listener);

    set([ready(), loading()]);
    expect(listener).toHaveBeenCalledTimes(1);
    frames.publish('k', { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme'] });
    expect(listener).toHaveBeenCalledTimes(2);
    frames.publish('k', { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme'] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops both listening when it is stopped', () => {
    const { contributions, set, frames, listeners } = world([ready()]);
    const listener = vi.fn();
    const stop = contributions.subscribe?.(listener);
    expect(listeners.size).toBe(1);

    stop?.();
    set([loading()]);
    frames.publish('k', { tab: { title: 'Gadgets', icon: 'box' }, path: [] });

    expect(listener).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});

// A route that names no connection would be read in the plugin's first one, an arbitrary one when there are two or more: the window completes it from what it knows (HM1).
describe('complete, with what the window knows of the plugin\'s connections', () => {
  const choose = (keys: readonly string[], last?: string, state: PluginChoice['state'] = 'ready') => {
    const plugins: PluginSource = { getSnapshot: () => [ready()], subscribe: () => () => undefined };
    return createContributions({ plugins, frames: new Published<FrameV1>(), choice: (plugin) => (plugin === 'acme' ? { state, keys, last } : undefined) });
  };

  const at = route('acme', 'gadgets');

  it('opens a page in the connection the plugin was last used in', () => {
    expect(choose(['north', 'south'], 'south').complete?.(at, nowhere)).toEqual(route('acme', 'gadgets', { connection: 'south' }));
  });

  it('leaves a route alone when the plugin has one connection: there is nothing to choose between, and its links stay as they were', () => {
    expect(choose(['north']).complete?.(at, nowhere)).toBe(at);
    expect(choose(['north'], 'north').complete?.(at, nowhere)).toBe(at);
  });

  it('opens Home, not the plugin, when there are two or more and none was used: the plugin would take its first', () => {
    expect(choose(['north', 'south']).complete?.(at, nowhere)).toEqual(HOME_ROUTE);
    expect(choose(['north', 'south']).complete?.(route('acme', HOME_PAGE), nowhere)).toEqual(HOME_ROUTE);
  });

  it('does not let a last-used connection that is gone choose: it is as if none was used', () => {
    expect(choose(['north', 'south'], 'gone').complete?.(at, nowhere)).toEqual(HOME_ROUTE);
    expect(choose(['north'], 'gone').complete?.(at, nowhere)).toBe(at);
  });

  it('leaves alone a route that names a connection, and one opened from a tab of the plugin, which takes that tab\'s', () => {
    const named = route('acme', 'gadgets', { connection: 'east' });
    expect(choose(['north', 'south'], 'south').complete?.(named, nowhere)).toBe(named);
    expect(choose(['north', 'south'], 'south').complete?.(at, from('acme', { connection: 'north' }))).toEqual(route('acme', 'gadgets', { connection: 'north' }));
  });

  it('leaves a tab that is only described again as it is: it was opened before, and keeps the route it has', () => {
    expect(choose(['north', 'south']).complete?.(at, { from: undefined, source: 'refresh' })).toBe(at);
  });

  it('says nothing for a plugin the window has read no connection of, or has no connection data for', () => {
    expect(choose([]).complete?.(at, nowhere)).toBe(at);
    expect(world([ready()]).contributions.complete?.(at, nowhere)).toBe(at);
    expect(choose(['north', 'south']).complete?.(route('other', 'gadgets'), nowhere)).toEqual(route('other', 'gadgets'));
  });

  // The list of connections is not known (HM2; CodeRabbit on #676): nothing can be chosen, and the plugin is never opened on the first connection it would take.
  describe.each([['unread' as const], ['failed' as const]])('while the list is %s', (state) => {
    it('opens Home, not the plugin, whatever the plugin would have taken', () => {
      expect(choose([], undefined, state).complete?.(at, nowhere)).toEqual(HOME_ROUTE);
      expect(choose(['north', 'south'], 'south', state).complete?.(at, nowhere)).toEqual(HOME_ROUTE);
      expect(choose(['north'], undefined, state).complete?.(route('acme', HOME_PAGE), nowhere)).toEqual(HOME_ROUTE);
    });

    it('leaves alone a route that names a connection, one opened from a tab of the plugin, and a tab that is only described again', () => {
      const named = route('acme', 'gadgets', { connection: 'east' });

      expect(choose([], undefined, state).complete?.(named, nowhere)).toBe(named);
      expect(choose([], undefined, state).complete?.(at, from('acme', { connection: 'north' }))).toEqual(route('acme', 'gadgets', { connection: 'north' }));
      expect(choose([], undefined, state).complete?.(at, { from: undefined, source: 'refresh' })).toBe(at);
    });

    it('says nothing for a plugin the window has no data for: only a plugin whose connections are listed is held back', () => {
      expect(choose([], undefined, state).complete?.(route('other', 'gadgets'), nowhere)).toEqual(route('other', 'gadgets'));
    });
  });
});
