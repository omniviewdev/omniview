import { describe, expect, it, vi } from 'vitest';
import type { TabsStore } from '../../shell';
import { makeNotices } from '../../shell/core/notices/testing';
import { createActivityFeed, HOST_SOURCE, type ActivityRecordLike } from '../../shell/panel/activity';
import { createOperations, OPERATIONS_TOOL_ID } from '../../shell/panel/operations';
import { createProblems, PROBLEMS_TOOL_ID } from '../../shell/panel/problems';
import { acme } from '../testing';
import { unloadedFailure } from '../loader/failure';
import { alertConditions } from './conditions';
import { createConnectionActions, type ActionResult, type ConnectOutcome, type ConnectionsState, type ConnectionsStore, type HostConnection } from './connections';
import type { PluginEntry } from './pluginStore';
import { attachPanelTools, badgesOf, cancelFailed, HOST_NAME, resolverOf, subjectOpener, type SubjectOpenerDeps } from './panelTools';

// The host's side of Problems and Operations: the producers that exist today feed the two models, and what each says is true while the window is on screen. The models, the adapters and the bodies have tests of their own;
// what is under test here is the wiring: which producer reaches which tool, that a producer's change reaches it (and nothing else's), that a name that changes is said, and that nothing is followed after the window lets go.

const ready = (id: string, name: string): PluginEntry => ({ id, name: `Manifest ${name}`, phase: 'ready', contribution: { ...acme(), plugin: { ...acme().plugin, name } } });
const failed = (id: string, name: string, cause: 'crashed' | 'reloaded' = 'crashed'): PluginEntry => ({ id, name, phase: 'failed', failure: unloadedFailure(cause) });

/** A source the test drives: the entries now and the listeners to tell. */
function source<T>(initial: T) {
  let held = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => held,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: T) => {
      held = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listeners: () => listeners.size,
  };
}

const state = (connections: ConnectionsState['connections']): ConnectionsState => ({ loaded: true, failed: false, connections });

const task = (id: string, extra: Partial<ActivityRecordLike> = {}): ActivityRecordLike => ({
  id,
  kind: 'task',
  severity: 'info',
  createdAt: '2026-11-24T10:00:00Z',
  source: { pluginID: 'alpha' },
  presentation: { title: `Task ${id}`, progress: { kind: 'units', current: '1', total: '4', unit: 'items' } },
  task: { state: 'running', cancellation: 'unsupported' },
  visibility: { read: false },
  ...extra,
});

const alert = (id: string, state: 'firing' | 'resolved' | 'unknown', extra: Partial<ActivityRecordLike> = {}): ActivityRecordLike => ({
  id,
  kind: 'alert',
  severity: 'warning',
  createdAt: '2026-11-24T10:00:00Z',
  source: { pluginID: 'alpha' },
  presentation: { title: `Alert ${id}` },
  alert: { key: id, state, occurrences: 1 },
  visibility: { read: false },
  ...extra,
});

/** The window: every producer a test can drive, the two real models over them, and the wiring attached. */
function mount(entries: readonly PluginEntry[] = [ready('alpha', 'Alpha Cloud')], connections: ConnectionsState['connections'] = [], failure?: string) {
  const plugins = source(entries);
  const store = source(state(connections));
  const control = createActivityFeed({ cancel: async () => undefined, markRead: async () => undefined });
  const resolve = resolverOf(plugins, store);
  const problems = createProblems();
  const operations = createOperations({ feed: control.feed, resolve });
  if (failure !== undefined) {
    control.push([], failure);
  }

  const stop = attachPanelTools({ plugins, connections: store, feed: control.feed, problems, operations, resolve });
  const heard = vi.fn();
  problems.subscribe(heard);
  return { plugins, store, control, problems, operations, resolve, stop, heard, rows: () => problems.getSnapshot().rows, ops: () => operations.getSnapshot().rows };
}

describe('the names the tools say', () => {
  const plugins = source<readonly PluginEntry[]>([ready('alpha', 'Alpha Cloud'), failed('beta', 'Beta Tools')]);
  const resolve = resolverOf(plugins, source(state([{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'connected', reason: undefined }])));

  it('is the plugin\'s own name once its interface is ready, the manifest\'s while it is not, and the id for a plugin the window has not been told of', () => {
    expect(resolve.plugin('alpha')).toEqual({ id: 'alpha', name: 'Alpha Cloud' });
    expect(resolve.plugin('beta')).toEqual({ id: 'beta', name: 'Beta Tools' });
    expect(resolve.plugin('gamma')).toEqual({ id: 'gamma', name: 'gamma' });
  });

  it('is Omniview for work that names no plugin', () => {
    expect(resolve.plugin(undefined)).toEqual({ id: HOST_SOURCE, name: HOST_NAME });
    expect(resolve.plugin('')).toEqual({ id: HOST_SOURCE, name: HOST_NAME });
  });

  it('is the connection\'s name from the connection store, and nothing for a key the window does not know', () => {
    expect(resolve.connection('alpha', 'c-1')).toBe('north');
    expect(resolve.connection('alpha', 'c-9')).toBeUndefined();
    expect(resolve.connection('beta', 'c-1')).toBeUndefined();
  });

  it('knows no connection when the window has no connection data', () => {
    expect(resolverOf(plugins, undefined).connection('alpha', 'c-1')).toBeUndefined();
  });
});

describe('the names of the connections, indexed once for each snapshot of the store', () => {
  // A scan answers each lookup by reading the connections one after the other. A hundred alerts that name a connection near the end of five thousand read about a million of them every time the alerts are made again, and they
  // are made again for every tick of every task. The index reads each connection once, when the store holds another list, and answers every lookup after that by reading none.
  const CONNECTIONS = 5000;
  const ALERTS = 100;

  /** Connections of one plugin that count how often their plugin is read: a lookup that goes through the list reads it for each connection it passes. */
  function counted(name: (index: number) => string) {
    let reads = 0;
    const connections = Array.from({ length: CONNECTIONS }, (_unused, index): HostConnection => ({
      get plugin() {
        reads += 1;
        return 'alpha';
      },
      key: `c-${index}`,
      name: name(index),
      state: 'connected',
      reason: undefined,
    }));
    return { connections, reads: () => reads };
  }

  /** The alerts of the last hundred connections: the worst case for a scan, which reads nearly every connection for each. */
  const alertsOfTheLast = (): ActivityRecordLike[] =>
    Array.from({ length: ALERTS }, (_unused, index) => alert(`a-${index}`, 'firing', { source: { pluginID: 'alpha', connectionID: `c-${CONNECTIONS - ALERTS + index}` } }));
  const nameOf = (index: number): string => `Connection ${index}`;
  const namesOfTheLast = (): string[] => Array.from({ length: ALERTS }, (_unused, index) => nameOf(CONNECTIONS - ALERTS + index));

  it('reads each connection once for a snapshot, however many alerts look one up, and none for a rebuild over the same snapshot', () => {
    const { connections, reads } = counted(nameOf);
    const resolve = resolverOf(source([ready('alpha', 'Alpha Cloud')]), source(state(connections)));
    const records = alertsOfTheLast();

    const first = alertConditions(records, resolve);
    expect(first.map((condition) => condition.target)).toEqual(namesOfTheLast());
    expect(reads()).toBeLessThanOrEqual(CONNECTIONS);

    const afterFirst = reads();
    expect(alertConditions(records, resolve)).toEqual(first);
    expect(reads()).toBe(afterFirst);
  });

  it('reads the connections again for another snapshot, and says what that one says: a rename is the next answer, and so is a connection that is gone', () => {
    const store = source(state([{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'connected', reason: undefined }]));
    const resolve = resolverOf(source([ready('alpha', 'Alpha Cloud')]), store);
    expect(resolve.connection('alpha', 'c-1')).toBe('north');

    store.set(state([{ plugin: 'alpha', key: 'c-1', name: 'northern', state: 'connected', reason: undefined }]));
    expect(resolve.connection('alpha', 'c-1')).toBe('northern');

    store.set(state([]));
    expect(resolve.connection('alpha', 'c-1')).toBeUndefined();
  });

  it('names a key that a plugin lists twice by its first connection, as a scan for it did', () => {
    const resolve = resolverOf(
      source([ready('alpha', 'Alpha Cloud')]),
      source(
        state([
          { plugin: 'alpha', key: 'c-1', name: 'first', state: 'connected', reason: undefined },
          { plugin: 'alpha', key: 'c-1', name: 'second', state: 'connected', reason: undefined },
        ]),
      ),
    );
    expect(resolve.connection('alpha', 'c-1')).toBe('first');
  });

  it('does not read the connections for a tick of progress: the alerts are made again from the records, and every name comes from the index of the snapshot', () => {
    const { connections, reads } = counted(nameOf);
    const window = mount([ready('alpha', 'Alpha Cloud')], connections);
    const records = alertsOfTheLast();
    const tick = (step: number): ActivityRecordLike => task('t-1', { presentation: { title: 'Task t-1', progress: { kind: 'units', current: String(step), total: '12', unit: 'items' } } });

    window.control.push([...records, tick(1)]);
    expect(window.rows().map((row) => row.target)).toEqual(namesOfTheLast());
    const before = reads();

    for (let step = 2; step <= 11; step += 1) {
      window.control.push([...records, tick(step)]);
    }

    expect(reads()).toBe(before);
  });
});

describe('Problems: what each producer says', () => {
  it('lists a plugin that stopped, and the row leaves when the plugin runs again: nothing is cleared by hand (S74)', () => {
    const window = mount();
    expect(window.rows()).toEqual([]);
    window.plugins.set([failed('alpha', 'Alpha Cloud')]);
    expect(window.rows().map((row) => [row.label, row.source.name, row.subject])).toEqual([['Stopped', 'Alpha Cloud', { kind: 'plugin', plugin: 'alpha' }]]);
    window.plugins.set([ready('alpha', 'Alpha Cloud')]);
    expect(window.rows()).toEqual([]);
  });

  it('does not list a plugin that is starting again: nothing failed', () => {
    const window = mount();
    window.plugins.set([failed('alpha', 'Alpha Cloud', 'reloaded')]);
    expect(window.rows()).toEqual([]);
  });

  it('lists a connection whose start failed and drops it when it connects: a disconnected one is a normal state and never a problem (S94)', () => {
    const window = mount();
    window.store.set(state([
      { plugin: 'alpha', key: 'c-1', name: 'north', state: 'unreachable', reason: 'The server did not answer.' },
      { plugin: 'alpha', key: 'c-2', name: 'south', state: 'disconnected', reason: undefined },
    ]));
    expect(window.rows().map((row) => [row.label, row.target, row.subject])).toEqual([['Not responding', 'north', { kind: 'connection', plugin: 'alpha', connection: 'c-1' }]]);
    window.store.set(state([{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'connected', reason: undefined }]));
    expect(window.rows()).toEqual([]);
  });

  it('lists a plugin\'s alert while it fires and drops it when it resolves; one the host lost track of is Not confirmed', () => {
    const window = mount();
    window.control.push([alert('a-1', 'firing')]);
    expect(window.rows().map((row) => [row.label, row.severity, row.source.name])).toEqual([['Alert a-1', 'warning', 'Alpha Cloud']]);
    window.control.push([alert('a-1', 'unknown')]);
    expect(window.rows().map((row) => row.label)).toEqual(['Not confirmed']);
    window.control.push([alert('a-1', 'resolved')]);
    expect(window.rows()).toEqual([]);
  });

  it('keeps the producers apart: one producer\'s change never takes another producer\'s rows away', () => {
    const window = mount([failed('alpha', 'Alpha Cloud')]);
    window.control.push([alert('a-1', 'firing')]);
    window.store.set(state([{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'failed', reason: undefined }]));
    expect(window.rows()).toHaveLength(3);
    window.control.push([]);
    expect(window.rows().map((row) => row.key.split(':')[0]).sort()).toEqual(['connection', 'plugin']);
    window.plugins.set([ready('alpha', 'Alpha Cloud')]);
    expect(window.rows().map((row) => row.key.split(':')[0])).toEqual(['connection']);
  });

  it('says a plugin\'s new name in every row that names it, with no change of the producers\' own data', () => {
    const window = mount([{ id: 'alpha', name: 'alpha', phase: 'loading' }]);
    window.control.push([alert('a-1', 'firing')]);
    expect(window.rows()[0]?.source.name).toBe('alpha');
    window.plugins.set([ready('alpha', 'Alpha Cloud')]);
    expect(window.rows()[0]?.source.name).toBe('Alpha Cloud');
  });

  it('is not woken by a task\'s progress: the records that are not alerts leave the model as it was', () => {
    const window = mount();
    window.control.push([task('t-1')]);
    window.control.push([task('t-1', { presentation: { title: 'Task t-1', progress: { kind: 'units', current: '2', total: '4', unit: 'items' } } })]);
    expect(window.heard).not.toHaveBeenCalled();
  });

  it('is told once for a change of the plugins, however many of its producers read them', () => {
    const window = mount();
    window.plugins.set([failed('alpha', 'Alpha Cloud')]);
    expect(window.heard).toHaveBeenCalledTimes(1);
  });
});

describe('Problems: an activity service that cannot be observed', () => {
  // The alerts of the plugins and the tasks come from the activity service, which the window observes through the runtime's provider. A read that failed holds no record, as a read of no activity does not, so the feed carries
  // the provider's sentence, and Problems says that nothing is known with one condition of the host for as long as the sentence is there. The producer states the fact (S74): the condition goes the moment the feed has no error.
  const SENTENCE = 'The activity service did not answer.';

  it('lists one warning of the host while the feed has an error, with the sentence, no target and no page, and takes it away when the feed has none', () => {
    const window = mount();
    window.control.push([], SENTENCE);
    expect(window.rows()).toEqual([
      { key: 'activity:unavailable', severity: 'warning', label: 'Activity isn\'t available', title: SENTENCE, source: { id: HOST_SOURCE, name: HOST_NAME }, target: undefined, subject: undefined },
    ]);
    window.control.push([]);
    expect(window.rows()).toEqual([]);
  });

  it('is one row however often the feed says it (the tasks it holds beside it change nothing here), and the same row for another sentence: the key does not move', () => {
    const window = mount();
    window.control.push([], SENTENCE);
    const [row] = window.rows();
    window.control.push([task('t-1')], SENTENCE);
    window.control.push([task('t-1'), task('t-2')], SENTENCE);
    expect(window.rows()).toHaveLength(1);
    expect(window.rows()[0]).toBe(row);
    expect(window.heard).toHaveBeenCalledTimes(1);

    window.control.push([], 'The activity service closed the connection.');
    expect(window.rows().map((candidate) => [candidate.key, candidate.title])).toEqual([[row?.key, 'The activity service closed the connection.']]);
    expect(window.heard).toHaveBeenCalledTimes(2);
  });

  it('keeps the alerts the feed holds beside it, and an error that clears takes only its own row away', () => {
    const window = mount();
    window.control.push([alert('a-1', 'firing')], SENTENCE);
    expect(window.rows().map((row) => row.key).sort()).toEqual(['activity:unavailable', 'alert:a-1']);
    window.control.push([alert('a-1', 'firing')]);
    expect(window.rows().map((row) => row.key)).toEqual(['alert:a-1']);
  });

  it('is on the tool from the first frame when the feed already had the error when the window attached', () => {
    const window = mount(undefined, undefined, SENTENCE);
    expect(window.rows().map((row) => row.label)).toEqual(['Activity isn\'t available']);
  });
});

describe('Operations: the tasks of the activity service', () => {
  it('lists the tasks the feed holds, with the plugin\'s name and the connection\'s, and follows each tick of a task', () => {
    const window = mount([ready('alpha', 'Alpha Cloud')], [{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'connected', reason: undefined }]);
    window.control.push([task('t-1', { source: { pluginID: 'alpha', connectionID: 'c-1' } })]);
    expect(window.ops().map((row) => [row.title, row.source.name, row.target, row.progress?.text])).toEqual([['Task t-1', 'Alpha Cloud', 'north', '1 of 4 items']]);
    window.control.push([task('t-1', { source: { pluginID: 'alpha', connectionID: 'c-1' }, presentation: { title: 'Task t-1', progress: { kind: 'units', current: '3', total: '4', unit: 'items' } } })]);
    expect(window.ops()[0]?.progress?.text).toBe('3 of 4 items');
  });

  it('says a name that changed: a plugin that finished loading, a connection that is now known', () => {
    const window = mount([{ id: 'alpha', name: 'alpha', phase: 'loading' }]);
    window.control.push([task('t-1', { source: { pluginID: 'alpha', connectionID: 'c-1' } })]);
    expect(window.ops()[0]).toMatchObject({ source: { name: 'alpha' }, target: undefined });
    window.plugins.set([ready('alpha', 'Alpha Cloud')]);
    expect(window.ops()[0]?.source.name).toBe('Alpha Cloud');
    window.store.set(state([{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'connected', reason: undefined }]));
    expect(window.ops()[0]?.target).toBe('north');
  });
});

describe('the badges of the tool tabs', () => {
  it('are the models\' own: the count of errors on Problems, a dot for an unread failure on Operations, nothing for a tool that has none', () => {
    const window = mount();
    const badges = badgesOf(window.problems, window.operations);
    expect(badges.of(PROBLEMS_TOOL_ID)).toBeUndefined();
    window.plugins.set([failed('alpha', 'Alpha Cloud')]);
    expect(badges.of(PROBLEMS_TOOL_ID)).toEqual({ kind: 'count', count: 1, label: '1 error' });
    window.control.push([task('t-1', { task: { state: 'failed', cancellation: 'unsupported' } })]);
    expect(badges.of(OPERATIONS_TOOL_ID)).toEqual({ kind: 'dot', tone: 'error', label: '1 unread failure' });
    expect(badges.of('terminal')).toBeUndefined();
  });

  it('are the same object while they say the same, so a tab that is not concerned does not render', () => {
    const window = mount([failed('alpha', 'Alpha Cloud')]);
    const badges = badgesOf(window.problems, window.operations);
    const before = badges.of(PROBLEMS_TOOL_ID);
    window.control.push([task('t-1')]);
    expect(badges.of(PROBLEMS_TOOL_ID)).toBe(before);
  });

  it('tell the strip when either model changes, and let go of both when the strip does', () => {
    const window = mount();
    const badges = badgesOf(window.problems, window.operations);
    const heard = vi.fn();
    const stop = badges.subscribe(heard);
    window.plugins.set([failed('alpha', 'Alpha Cloud')]);
    window.control.push([task('t-1')]);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    window.control.push([]);
    window.plugins.set([ready('alpha', 'Alpha Cloud')]);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('letting go', () => {
  it('follows nothing once the window stops: no producer is listened to and no row changes', () => {
    const window = mount();
    expect(window.plugins.listeners()).toBe(1);
    expect(window.store.listeners()).toBe(1);
    window.stop();
    expect(window.plugins.listeners()).toBe(0);
    expect(window.store.listeners()).toBe(0);
    window.plugins.set([failed('alpha', 'Alpha Cloud')]);
    window.control.push([alert('a-1', 'firing'), task('t-1')]);
    expect(window.rows()).toEqual([]);
    expect(window.ops()).toEqual([]);
  });

  it('reads every producer once at the start: what was true before the window attached is on the tools from the first frame', () => {
    const window = mount([failed('alpha', 'Alpha Cloud')], [{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'forbidden', reason: undefined }]);
    expect(window.rows().map((row) => row.label)).toEqual(['Stopped', 'Access denied']);
  });

  it('does not follow the feed\'s error once the window stops', () => {
    const window = mount();
    window.stop();
    window.control.push([], 'The activity service did not answer.');
    expect(window.rows()).toEqual([]);
  });
});

describe('a cancel the host did not do', () => {
  const POISON = 'cancel: exec /Users/me/.omniview/plugins/alpha/bin/alpha: token=abcdef0123456789abcdef0123456789';

  /** The host is told that a cancel failed, while the task is still `running` or after it finished: what the window then holds of the notices. */
  function told(running: boolean) {
    const { store } = makeNotices();
    const retry = vi.fn();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cancelFailed(store, { id: 't-1', title: 'Reindexing the catalogue', plugin: 'alpha', error: new Error(POISON), running, retry });
    quiet.mockRestore();
    return { store, retry, record: store.getSnapshot().recent[0] };
  }

  it('is a sticky error of the host that says the work is still running while it is, with a Retry that asks again, and not a word of the error', () => {
    const { store, record } = told(true);
    expect(record).toMatchObject({ severity: 'error', title: 'Couldn\'t cancel Reindexing the catalogue', text: 'The work is still running.' });
    expect(record?.actions.map((action) => action.label)).toEqual(['Retry']);
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/Users|token|exec/);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    expect(store.getSnapshot().toasts.items[0]?.sticky).toBe(true);
  });

  it('says the work had already finished once it had, with no Retry (it would ask for nothing: the row is no longer cancellable), and not a word of the error', () => {
    const { store, record } = told(false);
    expect(record).toMatchObject({ severity: 'error', title: 'Couldn\'t cancel Reindexing the catalogue', text: 'The work had already finished.' });
    expect(JSON.stringify(record)).not.toContain('still running');
    expect(record?.actions).toEqual([]);
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/Users|token|exec/);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
  });
});

describe('choosing a row', () => {
  const home = { plugin: 'alpha', contribution: 'items', params: {} };
  const NORTH: ConnectionsState['connections'] = [{ plugin: 'alpha', key: 'c-1', name: 'north', state: 'unreachable', reason: undefined }];

  /** The opener over a window that knows `plugins` and the connections `known`, with the notices that what could not be opened is told to, and the words the host has for a route it cannot serve (`availability`). */
  const over = (connections: SubjectOpenerDeps['connections'], plugins: readonly PluginEntry[] = [ready('alpha', 'Alpha Cloud')], known = NORTH, availability?: SubjectOpenerDeps['contributions']['availability']) => {
    const open = vi.fn();
    const { store } = makeNotices();
    const resolve = resolverOf(source(plugins), source(state(known)));
    const opener = subjectOpener({ tabs: { open }, contributions: { home: (plugin) => (plugin === 'alpha' ? home : undefined), availability }, connections, notices: store, resolve, platform: 'mac' }, 'problems');
    return { open, opener, store };
  };

  const make = (connections = true, answer: ActionResult = { ok: true }) => {
    const go = vi.fn(async () => answer);
    return { go, ...over(connections ? { actions: { go } } : undefined) };
  };

  /** Lets the answer of a choice that is on its way arrive: the opener does not wait for it, and nothing it does afterwards is a timer. */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  };

  it('opens a plugin at its own first page, in the tab the open model decides, and says the tool it came from', () => {
    const { open, opener } = make();
    opener({ kind: 'plugin', plugin: 'alpha' }, undefined);
    expect(open).toHaveBeenCalledWith({ route: home }, { how: 'smart', source: 'problems' });
  });

  it('lets the keys of the click pick the disposition: Command is a background tab on a Mac', () => {
    const { open, opener } = make();
    opener({ kind: 'plugin', plugin: 'alpha' }, { metaKey: true, type: 'click' });
    expect(open).toHaveBeenCalledWith({ route: home }, { how: 'background', source: 'problems' });
  });

  it('opens nothing for a plugin the window has no home for', () => {
    const { open, opener } = make();
    opener({ kind: 'plugin', plugin: 'gamma' }, undefined);
    expect(open).not.toHaveBeenCalled();
  });

  it('chooses a connection the way Home does: the host starts it, then it opens', () => {
    const { go, open, opener } = make();
    opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, { altKey: true, type: 'click' });
    expect(go).toHaveBeenCalledWith('alpha', 'c-1', { how: 'here', source: 'problems' });
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing for a connection when the window has no connection data', () => {
    const { open, opener } = make(false);
    opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
    expect(open).not.toHaveBeenCalled();
  });

  describe('a connection that cannot be opened', () => {
    // `go` answers `{ ok: false, reason }` for each way a choice ends without a page, and the `reason` is a sentence made for the person: the notice says it as it is, and names what the button named (`Open north`).
    const REFUSALS: ReadonlyArray<readonly [string, string]> = [
      ['the connection did not start', 'The server did not answer.'],
      ['the plugin is not available any more', 'This plugin is not available.'],
      ['the open model refused the page', 'This plugin is not installed, or is turned off.'],
      ['the tab it would replace has unsaved changes', 'This tab has unsaved changes.'],
    ];

    it.each(REFUSALS)('says why when %s: an error that names the connection, with the sentence it was given, sticky as every error is, and no Retry', async (_what, reason) => {
      const { go, open, opener, store } = make(true, { ok: false, reason });
      opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      await settle();
      const { recent, toasts } = store.getSnapshot();
      expect(go).toHaveBeenCalledTimes(1);
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ severity: 'error', title: 'Couldn\'t open north', text: reason });
      expect(recent[0]?.actions).toEqual([]);
      expect(toasts.items.map((item) => item.sticky)).toEqual([true]);
      expect(open).not.toHaveBeenCalled();
    });

    it('says nothing when the connection opened: there is nothing to tell', async () => {
      const { opener, store } = make(true, { ok: true });
      opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      await settle();
      expect(store.getSnapshot().recent).toEqual([]);
    });

    it('names the plugin when the window no longer knows the connection, and the plugin\'s id when it does not know that either: a key is never drawn', async () => {
      const refused: ActionResult = { ok: false, reason: 'This plugin is not available.' };
      const gone = over({ actions: { go: async () => refused } }, [ready('alpha', 'Alpha Cloud')], []);
      gone.opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      const unknown = over({ actions: { go: async () => refused } }, [], []);
      unknown.opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      await settle();
      expect(gone.store.getSnapshot().recent.map((record) => record.title)).toEqual(['Couldn\'t open Alpha Cloud']);
      expect(unknown.store.getSnapshot().recent.map((record) => record.title)).toEqual(['Couldn\'t open alpha']);
    });

    it('tells each choice that is refused: a second try that fails is told again, never met with silence', async () => {
      const { opener, store } = make(true, { ok: false, reason: 'The server did not answer.' });
      opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      await settle();
      expect(store.getSnapshot().recent.reduce((count, record) => count + record.count, 0)).toBe(2);
    });
  });

  describe('a plugin that cannot be opened', () => {
    // The window holds no page of a plugin that is not in its store: it was uninstalled or turned off while a record of it remained (an alert, a task of its history), and its row kept its button. The host says why in its own words,
    // the ones an open of that plugin is refused with (`availability`). They are asked of the host and written nowhere in the opener, so the host of these tests says words of its own.
    type Ask = NonNullable<SubjectOpenerDeps['contributions']['availability']>;
    const HOST_SAYS = 'The host\'s own words about a plugin it does not have.';
    const unavailable: Ask = () => ({ state: 'unavailable', reason: HOST_SAYS });

    it('says why: an error that names the plugin, with what the host says of it, sticky as every error is, and no Retry; nothing opens', () => {
      const asked = vi.fn<Ask>(unavailable);
      const { open, opener, store } = over(undefined, undefined, undefined, asked);
      opener({ kind: 'plugin', plugin: 'gamma' }, undefined);
      const { recent, toasts } = store.getSnapshot();
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0]?.[0]).toMatchObject({ plugin: 'gamma' });
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ severity: 'error', title: 'Couldn\'t open gamma', text: HOST_SAYS });
      expect(recent[0]?.actions).toEqual([]);
      expect(toasts.items.map((item) => item.sticky)).toEqual([true]);
      expect(open).not.toHaveBeenCalled();
    });

    it('opens the page and asks the host nothing when the window has one: the plugin is there, and there is nothing to tell', () => {
      const asked = vi.fn<Ask>(unavailable);
      const { open, opener, store } = over(undefined, undefined, undefined, asked);
      opener({ kind: 'plugin', plugin: 'alpha' }, undefined);
      expect(open).toHaveBeenCalledTimes(1);
      expect(asked).not.toHaveBeenCalled();
      expect(store.getSnapshot().recent).toEqual([]);
    });

    it('says the headline alone when the host has no words for it: the row is still never answered with silence', () => {
      const { open, opener, store } = over(undefined, undefined, undefined, () => ({ state: 'available' }));
      opener({ kind: 'plugin', plugin: 'gamma' }, undefined);
      expect(store.getSnapshot().recent.map((record) => [record.title, record.text])).toEqual([['Couldn\'t open gamma', '']]);
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('over the connection actions the window has', () => {
    // The sentences are the ones `createConnectionActions` makes (HM1), reached through its own `go`. A connection that the store lists as connected (the cache) while its plugin has stopped is the case with no page to go to:
    // the host knew the name, so the row kept its button, and the plugin is not ready any more.
    const refusedPage: unknown = { status: 'refused', reason: 'unavailable', message: 'This plugin is not installed, or is turned off.' };
    const CASES: ReadonlyArray<readonly [string, PluginEntry, ConnectOutcome, unknown, string | undefined]> = [
      ['the plugin stopped while the connection was cached as connected', failed('alpha', 'Alpha Cloud'), { status: 'connected' }, { status: 'done', id: 't1' }, 'This plugin is not available.'],
      ['the connection did not start', ready('alpha', 'Alpha Cloud'), { status: 'failed', state: 'unreachable', reason: 'The server did not answer.' }, { status: 'done', id: 't1' }, 'The server did not answer.'],
      ['the open model refused the page', ready('alpha', 'Alpha Cloud'), { status: 'connected' }, refusedPage, 'This plugin is not installed, or is turned off.'],
      ['the tab it would replace has unsaved changes', ready('alpha', 'Alpha Cloud'), { status: 'connected' }, { status: 'confirm', action: 'navigate', tabs: ['t1'] }, 'This tab has unsaved changes.'],
      ['the page opened', ready('alpha', 'Alpha Cloud'), { status: 'connected' }, { status: 'done', id: 't1' }, undefined],
    ];

    it.each(CASES)('when %s, the notice says what `go` said, and nothing when it opened', async (_what, plugin, outcome, opened, sentence) => {
      const connect = vi.fn(async () => outcome);
      const tabs = { getSnapshot: () => ({ active: null, tabs: {} }), navigate: vi.fn(), open: vi.fn(() => opened) } as unknown as TabsStore;
      const actions = createConnectionActions({ tabs, plugins: source([plugin]), connections: { connect } as unknown as ConnectionsStore });
      const { opener, store } = over({ actions }, [plugin]);
      opener({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, undefined);
      await settle();
      expect(store.getSnapshot().recent.map((record) => [record.title, record.text])).toEqual(sentence === undefined ? [] : [['Couldn\'t open north', sentence]]);
    });
  });
});
