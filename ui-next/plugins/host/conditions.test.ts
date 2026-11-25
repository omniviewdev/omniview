import type { AppError } from '@omniviewdev/runtime/ui/v1';
import { describe, expect, it } from 'vitest';
import type { ActivityRecordLike, ActivitySeverity, SourceResolver } from '../../shell/panel/activity';
import type { ContributionV1 } from '../contract/v1';
import { incompatibleFailure, unloadedFailure, type LoadFailure } from '../loader/failure';
import { activityConditions, alertConditions, connectionConditions, pluginConditions } from './conditions';
import { createConnectionsStore, type ConnectionsApi, type ConnectionsState, type ConnectionState, type HostConnection } from './connections';
import type { PluginEntry } from './pluginStore';

// The three producers of the Problems tool that exist today, as the conditions they state (ch16 S74, S94, S121; docs/ui-next/status/PT1.md, section 3): the plugins the window could not keep running, the connections
// that failed, and the alerts a plugin reports. The producer states the fact and the adapter only words it: a plugin that is starting again is not a problem, a connection that is not connected is not one either
// (disconnected is a normal state, S94), and an alert whose plugin stopped reporting is not hidden but is not claimed to be true. Invented names throughout: the host knows no plugin.

const contribution: ContributionV1 = { plugin: { name: 'Alpha Cloud' }, sidebar: { label: 'Alpha Cloud', title: 'Alpha Cloud', nodes: [] }, pages: {}, home: 'items' };

const failed = (id: string, name: string, failure: LoadFailure): PluginEntry => ({ id, name, phase: 'failed', failure });
const loading = (id: string, name: string): PluginEntry => ({ id, name, phase: 'loading' });
const ready = (id: string, name: string): PluginEntry => ({ id, name, phase: 'ready', contribution });

describe('pluginConditions: the plugins that could not be kept running', () => {
  const INCOMPATIBLE = incompatibleFailure({ pluginProtocol: 3, accepted: { oldest: 1, newest: 2 } });
  const CASES: ReadonlyArray<readonly [string, LoadFailure, string]> = [
    ['its process stopped', unloadedFailure('crashed'), 'Stopped'],
    ['it did not start', unloadedFailure('failed'), 'Did not start'],
    ['it took too long to start', unloadedFailure('timeout'), 'Timed out'],
    ['the host refused it for its protocol', INCOMPATIBLE, 'Update required'],
    ['its interface could not be read', { kind: 'missing', message: 'The plugin\'s interface could not be read.' }, 'Did not load'],
    ['its interface failed to start', { kind: 'broken', message: 'The plugin\'s interface failed to start.' }, 'Did not load'],
    ['its interface took too long to load', { kind: 'timeout', message: 'The plugin took too long to load.' }, 'Did not load'],
    ['its interface was built for another version', { kind: 'incompatible', message: 'This plugin was built for another version of the app. Update it.' }, 'Did not load'],
    ['its interface is not one this version understands', { kind: 'contract', message: 'This plugin does not describe its pages in a way this version understands.' }, 'Did not load'],
  ];

  it.each(CASES)('is an error when %s, worded as the plugin list words it (%s)', (_what, failure, caption) => {
    expect(pluginConditions([failed('alpha', 'Alpha Cloud', failure)])).toEqual([
      {
        key: 'plugin:alpha',
        severity: 'error',
        label: caption,
        title: `Alpha Cloud: ${failure.message}`,
        source: { id: 'alpha', name: 'Alpha Cloud' },
        target: 'Alpha Cloud',
        subject: { kind: 'plugin', plugin: 'alpha' },
      },
    ]);
  });

  // Each case that is NOT a problem is listed beside one that is (a control), so a list that says nothing at all cannot pass for the rule, and an adapter that counts the case fails by listing it.
  it('is not a problem while the plugin is starting again: the host is bringing it back, and nothing has failed', () => {
    const conditions = pluginConditions([failed('alpha', 'Alpha Cloud', unloadedFailure('reloaded')), failed('beta', 'Beta Cloud', unloadedFailure('crashed'))]);
    expect(conditions.map((condition) => condition.key)).toEqual(['plugin:beta']);
  });

  it('is not a problem while the plugin loads, nor when it is ready', () => {
    const conditions = pluginConditions([loading('alpha', 'Alpha Cloud'), ready('beta', 'Beta Cloud'), failed('gamma', 'Gamma Cloud', unloadedFailure('crashed'))]);
    expect(conditions.map((condition) => condition.key)).toEqual(['plugin:gamma']);
  });

  it('lists the faulted plugins of a window and no other, in the order the store lists them', () => {
    const conditions = pluginConditions([
      ready('a', 'A'),
      failed('b', 'B', unloadedFailure('crashed')),
      loading('c', 'C'),
      failed('d', 'D', unloadedFailure('reloaded')),
      failed('e', 'E', unloadedFailure('timeout')),
    ]);
    expect(conditions.map((condition) => condition.key)).toEqual(['plugin:b', 'plugin:e']);
    expect(conditions.map((condition) => condition.label)).toEqual(['Stopped', 'Timed out']);
  });

  it('says nothing when there is no plugin', () => {
    expect(pluginConditions([])).toEqual([]);
  });

  it('names the plugin by what the store calls it, its id staying the id of its page', () => {
    const [condition] = pluginConditions([failed('acme-1', 'Acme Plugin', unloadedFailure('crashed'))]);
    expect(condition?.source).toEqual({ id: 'acme-1', name: 'Acme Plugin' });
    expect(condition?.subject).toEqual({ kind: 'plugin', plugin: 'acme-1' });
    expect(condition?.title).toBe('Acme Plugin: The plugin process stopped unexpectedly, so its pages can\'t load data.');
  });
});

describe('connectionConditions: the connections that failed', () => {
  const connection = (key: string, state: ConnectionState, over: Partial<HostConnection> = {}): HostConnection => ({ plugin: 'alpha', key, name: `Connection ${key}`, state, reason: undefined, ...over });
  const stateOf = (...connections: HostConnection[]): ConnectionsState => ({ loaded: true, failed: false, connections });
  const nameOf = (id: string): string => (id === 'alpha' ? 'Alpha Cloud' : id);

  const CASES: ReadonlyArray<readonly [ConnectionState, string, 'error' | 'warning']> = [
    ['unreachable', 'Not responding', 'error'],
    ['failed', 'Connection failed', 'error'],
    ['forbidden', 'Access denied', 'error'],
    ['unauthorized', 'Needs sign-in', 'warning'],
  ];

  it.each(CASES)('is a condition when a connection is %s: the word %s, severity %s', (state, word, severity) => {
    const [condition] = connectionConditions(stateOf(connection('c-1', state, { name: 'north', reason: 'The server did not answer.' })), nameOf);
    expect(condition).toEqual({
      key: `connection:${JSON.stringify(['alpha', 'c-1'])}`,
      severity,
      label: word,
      title: 'north: The server did not answer.',
      source: { id: 'alpha', name: 'Alpha Cloud' },
      target: 'north',
      subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' },
    });
  });

  it('says the word of the state in its title when the host gave no reason: "north: Not responding"', () => {
    const [condition] = connectionConditions(stateOf(connection('c-1', 'unreachable', { name: 'north' })), nameOf);
    expect(condition?.title).toBe('north: Not responding');
  });

  it('is not a problem when a connection is connected, being connected or not connected: disconnected is a normal idle state (S94)', () => {
    const conditions = connectionConditions(stateOf(connection('c-1', 'connected'), connection('c-2', 'connecting'), connection('c-3', 'disconnected'), connection('c-4', 'failed')), nameOf);
    expect(conditions.map((condition) => condition.key)).toEqual([`connection:${JSON.stringify(['alpha', 'c-4'])}`]);
  });

  it('lists the failed connections and no other, of every plugin, in the order the store lists them', () => {
    const conditions = connectionConditions(
      stateOf(
        connection('c-1', 'connected'),
        connection('c-2', 'failed', { name: 'south' }),
        connection('c-3', 'disconnected'),
        connection('c-4', 'unauthorized', { plugin: 'beta', name: 'west' }),
      ),
      nameOf,
    );
    expect(conditions.map((condition) => [condition.source.name, condition.target, condition.label, condition.severity])).toEqual([
      ['Alpha Cloud', 'south', 'Connection failed', 'error'],
      ['beta', 'west', 'Needs sign-in', 'warning'],
    ]);
  });

  it('keys a connection by its plugin and its key as a pair, so two that would run together are two: "a" and "b:c" is not "a:b" and "c"', () => {
    const conditions = connectionConditions(stateOf(connection('b:c', 'failed', { plugin: 'a' }), connection('c', 'failed', { plugin: 'a:b' })), nameOf);
    expect(conditions).toHaveLength(2);
    expect(new Set(conditions.map((condition) => condition.key)).size).toBe(2);
    expect(conditions[0]?.key).toBe(`connection:${JSON.stringify(['a', 'b:c'])}`);
  });

  it('names the plugin as the caller reads it, and says nothing before the host was asked or when the read failed and left nothing', () => {
    expect(connectionConditions({ loaded: false, failed: false, connections: [] }, nameOf)).toEqual([]);
    expect(connectionConditions({ loaded: true, failed: true, connections: [] }, nameOf)).toEqual([]);
    const [condition] = connectionConditions({ loaded: true, failed: true, connections: [connection('c-1', 'failed')] }, nameOf);
    expect(condition?.source).toEqual({ id: 'alpha', name: 'Alpha Cloud' });
  });
});

// The row a connection that failed to start becomes when the host says so: the list the connection store reads (`readiness: FAILED` and the host's own `readinessError`, the producer's statement of the class and of its public
// line; the store keeps no memory of a failed start). The class is the row's word and severity, the host's sentence is in its title, and the row goes to the connection; a start this window made that failed is no different from
// a start another window made, because the list is what says it.
describe('connectionConditions over the connection store: what the host says of a connection that failed', () => {
  const envelope = (patch: Partial<AppError>): AppError => ({ type: 'omniview:internal', title: 'Operation failed', status: 500, detail: 'The operation could not be completed.', ...patch });
  const wails = (body: AppError): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });
  const UNAUTHORIZED = envelope({ type: 'omniview:resource/unauthorized', title: 'Authentication required', status: 401, detail: 'The provider requires authentication.', code: 'UNAUTHORIZED', recovery: 'none' });
  const FORBIDDEN = envelope({ type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The role may not connect.', code: 'FORBIDDEN', recovery: 'none' });
  const UNAVAILABLE = envelope({ type: 'omniview:connection/failed', title: 'Source unavailable', status: 503, detail: 'The source is unavailable.', code: 'UNAVAILABLE', recovery: 'reconnect' });
  const BROKEN = envelope({ detail: 'The plugin could not open it.' });
  const nameOf = (id: string): string => (id === 'alpha' ? 'Alpha Cloud' : id);

  /** What the host says (its error and the row it makes of it): a failure of each class, and one the host gave no error for. */
  const HOST_SAYS: ReadonlyArray<readonly [what: string, error: AppError | undefined, label: string, severity: 'error' | 'warning', sentence: string]> = [
    ['a sign-in is needed', UNAUTHORIZED, 'Needs sign-in', 'warning', 'The provider requires authentication.'],
    ['access is denied', FORBIDDEN, 'Access denied', 'error', 'The role may not connect.'],
    ['the server does not answer', UNAVAILABLE, 'Not responding', 'error', 'The source is unavailable.'],
    ['the start failed and the host did not classify it', BROKEN, 'Connection failed', 'error', 'The plugin could not open it.'],
    ['the start failed and the host gave no error', undefined, 'Connection failed', 'error', 'Connection failed'],
  ];

  const rowOf = (label: string, severity: 'error' | 'warning', sentence: string) => ({
    key: `connection:${JSON.stringify(['alpha', 'c-1'])}`,
    severity,
    label,
    title: `north: ${sentence}`,
    source: { id: 'alpha', name: 'Alpha Cloud' },
    target: 'north',
    subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' },
  });

  /** A host that says `north` is DISCONNECTED until a start was made, and FAILED with `error` after it, and answers every start with `rejection`. No event reaches the store: it reads when asked. */
  const hostThatFails = (error: AppError | undefined, rejection: Error): ConnectionsApi => {
    let isStarted = false;
    return {
      states: async () => ({ alpha: [{ connection: { id: 'c-1', name: 'north' }, readiness: isStarted ? 'FAILED' : 'DISCONNECTED', ...(isStarted && error !== undefined ? { readinessError: error } : {}) }] }),
      start: async () => {
        isStarted = true;
        throw rejection;
      },
      onStatus: () => () => undefined,
      onSync: () => () => undefined,
    };
  };

  it.each(HOST_SAYS)('is a row, with the class\'s words, the host\'s sentence and the connection, when the host says it failed because %s: no start of this window needed', async (_what, error, label, severity, sentence) => {
    const store = createConnectionsStore({
      states: async () => ({ alpha: [{ connection: { id: 'c-1', name: 'north' }, readiness: 'FAILED', ...(error === undefined ? {} : { readinessError: error }) }] }),
      start: async () => {
        throw new Error('this window starts nothing');
      },
      onStatus: () => () => undefined,
      onSync: () => () => undefined,
    });

    await store.refresh();

    expect(connectionConditions(store.getSnapshot(), nameOf)).toEqual([rowOf(label, severity, sentence)]);
  });

  it.each(HOST_SAYS)('is the same row after a start of this window that failed (a sign-in, it said): the host\'s words for %s, not the start\'s', async (_what, error, label, severity, sentence) => {
    const store = createConnectionsStore(hostThatFails(error, wails(UNAUTHORIZED)));
    await store.refresh();
    expect(connectionConditions(store.getSnapshot(), nameOf)).toEqual([]);

    await store.connect('alpha', 'c-1');

    expect(connectionConditions(store.getSnapshot(), nameOf)).toEqual([rowOf(label, severity, sentence)]);
  });

  it('is no row while the connection starts again, and none when the host lists it as disconnected after a start that failed: the row is true for as long as the host says so', async () => {
    let readiness = 'FAILED';
    const ended = Promise.withResolvers<void>();
    const store = createConnectionsStore({
      states: async () => ({ alpha: [{ connection: { id: 'c-1', name: 'north' }, readiness, ...(readiness === 'FAILED' ? { readinessError: UNAVAILABLE } : {}) }] }),
      start: async () => {
        await ended.promise;
        throw wails(UNAVAILABLE);
      },
      onStatus: () => () => undefined,
      onSync: () => () => undefined,
    });
    await store.refresh();
    expect(connectionConditions(store.getSnapshot(), nameOf)).toHaveLength(1);

    const outcome = store.connect('alpha', 'c-1');
    expect(connectionConditions(store.getSnapshot(), nameOf)).toEqual([]);

    readiness = 'DISCONNECTED';
    ended.resolve();
    await outcome;

    expect(connectionConditions(store.getSnapshot(), nameOf)).toEqual([]);
  });
});

describe('alertConditions: the alerts a plugin reports', () => {
  const resolver: SourceResolver = {
    plugin: (id) => (id === undefined || id === '' ? { id: 'host', name: 'Omniview' } : { id, name: id === 'alpha' ? 'Alpha Cloud' : id }),
    connection: (plugin, key) => (plugin === 'alpha' && key === 'c-1' ? 'north' : undefined),
  };

  const alert = (id: string, over: Partial<ActivityRecordLike> = {}, state: 'firing' | 'resolved' | 'unknown' = 'firing'): ActivityRecordLike => ({
    id,
    kind: 'alert',
    severity: 'error',
    createdAt: '2026-11-24T10:00:00Z',
    source: { pluginID: 'alpha', connectionID: 'c-1' },
    presentation: { title: 'Disk almost full', message: 'Free some space on the volume.' },
    alert: { key: `key-${id}`, state, occurrences: 1 },
    visibility: { read: false },
    ...over,
  });

  describe('a firing alert', () => {
    it('is a condition: the title is its label and the title and the message are its sentence', () => {
      expect(alertConditions([alert('r-1')], resolver)).toEqual([
        {
          key: 'alert:r-1',
          severity: 'error',
          label: 'Disk almost full',
          title: 'Disk almost full. Free some space on the volume.',
          source: { id: 'alpha', name: 'Alpha Cloud' },
          target: 'north',
          subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' },
        },
      ]);
    });

    const SEVERITIES: ReadonlyArray<readonly [ActivitySeverity, 'error' | 'warning' | 'info']> = [
      ['error', 'error'],
      ['warning', 'warning'],
      ['info', 'info'],
      ['success', 'info'],
    ];

    it.each(SEVERITIES)('takes the severity of its record: %s is %s', (given, wanted) => {
      expect(alertConditions([alert('r-1', { severity: given })], resolver)[0]?.severity).toBe(wanted);
    });

    it('has the title alone for a sentence when it has no message', () => {
      expect(alertConditions([alert('r-1', { presentation: { title: 'Disk almost full' } })], resolver)[0]?.title).toBe('Disk almost full');
      expect(alertConditions([alert('r-1', { presentation: { title: 'Disk almost full', message: '' } })], resolver)[0]?.title).toBe('Disk almost full');
    });
  });

  describe('an alert the host does not know to be true any more', () => {
    it('is shown as not confirmed, with a warning, whatever severity it had: its plugin stopped reporting, and the list does not hide what may still be true', () => {
      expect(alertConditions([alert('r-1', { severity: 'error' }, 'unknown')], resolver)).toEqual([
        {
          key: 'alert:r-1',
          severity: 'warning',
          label: 'Not confirmed',
          title: 'Disk almost full. Alpha Cloud is not reporting, so it is not known whether this is still true.',
          source: { id: 'alpha', name: 'Alpha Cloud' },
          target: 'north',
          subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' },
        },
      ]);
    });

    it('names the plugin by what the window calls it, not by its id', () => {
      const [condition] = alertConditions([alert('r-1', { source: { pluginID: 'beta' } }, 'unknown')], resolver);
      expect(condition?.title).toBe('Disk almost full. beta is not reporting, so it is not known whether this is still true.');
      expect(condition?.label).toBe('Not confirmed');
    });
  });

  describe('what is not a condition', () => {
    it('is an alert that resolved: it stopped being true, and a condition goes when it does', () => {
      expect(alertConditions([alert('r-1', {}, 'resolved'), alert('r-2')], resolver).map((condition) => condition.key)).toEqual(['alert:r-2']);
    });

    it('is a task or a message, whatever its severity and whatever else the record carries: the kind of the record decides', () => {
      const running = { state: 'running', cancellation: 'unsupported' } as const;
      const tasks = [alert('t-1', { kind: 'task', severity: 'error', alert: undefined, task: running }), alert('t-2', { kind: 'task', task: running }), alert('m-1', { kind: 'message', severity: 'warning' })];
      expect(alertConditions([...tasks, alert('r-1')], resolver).map((condition) => condition.key)).toEqual(['alert:r-1']);
    });

    it('is a record that says it is an alert and carries none: nothing says whether it is true', () => {
      expect(alertConditions([alert('r-1', { alert: undefined }), alert('r-2')], resolver).map((condition) => condition.key)).toEqual(['alert:r-2']);
    });

    it('says nothing when there is no record', () => {
      expect(alertConditions([], resolver)).toEqual([]);
    });
  });

  describe('where it is from and where it goes', () => {
    it('is about the connection when the window knows it, and goes to it', () => {
      const [condition] = alertConditions([alert('r-1')], resolver);
      expect(condition?.target).toBe('north');
      expect(condition?.subject).toEqual({ kind: 'connection', plugin: 'alpha', connection: 'c-1' });
    });

    it('is about nothing, and goes to its plugin, when the connection is one the window does not know', () => {
      const [condition] = alertConditions([alert('r-1', { source: { pluginID: 'alpha', connectionID: 'gone' } })], resolver);
      expect(condition?.target).toBeUndefined();
      expect(condition?.subject).toEqual({ kind: 'plugin', plugin: 'alpha' });
    });

    it('is about nothing, and goes to its plugin, when it names no connection', () => {
      const [condition] = alertConditions([alert('r-1', { source: { pluginID: 'alpha' } })], resolver);
      expect(condition?.target).toBeUndefined();
      expect(condition?.subject).toEqual({ kind: 'plugin', plugin: 'alpha' });
      expect(condition?.source).toEqual({ id: 'alpha', name: 'Alpha Cloud' });
    });

    it('is the host\'s own, with no page of its own, when it names no plugin', () => {
      const [condition] = alertConditions([alert('r-1', { source: {} })], resolver);
      expect(condition?.source).toEqual({ id: 'host', name: 'Omniview' });
      expect(condition?.target).toBeUndefined();
      expect(condition?.subject).toBeUndefined();
    });

    it('does not take a connection of another plugin for its own: the connection is looked up under the plugin the record names', () => {
      const [condition] = alertConditions([alert('r-1', { source: { pluginID: 'beta', connectionID: 'c-1' } })], resolver);
      expect(condition?.target).toBeUndefined();
      expect(condition?.subject).toEqual({ kind: 'plugin', plugin: 'beta' });
    });

    it('keys the condition by the record, so a record keeps its row while it fires and a new record is another row', () => {
      const conditions = alertConditions([alert('r-1'), alert('r-2')], resolver);
      expect(conditions.map((condition) => condition.key)).toEqual(['alert:r-1', 'alert:r-2']);
    });
  });
});

describe('activityConditions: an activity service that could not be observed', () => {
  // The alerts of the plugins come through the activity service. A read of it that failed holds no record, as a read of no activity does not, so the failure is a condition of its own, the host's: nothing is known of the alerts
  // and the tasks while it stands, and it goes the moment the feed says the service can be observed again.
  const SENTENCE = 'The activity service did not answer.';
  const resolver: SourceResolver = {
    plugin: (id) => (id === undefined || id === '' ? { id: 'host', name: 'Omniview' } : { id, name: id }),
    connection: () => undefined,
  };

  it('says nothing while the service can be observed', () => {
    expect(activityConditions(undefined, resolver)).toEqual([]);
  });

  it('is one warning when it cannot: the label says what is not available, the sentence is the title, and there is no target and no page to open', () => {
    expect(activityConditions(SENTENCE, resolver)).toEqual([
      { key: 'activity:unavailable', severity: 'warning', label: 'Activity isn\'t available', title: SENTENCE, source: { id: 'host', name: 'Omniview' }, target: undefined, subject: undefined },
    ]);
  });

  it('is the host\'s own source as the resolver says it, as an alert that names no plugin is: the adapter names no host of its own', () => {
    const named: SourceResolver = { ...resolver, plugin: () => ({ id: 'the-host', name: 'The Host' }) };
    expect(activityConditions(SENTENCE, named)[0]?.source).toEqual({ id: 'the-host', name: 'The Host' });
  });

  it('keeps its key whatever the sentence is, so the row is the same row while the failure is told in other words', () => {
    expect(activityConditions('The first sentence.', resolver)[0]?.key).toBe(activityConditions('The second sentence.', resolver)[0]?.key);
  });

  it('words the sentence as a connection\'s reason is worded: without the space around it, and as the label alone when there is none', () => {
    expect(activityConditions(`  ${SENTENCE}\n`, resolver)[0]?.title).toBe(SENTENCE);
    expect(activityConditions('', resolver)[0]?.title).toBe('Activity isn\'t available');
    expect(activityConditions('  \n ', resolver)[0]?.title).toBe('Activity isn\'t available');
  });
});
