import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../shell';
import type { FrameV1 } from '../contract/v1';
import { acme } from '../testing';
import { createContributions, HOME_PAGE, routeKey, type PluginSource } from './contributions';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// What the tab model asks the host, answered from fake entries: no React, no plugin code runs.

const ready = (id = 'acme', name = 'Acme plugin', patch: Parameters<typeof acme>[0] = {}): PluginEntry => ({ id, name, phase: 'ready', contribution: acme(patch) });
const loading = (id = 'slow', name = 'Slow plugin'): PluginEntry => ({ id, name, phase: 'loading' });
const failed = (id = 'broken', name = 'Broken plugin'): PluginEntry => ({ id, name, phase: 'failed', failure: { kind: 'missing', message: 'The plugin\'s interface could not be read.' } });

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
  const contributions = createContributions({ plugins, frames });
  return {
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

  it('reads the scope from the connection the route names, and puts the connection in the path', () => {
    const description = world([ready()]).contributions.describe(route('acme', 'widgets', { connection: 'north' }));

    expect(description?.scope).toEqual({ id: 'north', label: 'north' });
    expect(description?.facets).toEqual(['north']);
    expect(description?.path).toEqual(['Acme', 'north', 'Widgets']);
  });

  it('ignores a connection that is not text', () => {
    expect(world([ready()]).contributions.describe(route('acme', 'widgets', { connection: 7 }))?.scope).toBeUndefined();
  });

  it('describes a page the plugin does not have as its home', () => {
    expect(world([ready()]).contributions.describe(route('acme', 'nothing'))?.title).toBe('Widgets');
    expect(world([ready()]).contributions.describe(route('acme', HOME_PAGE))?.title).toBe('Widgets');
  });

  it('takes the title, glyph and path a mounted page published over its own definition', () => {
    const { contributions, frames } = world([ready()]);
    const at = route('acme', 'widgets', { connection: 'north' });
    frames.publish(routeKey(at), { tab: { title: 'Widgets · north', icon: 'server' }, path: ['Acme', 'north', 'Widgets'] });

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

  it('keeps the connection of a plugin that is not ready, so its tab is told from a twin', () => {
    expect(world([loading()]).contributions.describe(route('slow', HOME_PAGE, { connection: 'north' }))).toMatchObject({ scope: { id: 'north', label: 'north' }, facets: ['north'] });
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
