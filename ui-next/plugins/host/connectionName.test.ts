import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { restoreTabs, STATE_VERSION } from '../../shell/core/tabs';
import { createTabsStore, type Face, type Route, type ShellScopeFace } from '../../shell';
import type { FrameV1 } from '../contract/v1';
import { acme } from '../testing';
import { ConnectionNames, connectionNameOf, laneFor, laneNameOf, NAME_MAX, pathSaid, restoredFace, said } from './connectionName';
import { createContributions, routeKey, type PluginSource } from './contributions';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// The ONE place a route's connection key becomes something a person reads (C1g). A route carries a connection by a KEY (`kind-kind-57a082bd74`: the plugin's own id for it); the NAME a person knows it by is what the
// plugin's page says in its scope lane. The shell says the name and never the key, and says nothing where no name is known. These tests hold the naming module, the face the host makes from it, and every
// string the tab model derives from that face, against a key that is not a name.

const KEY = 'kind-kind-57a082bd74';
const NAME = 'kind-kind';
const OTHER_KEY = 'other-0123456789';

const face = (label: string, text: string, role?: 'connection'): ShellScopeFace => ({ label, icon: 'server', text, ...(role === undefined ? {} : { role }) });

describe('the face that says the connection', () => {
  it('is the one marked `role: connection`, whatever it is labelled: a plugin that labels it otherwise has its name', () => {
    expect(laneNameOf([face('Cluster', NAME, 'connection'), face('Zone', 'All zones')])).toBe(NAME);
    expect(laneNameOf([face('Zone', 'All zones'), face('Compte', NAME, 'connection')])).toBe(NAME);
  });

  it('is the one labelled Connection for a plugin written before the marker: the case of the label and the white space around it do not matter', () => {
    expect(laneNameOf([face('Connection', NAME)])).toBe(NAME);
    expect(laneNameOf([face('Zone', 'x'), face(' connection ', `  ${NAME} `)])).toBe(NAME);
  });

  it('is the marked one before a face labelled Connection, and its text is the answer even when it has none: the marker is the plugin saying which face it is', () => {
    expect(laneNameOf([face('Connection', 'wrong'), face('Cluster', NAME, 'connection')])).toBe(NAME);
    expect(laneNameOf([face('Connection', 'wrong'), face('Cluster', '  ', 'connection')])).toBeNull();
  });

  it('is the first of its kind', () => {
    expect(laneNameOf([face('Connection', NAME), face('Connection', 'other')])).toBe(NAME);
    expect(laneNameOf([face('A', NAME, 'connection'), face('B', 'other', 'connection')])).toBe(NAME);
  });

  it('is none when no face says one, and for a lane that is not what the contract says: what a plugin publishes is not trusted', () => {
    expect(laneNameOf(undefined)).toBeUndefined();
    expect(laneNameOf([])).toBeUndefined();
    expect(laneNameOf([face('Zone', 'All zones'), face('Region', 'eu-west-1')])).toBeUndefined();
    for (const lane of ['north', 42, null, {}, [null, 3, 'x', { label: 3, text: NAME }, { label: 'Connection' }, { label: 'Connection', text: 7 }, { label: 'Connection', text: '  ' }, { role: 'connection', text: 7 }, { role: 'region', label: 'Connection' }]]) {
      expect(laneNameOf(lane), JSON.stringify(lane)).toBeUndefined();
    }
  });

  it('reads a marker that is not the contract\'s as no marker: only `connection` is one', () => {
    expect(laneNameOf([{ label: 'Cluster', icon: 'server', text: NAME, role: 'region' }])).toBeUndefined();
    expect(laneNameOf([{ label: 'Connection', icon: 'server', text: NAME, role: 'region' }])).toBe(NAME);
  });
});

describe('the names a window has learned', () => {
  it('are kept for each plugin and each key, and the latest is the one', () => {
    const names = new ConnectionNames();
    expect(names.get('acme', KEY)).toBeUndefined();

    names.learn('acme', KEY, NAME);
    names.learn('beta', KEY, 'beta\'s');
    expect(names.get('acme', KEY)).toBe(NAME);
    expect(names.get('beta', KEY)).toBe('beta\'s');
    expect(names.get('acme', OTHER_KEY)).toBeUndefined();

    names.learn('acme', KEY, 'renamed');
    expect(names.get('acme', KEY)).toBe('renamed');
  });

  it('are never an empty text', () => {
    const names = new ConnectionNames();
    names.learn('acme', KEY, NAME);
    names.learn('acme', KEY, '  ');
    expect(names.get('acme', KEY)).toBe(NAME);
  });
});

describe('hearing that a learned name changed', () => {
  it('tells a listener when a connection is named, and when its name is another, and not when it is learned again as it is', () => {
    const names = new ConnectionNames();
    let told = 0;
    names.subscribe(() => {
      told += 1;
    });
    names.learn('acme', KEY, NAME);
    expect(told).toBe(1);
    names.learn('acme', KEY, NAME);
    names.learn('acme', KEY, `  ${NAME}  `);
    expect(told).toBe(1);
    names.learn('acme', KEY, 'renamed');
    expect(told).toBe(2);
    expect(names.get('acme', KEY)).toBe('renamed');
  });

  it('tells it with the name already there to be read', () => {
    const names = new ConnectionNames();
    let heard: string | undefined;
    names.subscribe(() => {
      heard = names.get('acme', KEY);
    });
    names.learn('acme', KEY, NAME);
    expect(heard).toBe(NAME);
  });

  it('tells nobody of a name that is empty: an empty name is none', () => {
    const names = new ConnectionNames();
    let told = 0;
    names.subscribe(() => {
      told += 1;
    });
    names.learn('acme', KEY, '  ');
    expect(told).toBe(0);
  });

  it('is a subscription for each call: one that was taken off is not told, and the one made with the same function is, until it is taken off too', () => {
    const names = new ConnectionNames();
    let told = 0;
    const listener = (): void => {
      told += 1;
    };

    const first = names.subscribe(listener);
    const second = names.subscribe(listener);
    names.learn('acme', KEY, NAME);
    expect(told).toBe(2);
    first();
    names.learn('acme', KEY, 'renamed');
    expect(told).toBe(3);
    second();
    names.learn('acme', KEY, 'again');
    expect(told).toBe(3);
  });
});

describe('connectionNameOf', () => {
  const learned = (): ConnectionNames => {
    const names = new ConnectionNames();
    names.learn('acme', KEY, 'learned');
    return names;
  };

  it('is the name the page\'s own lane says, whatever the window has learned', () => {
    expect(connectionNameOf([face('Cluster', NAME, 'connection')], learned(), 'acme', KEY)).toBe(NAME);
  });

  it('is the name the window has learned for the connection when the lane says none of it', () => {
    expect(connectionNameOf(undefined, learned(), 'acme', KEY)).toBe('learned');
    expect(connectionNameOf([face('Zone', 'All zones')], learned(), 'acme', KEY)).toBe('learned');
  });

  it('is none when the lane says it has none, though the window learned one: a marked face with no text', () => {
    expect(connectionNameOf([face('Cluster', ' ', 'connection')], learned(), 'acme', KEY)).toBeUndefined();
  });

  it('is none when nothing says it: no lane and no connection, or a connection the window has not learned the name of', () => {
    expect(connectionNameOf(undefined, learned(), 'acme', undefined)).toBeUndefined();
    expect(connectionNameOf(undefined, learned(), 'acme', OTHER_KEY)).toBeUndefined();
  });

  it('is the lane\'s name for a route that names no connection: a plugin that chose its first connection itself says which', () => {
    expect(connectionNameOf([face('Connection', NAME)], learned(), 'acme', undefined)).toBe(NAME);
  });
});

describe('said', () => {
  it('puts the name where the LAST qualifier is the key, leaves the rest as they are, and leaves the key out when no name is known', () => {
    expect(said(['east', KEY], KEY, NAME)).toEqual(['east', NAME]);
    expect(said(['east', KEY], KEY, undefined)).toEqual(['east']);
    expect(said([KEY, 'east'], KEY, NAME)).toEqual([KEY, 'east']);
    expect(said(['east'], KEY, NAME)).toEqual(['east']);
    expect(said([KEY], undefined, undefined)).toEqual([KEY]);
  });
});

/** A face as a build before the names saved it: the key is the scope's label, a crumb and a facet. */
const keyed = (over: Partial<Face> = {}): Face =>
  Object.freeze({
    title: 'Widgets',
    icon: 'box',
    scope: Object.freeze({ id: KEY, label: KEY }),
    path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: KEY }), Object.freeze({ label: 'Widgets' })]),
    facets: Object.freeze([KEY]),
    pluginName: 'Acme',
    singleton: false,
    identity: 'key' as const,
    ...over,
  });

const at = (connection?: string): Route => ({ plugin: 'acme', contribution: 'widgets', params: connection === undefined ? {} : { connection } });

describe('a face a saved tab comes back with', () => {
  it('loses the key a build before the names saved in it: no label, no crumb and no facet that is the key, and the scope\'s id stays', () => {
    const restored = restoredFace(keyed(), at(KEY), new ConnectionNames());

    expect(restored.scope).toEqual({ id: KEY, label: '' });
    expect(restored.path.map((crumb) => crumb.label)).toEqual(['Acme', 'Widgets']);
    expect(restored.facets).toEqual([]);
    // The key is the scope's id and nowhere else: nothing the face holds apart from it says it.
    expect(JSON.stringify({ ...restored, scope: undefined })).not.toContain(KEY);
  });

  it('keeps the name a build with the names saved, and teaches the window it, so the tab keeps it when its plugin has loaded', () => {
    const names = new ConnectionNames();
    const saved = keyed({
      scope: Object.freeze({ id: KEY, label: NAME }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: NAME }), Object.freeze({ label: 'Widgets' })]),
      facets: Object.freeze([NAME]),
    });

    expect(restoredFace(saved, at(KEY), names)).toBe(saved);
    expect(names.get('acme', KEY)).toBe(NAME);
  });

  it('puts the name a window has learned where a crumb or a facet is the key', () => {
    const names = new ConnectionNames();
    names.learn('acme', KEY, NAME);
    const restored = restoredFace(keyed(), at(KEY), names);

    expect(restored.scope).toEqual({ id: KEY, label: NAME });
    expect(restored.path.map((crumb) => crumb.label)).toEqual(['Acme', NAME, 'Widgets']);
    expect(restored.facets).toEqual([NAME]);
  });

  it('is the same face when the route names no connection or the face holds no key', () => {
    const plain = keyed({ scope: undefined, path: Object.freeze([Object.freeze({ label: 'Acme' })]), facets: Object.freeze([]) });
    expect(restoredFace(plain, at(), new ConnectionNames())).toBe(plain);
    expect(restoredFace(plain, at(KEY), new ConnectionNames())).toBe(plain);
  });
});

// The face the host makes from a route, and the strings the tab model makes of it: the surfaces of the shell (the strip's label, accessible name and tooltip, the status bar's path) read the face and nothing else.
describe('through the tab model, with a key that is not a name', () => {
  const entry = (): PluginEntry => ({ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() });
  const loading: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'loading' };

  function world(entries: readonly PluginEntry[], names = new ConnectionNames()) {
    const plugins: PluginSource = { getSnapshot: () => entries, subscribe: () => () => undefined };
    const frames = new Published<FrameV1>();
    const contributions = createContributions({ plugins, frames, names });
    let counter = 0;
    const tabs = createTabsStore({
      contributions,
      newId: () => {
        counter += 1;
        return `t${String(counter)}`;
      },
    });
    const lane = (route: Route, name: string, path: readonly string[] = ['Acme', name, 'Widgets']): void => {
      frames.publish(routeKey(route), { tab: { title: 'Widgets', icon: 'box' }, path, scope: [face('Connection', name)] });
    };

    return { tabs, frames, names, lane, contributions };
  }

  /** Every string the strip and the status bar draw of every tab, and the tab model's own record of them. */
  function drawn(w: ReturnType<typeof world>): string[] {
    const state = w.tabs.getSnapshot();
    const out: string[] = [];
    for (const id of state.order) {
      const identity = w.tabs.selectors.identity(state, id);
      if (identity !== undefined) {
        out.push(identity.title, identity.qualifier, identity.label, identity.name, identity.tip, ...identity.parts, ...identity.path.map((crumb) => crumb.label));
      }
    }

    for (const item of w.tabs.selectors.strip(state)) {
      out.push(item.scope, item.identity.label, item.identity.name, item.identity.tip);
    }

    return out;
  }

  const keysIn = (strings: readonly string[]): string[] => strings.filter((text) => text.includes(KEY) || text.includes(OTHER_KEY));

  it('says the name of each tab in its label, its accessible name and its tooltip, and the key nowhere: two tabs of one page are told apart by their names', () => {
    const w = world([entry()]);
    const first = at(KEY);
    const second = at(OTHER_KEY);
    w.lane(first, NAME);
    w.lane(second, 'other', ['Acme', 'other', 'Widgets']);
    w.tabs.open({ route: first }, { how: 'new' });
    w.tabs.open({ route: second }, { how: 'new' });

    const strings = drawn(w);
    expect(keysIn(strings)).toEqual([]);
    expect(strings.join('\n')).toContain(NAME);
    expect(strings.join('\n')).toContain('other');
    const state = w.tabs.getSnapshot();
    expect(state.order.map((id) => w.tabs.selectors.identity(state, id)?.label)).toEqual([`Widgets · ${NAME}`, 'Widgets · other']);
  });

  it('says no connection for a tab whose page has not published its lane: no name is known, and a tab then reads as a tab of no connection', () => {
    const w = world([entry()]);
    w.tabs.open({ route: at(KEY) }, { how: 'new' });
    w.tabs.open({ route: at(OTHER_KEY) }, { how: 'new' });

    expect(keysIn(drawn(w))).toEqual([]);
    const state = w.tabs.getSnapshot();
    expect(state.order.map((id) => w.tabs.selectors.identity(state, id)?.label)).toEqual(['Widgets', 'Widgets']);
  });

  it('says the name at once when the page publishes it after the tab was opened, and a tab of the same connection that was never drawn has it from what the window learned', () => {
    const w = world([entry()]);
    w.tabs.open({ route: at(KEY) }, { how: 'new' });
    expect(keysIn(drawn(w))).toEqual([]);

    // What a mounted page does: it publishes its frame and the host remembers the name for the connection.
    w.lane(at(KEY), NAME);
    w.names.learn('acme', KEY, NAME);
    w.tabs.open({ route: { plugin: 'acme', contribution: 'gadgets', params: { connection: KEY } } }, { how: 'background' });

    const strings = drawn(w);
    expect(keysIn(strings)).toEqual([]);
    expect(strings.filter((text) => text.includes(NAME)).length).toBeGreaterThan(2);
    const state = w.tabs.getSnapshot();
    expect(state.order.map((id) => w.tabs.selectors.identity(state, id)?.tip)).toEqual([`Acme › ${NAME} › Widgets`, `Acme › ${NAME} › Gadgets`]);
  });

  it('says nothing of the key while its plugin is loading, for a tab that was just opened at it', () => {
    const w = world([loading]);
    w.tabs.open({ route: at(KEY) }, { how: 'new' });

    expect(keysIn(drawn(w))).toEqual([]);
  });

  it('keeps the scope\'s id as the key: it is how two tabs of one place are one, and it is never drawn', () => {
    const w = world([entry()]);
    w.tabs.open({ route: at(KEY) }, { how: 'new' });
    const first = w.tabs.getSnapshot();
    const tab = first.tabs[first.order[0] ?? ''];

    expect(tab?.face.scope).toEqual({ id: KEY, label: '' });
    expect(tab?.location.key).toContain(KEY);
  });
});

// No code in the shell may build a string a person reads from a route's connection parameter: it says the name (this module) or nothing. A file that reads the parameter at all is named here with what it
// reads it for, so a new reader is a decision of its author and a reviewer's, never an accident.
describe('the files that read a route\'s connection parameter', () => {
  const ROOT = path.resolve(__dirname, '../..');
  /** The ways a file reads the parameter: the helper, a member (`params.connection`, `params?.connection`, `params['connection']`) and a destructuring of the parameters. */
  const READ = /\bconnectionOf\(|\bparams\??\.connection\b|\bparams\?*\[['"]connection['"]\]|\{[^{}]*\bconnection\b[^{}]*\}\s*=\s*[\w.?]*\bparams\b/;
  const SKIP = /(?:\.test\.tsx?|\.d\.ts)$|[\\/](?:probes|e2e|fixture|testing)[\\/]|[\\/]testing\.tsx?$/;

  const ALLOWED: Readonly<Record<string, string>> = {
    'plugins/host/connectionName.ts': 'the naming module: a saved face holds the key of its route, and the key is taken out of it here',
    'plugins/host/connections/actions.ts': 'changes a tab\'s connection and opens a plugin\'s first page in one: the route it makes carries the key the person chose, and a tab already in that connection is left alone',
    'plugins/host/connections/recents.ts': 'remembers which connection a tab was in: the list of connections used last (Home\'s Recent, and the connection a plugin opens in when none is named) is made from the routes of the tabs the window came back with and of the tab on screen; it is never drawn',
    'plugins/host/contributions.ts': 'makes a face from a route: the key is the scope\'s id and never a label; `complete` opens a page in the connection of the tab it is opened from; `panelConnectionOf` says the connection a page is read in for the bottom panel',
    'plugins/host/PluginHost.tsx': 'tells a page\'s hook the connection it is read in, opens a link, and carries the connection of the plugin a sidebar was last shown for',
    'plugins/host/palette.ts': 'opens a place in the connection it was last used in, and compares a chip\'s id with the key: what is drawn is the name',
    'plugins/host/panel.ts': 'addresses a route a session of the bottom panel can open again',
  };

  function sources(directory: string, out: string[] = []): string[] {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      if (statSync(file).isDirectory()) {
        if (name !== 'node_modules') {
          sources(file, out);
        }
      } else if (/\.tsx?$/.test(name) && !SKIP.test(file)) {
        out.push(file);
      }
    }

    return out;
  }

  const readers = sources(ROOT)
    .filter((file) => READ.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();

  it('are the ones that open, address or make a face of a route, and no other: the shell\'s surfaces read the face', () => {
    expect(readers.filter((file) => ALLOWED[file] === undefined)).toEqual([]);
  });

  it('are all still readers: a file that stopped reading it leaves the list', () => {
    expect(Object.keys(ALLOWED).filter((file) => !readers.includes(file))).toEqual([]);
  });

  it('are found by a pattern that holds every way of reading it, and nothing else', () => {
    for (const line of ['connectionOf(route)', 'route.params.connection', 'route.params?.connection', 'route.params[\'connection\']', 'route.params["connection"]', 'const { connection } = route.params;', 'const { name, connection: key } = params;']) {
      expect(READ.test(line), line).toBe(true);
    }

    for (const line of ['const connectionName = laneNameOf(lane);', 'params.connectionTimeout', 'const { connectionName } = props;', 'route.connection']) {
      expect(READ.test(line), line).toBe(false);
    }
  });
});

describe('what a plugin\'s lane and a saved face can hold that is not a name (C1g)', () => {
  const ready: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
  const plugins: PluginSource = { getSnapshot: () => ready, subscribe: () => () => undefined };

  it('skips a face that is not valid, marked or not: it is not the connection, and a valid face after it is', () => {
    const invalid = { label: 7, icon: 'server', text: 'wrong', role: 'connection' };
    expect(laneNameOf([invalid])).toBeUndefined();
    expect(laneNameOf([invalid, face('Connection', NAME)])).toBe(NAME);
    expect(laneNameOf([{ label: 'Cluster', icon: 'server', role: 'connection' }, face('Connection', NAME)])).toBe(NAME);
  });

  it('says there is NO name for a marked face with no text, which is not the lane saying nothing', () => {
    expect(laneNameOf([face('Cluster', '  ', 'connection')])).toBeNull();
    expect(laneNameOf([face('Zone', 'x')])).toBeUndefined();
  });

  it('does not put a name learned before in the place of a marked face that says it has none', () => {
    const names = new ConnectionNames();
    names.learn('acme', KEY, NAME);
    const frames = new Published<FrameV1>();
    const contributions = createContributions({ plugins, frames, names });
    const route = at(KEY);
    expect(contributions.describe(route)?.scope).toEqual({ id: KEY, label: NAME });

    frames.publish(routeKey(route), { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme', 'Widgets'], scope: [face('Cluster', ' ', 'connection')] });
    expect(contributions.describe(route)?.scope).toEqual({ id: KEY, label: '' });
  });

  it('keeps the first and the last crumb of a path when they equal the key: the plugin\'s own name and the page\'s own title are not the connection', () => {
    expect(pathSaid(['Widgets', 'Widgets', 'Widgets'], 'Widgets', 'north')).toEqual(['Widgets', 'north', 'Widgets']);
    expect(pathSaid(['Acme', KEY, 'Widgets'], KEY, undefined)).toEqual(['Acme', 'Widgets']);
    expect(pathSaid(['Acme', KEY], KEY, NAME)).toEqual(['Acme', KEY]);
    expect(pathSaid(['Acme', 'Widgets'], undefined, NAME)).toEqual(['Acme', 'Widgets']);
    const saved = keyed({ path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: 'Widgets' })]) });
    expect(restoredFace(saved, at('Widgets'), new ConnectionNames()).path.map((crumb) => crumb.label)).toEqual(['Acme', 'Widgets']);
  });

  it('does not take a label clipped to fit for a name: a key longer than a label may be is the key still', () => {
    const long = 'production-eu-west-1-cluster-57a082bd74';
    const clipped = `${long.slice(0, 23).trimEnd()}…`;
    const names = new ConnectionNames();
    // The tab model clips the scope's label and nothing else of a face.
    const saved = keyed({
      scope: Object.freeze({ id: long, label: clipped }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: long }), Object.freeze({ label: 'Widgets' })]),
      facets: Object.freeze([long]),
    });
    const restored = restoredFace(saved, at(long), names);

    expect(restored.scope).toEqual({ id: long, label: '' });
    expect(restored.path.map((crumb) => crumb.label)).toEqual(['Acme', 'Widgets']);
    expect(restored.facets).toEqual([]);
    expect(names.get('acme', long)).toBeUndefined();
  });

  it('keeps a name that begins like a short key: only the key clipped to a label is the key', () => {
    const names = new ConnectionNames();
    const saved = keyed({
      scope: Object.freeze({ id: 'production', label: 'prod…' }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: 'prod…' }), Object.freeze({ label: 'Widgets' })]),
      facets: Object.freeze(['prod…']),
    });
    const restored = restoredFace(saved, at('production'), names);

    expect(restored.scope).toEqual({ id: 'production', label: 'prod…' });
    expect(names.get('acme', 'production')).toBe('prod…');
    expect(restored).toBe(saved);
  });

  it('reads only where a build before the names put the connection: a list, a resource or a page called like the key is not the connection', () => {
    const key = 'Widgets';
    // A face of that build, as the tab model keeps it (equal qualifiers are taken once): the key is the scope's label, the crumb after the plugin's and the last qualifier.
    const saved = keyed({
      scope: Object.freeze({ id: key, label: key }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: key }), Object.freeze({ label: 'Widgets' }), Object.freeze({ label: 'Widgets' })]),
      facets: Object.freeze(['Widgets']),
    });
    const restored = restoredFace(saved, at(key), new ConnectionNames());

    expect(restored.scope).toEqual({ id: key, label: '' });
    expect(restored.path.map((crumb) => crumb.label)).toEqual(['Acme', 'Widgets', 'Widgets']);
    expect(restored.facets).toEqual([]);

    // A plugin's own path has no crumb for the connection: nothing in it is taken for one. A face with no scope has no key in it.
    const plain = keyed({
      scope: Object.freeze({ id: key, label: key }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: 'Workloads' }), Object.freeze({ label: 'Widgets' })]),
      facets: Object.freeze([]),
    });
    expect(restoredFace(plain, at(key), new ConnectionNames()).path.map((crumb) => crumb.label)).toEqual(['Acme', 'Workloads', 'Widgets']);
    const bare = keyed({ scope: undefined });
    expect(restoredFace(bare, at(key), new ConnectionNames())).toBe(bare);
  });

  it('leaves a face of this build as it is, whatever it holds that is called like the key: a face with no name says no connection, and its list, page and resource are its own', () => {
    const key = 'Widgets';
    const saved = keyed({
      scope: Object.freeze({ id: key, label: '' }),
      path: Object.freeze([Object.freeze({ label: 'Acme' }), Object.freeze({ label: 'Widgets' }), Object.freeze({ label: 'alpha' })]),
      facets: Object.freeze(['Widgets']),
    });
    expect(restoredFace(saved, at(key), new ConnectionNames())).toBe(saved);
  });

  it('is given a face as the tab model keeps it: a saved session of this build whose list and resource are called like the key comes back as it was saved', () => {
    const loading: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'loading' }];
    const source: PluginSource = { getSnapshot: () => loading, subscribe: () => () => undefined };
    const contributions = createContributions({ plugins: source, frames: new Published<FrameV1>() });
    const route = { plugin: 'acme', contribution: 'widgets', params: { connection: 'Widgets' } };
    const saved = {
      id: 't1',
      route,
      key: 'acme:Widgets:widgets',
      face: { title: 'alpha · Item', icon: 'box', scope: { id: 'Widgets', label: '' }, path: [{ label: 'Acme' }, { label: 'Widgets' }, { label: 'alpha' }], facets: ['Widgets', 'Widgets'], pluginName: 'Acme', singleton: false, identity: 'key' },
      pinned: false,
      preview: false,
      history: { entries: [route], index: 0 },
    };
    const result = restoreTabs({ version: STATE_VERSION, active: 't1', tabs: [saved] }, { contributions });
    if (!result.ok) {
      throw new Error(`not restored: ${result.reason}`);
    }

    expect(result.state.tabs.t1?.face.path.map((crumb) => crumb.label)).toEqual(['Acme', 'Widgets', 'alpha']);
    expect(result.state.tabs.t1?.face.facets).toEqual(['Widgets']);
  });

  it('skips a face with no glyph, as it skips one with no text: the contract requires all three', () => {
    expect(laneNameOf([{ label: 'Cluster', text: 'wrong', role: 'connection' }, face('Connection', NAME)])).toBe(NAME);
    expect(laneNameOf([{ label: 'Connection', icon: 7, text: 'wrong' }])).toBeUndefined();
  });

  it('tells a tab described before the tab whose page names the connection the name in the same pass: a background tab earlier in the strip', () => {
    const frames = new Published<FrameV1>();
    let counter = 0;
    const tabs = createTabsStore({
      contributions: createContributions({ plugins, frames }),
      newId: () => {
        counter += 1;
        return `t${String(counter)}`;
      },
    });
    const shown: Route = { plugin: 'acme', contribution: 'gadgets', params: { connection: KEY } };
    tabs.open({ route: at(KEY) }, { how: 'new' });
    tabs.open({ route: shown }, { how: 'new' });
    frames.publish(routeKey(shown), { tab: { title: 'Gadgets', icon: 'box' }, path: ['Acme', NAME, 'Gadgets'], scope: [face('Cluster', NAME, 'connection')] });

    const state = tabs.getSnapshot();
    expect(state.order.map((id) => tabs.selectors.identity(state, id)?.name)).toEqual([`Widgets, ${NAME}`, `Gadgets, ${NAME}`]);
  });
});

// The lane as the shell draws it (HM1): every face copied member by member, and the face that says the connection made a control by the picker the host makes of it.
describe('the lane the shell draws', () => {
  const picker = { title: 'Connections', placeholder: 'Search connections', empty: 'No connections', icon: 'server' as const, options: [], current: undefined, onChoose: () => undefined };

  it('gives the picker to the marked face only, whatever its label, and to no other', () => {
    const lane = laneFor(
      [
        { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
        { label: 'Where', icon: 'server', text: 'north', role: 'connection' },
      ],
      () => picker,
    );

    expect(lane?.map((face) => face.picker !== undefined)).toEqual([false, true]);
  });

  it('reads a plugin built before the marker by the face labelled Connection, and offers the maker that face\'s glyph and text', () => {
    const seen: Array<{ icon: string; text: string }> = [];
    const lane = laneFor([{ label: 'Connection', icon: 'server', text: 'north' }], (face) => {
      seen.push(face);
      return picker;
    });

    expect(lane?.[0]?.picker).toBe(picker);
    expect(seen[0]).toMatchObject({ icon: 'server', text: 'north' });
  });

  it('never hands on a plugin\'s own object: a member a plugin adds to a face (a picker of its own) is not drawn', () => {
    const smuggled = { label: 'Connection', icon: 'server', text: 'north', role: 'connection', picker: { ...picker, title: 'Mine' }, extra: 1 } as unknown as ShellScopeFace;
    const lane = laneFor([smuggled], undefined);

    expect(lane).toEqual([{ label: 'Connection', icon: 'server', text: 'north', role: 'connection' }]);
  });

  it('leaves a face that is not valid out, makes no picker without a maker, and is none when the page published no lane', () => {
    expect(laneFor([{ label: 'x' } as unknown as ShellScopeFace, { label: 'Connection', icon: 'server', text: 'a', role: 'connection' }], undefined)?.length).toBe(1);
    expect(laneFor([{ label: 'Connection', icon: 'server', text: 'a', role: 'connection' }], undefined)?.[0]?.picker).toBeUndefined();
    expect(laneFor(undefined, () => picker)).toBeUndefined();
  });
});

// N2 of the review of HM3b: a connection NAME of 1,000,000 characters stalled WebKit for more than 45 s in the heading of the overview (the tab clipped it at `LIMITS.scopeLabel`, the heading did not). A name is clipped ONCE, where it comes in, so that no surface of the
// window (a heading, a path, a tab, a Home row, a picker option) can draw an unclipped one: here the lane a page publishes and the names a window learns. The host's own list is held in `connections/words.test.ts` and `store.test.ts`.
describe('a name too long to read (N2)', () => {
  const HUGE = 'n'.repeat(1_000_000);
  const CLIPPED = `${'n'.repeat(NAME_MAX - 1)}…`;

  it('is clipped where the lane says it, with an ellipsis, whichever way the lane marks the face: nothing made from the name can be longer', () => {
    expect(laneNameOf([face('Zone', HUGE, 'connection')])).toBe(CLIPPED);
    expect(laneNameOf([face('Connection', HUGE)])).toBe(CLIPPED);
    expect(connectionNameOf([face('Zone', HUGE, 'connection')], new ConnectionNames(), 'acme', KEY)).toBe(CLIPPED);
  });

  it('is clipped where a window learns it, and what it gives back is the clipped one', () => {
    const names = new ConnectionNames();

    names.learn('acme', KEY, HUGE);

    expect(names.get('acme', KEY)).toBe(CLIPPED);
    expect(connectionNameOf(undefined, names, 'acme', KEY)).toBe(CLIPPED);
  });

  it('is clipped in the face the shell draws, and the picker is made from the clipped text: the name and the face say one thing', () => {
    const seen: string[] = [];
    const lane = laneFor([face('Zone', HUGE, 'connection'), face('Region', HUGE)], (made) => {
      seen.push(made.text);
      return undefined;
    });

    expect(lane?.map((each) => each.text)).toEqual([CLIPPED, CLIPPED]);
    expect(seen).toEqual([CLIPPED]);
  });

  it('does not touch a name a person could have given a connection: up to NAME_MAX characters are kept whole, and the white space round a name is trimmed as it was', () => {
    for (const length of [1, 24, 25, 110, NAME_MAX]) {
      const name = `a${'b'.repeat(length - 1)}`;
      expect(laneNameOf([face('Zone', `  ${name} `, 'connection')]), String(length)).toBe(name);
      const names = new ConnectionNames();
      names.learn('acme', KEY, name);
      expect(names.get('acme', KEY), String(length)).toBe(name);
      expect(laneFor([face('Zone', name, 'connection')], undefined)?.[0]?.text, String(length)).toBe(name);
    }
  });

  it('clips the first name that is too long and no other: one more than NAME_MAX is clipped, to NAME_MAX', () => {
    const over = 'c'.repeat(NAME_MAX + 1);

    expect(laneNameOf([face('Zone', over, 'connection')])).toBe(`${'c'.repeat(NAME_MAX - 1)}…`);
    expect(laneNameOf([face('Zone', over, 'connection')])?.length).toBe(NAME_MAX);
  });

  it('is the same name however it is read: a name that was clipped is not clipped again', () => {
    const once = laneNameOf([face('Zone', HUGE, 'connection')]);
    const names = new ConnectionNames();
    names.learn('acme', KEY, once ?? '');

    expect(names.get('acme', KEY)).toBe(once);
    expect(laneNameOf([face('Zone', once ?? '', 'connection')])).toBe(once);
  });

  it('tells a listener once for a name of a million characters learned twice: what is compared, stored and told is the clipped name', () => {
    const names = new ConnectionNames();
    let told = 0;
    names.subscribe(() => {
      told += 1;
    });

    names.learn('acme', KEY, HUGE);
    names.learn('acme', KEY, HUGE);
    names.learn('acme', KEY, `  ${HUGE}  `);

    expect(told).toBe(1);
    expect(names.get('acme', KEY)).toBe(CLIPPED);

    // Another name is another name, and is told; so is a long one that clips to something else.
    names.learn('acme', KEY, `x${HUGE}`);
    expect(told).toBe(2);
    names.learn('acme', KEY, `x${HUGE}`);
    expect(told).toBe(2);
  });
});
