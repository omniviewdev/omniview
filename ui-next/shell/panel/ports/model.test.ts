import { describe, expect, it } from 'vitest';
import { availabilityOf, browserUrlOf, copyWordOf, PLUGIN_STOPPED, readForward, rowOf, sameRow, STATE_WORDS, type Facts, type Forward, type PortRow } from './model';

// A forward as the host states it, and the row the window draws of it: pure, so that every rule is read whole. What the host says is the session of the SDK (`id`, `connection`, `connection_type`, `protocol`, `local_port`,
// `remote_port`, `state`, `created_at`); what the window adds is its own and said as such: that Stop was pressed, that the plugin stopped, why a Stop could not end a forward, and the name the window knows for a connection.

/** A session as the runtime's binding hands it over: the producer's fields, and `encryption`, which a row never reads. */
const session = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'forward-1',
  created_at: '2026-11-24T10:00:00Z',
  updated_at: '2026-11-24T10:00:01Z',
  connection_type: 'RESOURCE',
  connection: { plugin_id: 'acme', connection_id: 'conn-7f3a', resource_id: 'web-1', resource_key: 'widgets' },
  protocol: 'TCP',
  state: 'ACTIVE',
  local_port: 8081,
  remote_port: 8080,
  labels: {},
  encryption: { enabled: true, algorithm: 'aes', key: 'do-not-draw-this' },
  ...patch,
});

const forward = (patch: Partial<Forward> = {}): Forward => ({
  id: 'forward-1',
  plugin: 'acme',
  connection: 'conn-7f3a',
  kind: 'resource',
  resource: 'web-1',
  local: 8081,
  remote: 8080,
  protocol: 'TCP',
  state: 'running',
  created: Date.parse('2026-11-24T10:00:00Z'),
  host: '',
  ...patch,
});

const NOTHING: Facts = { stopping: false, pluginStopped: false, failure: undefined, connectionName: undefined };
const facts = (patch: Partial<Facts> = {}): Facts => ({ ...NOTHING, ...patch });

describe('reading a forward the host states', () => {
  it('takes the target of a resource: its plugin, its connection by the plugin\'s own id, and the resource\'s id, which is what the row names', () => {
    expect(readForward(session())).toEqual(forward());
  });

  it('takes a static target by its address: that is what it is called, and it has no plugin and no connection', () => {
    const read = readForward(session({ connection_type: 'STATIC', connection: { address: 'db.internal:5432' } }));
    expect(read).toEqual(forward({ plugin: '', connection: '', kind: 'static', resource: 'db.internal:5432' }));
  });

  it.each([
    ['ACTIVE', 'running'],
    ['PAUSED', 'paused'],
    ['STOPPED', 'stopped'],
    ['FAILED', 'failed'],
  ])('reads the producer\'s state %s as %s', (word, state) => {
    expect(readForward(session({ state: word }))?.state).toBe(state);
  });

  it('reads a state it does not know as stopped, as the SDK itself does (a forward that is not said to run is not drawn as running)', () => {
    expect(readForward(session({ state: '' }))?.state).toBe('stopped');
    expect(readForward(session({ state: 'STARTING' }))?.state).toBe('stopped');
    expect(readForward(session({ state: undefined }))?.state).toBe('stopped');
  });

  it('keeps UDP and reads every other protocol as TCP, the protocol a forward starts with when none is named', () => {
    expect(readForward(session({ protocol: 'UDP' }))?.protocol).toBe('UDP');
    expect(readForward(session({ protocol: 'TCP' }))?.protocol).toBe('TCP');
    expect(readForward(session({ protocol: '' }))?.protocol).toBe('TCP');
    expect(readForward(session({ protocol: 'SCTP' }))?.protocol).toBe('TCP');
  });

  it('reads a port as a whole number from 1 to 65535 and any other value as 0: a local port that is not assigned yet is not a port', () => {
    expect(readForward(session({ local_port: 0 }))?.local).toBe(0);
    expect(readForward(session({ local_port: 65536 }))?.local).toBe(0);
    expect(readForward(session({ local_port: -4 }))?.local).toBe(0);
    expect(readForward(session({ local_port: 80.5 }))?.local).toBe(0);
    expect(readForward(session({ local_port: '8081' }))?.local).toBe(0);
    expect(readForward(session({ local_port: 65535 }))?.local).toBe(65535);
    expect(readForward(session({ remote_port: undefined }))?.remote).toBe(0);
  });

  it('is nothing for a value that is not a session: no forward is made up of a null, a number or an object with no id', () => {
    for (const value of [null, undefined, 4, 'forward-1', [], {}, { id: '' }, { id: '   ' }, { id: 7 }]) {
      expect(readForward(value)).toBeUndefined();
    }
  });

  it('reads the session whole when it is an instance of a class, as the binding makes it, and not a plain object: the members are the same', () => {
    class Bound {
      describe(): string {
        return 'a session of the binding';
      }
    }

    const bound = Object.assign(new Bound(), {
      id: 'forward-2',
      connection_type: 'RESOURCE',
      connection: { plugin_id: 'acme', connection_id: 'c', resource_id: 'db', resource_key: 'widgets' },
      protocol: 'TCP',
      state: 'PAUSED',
      local_port: 9000,
      remote_port: 5432,
      created_at: '2026-11-24T10:00:00Z',
    });
    expect(readForward(bound)).toMatchObject({ id: 'forward-2', resource: 'db', state: 'paused', local: 9000, remote: 5432 });
  });

  it('says a target with no name for its resource as an empty resource, and a target that is not an object as one with no plugin: nothing is guessed', () => {
    expect(readForward(session({ connection: { plugin_id: 'acme', connection_id: 'c' } }))?.resource).toBe('');
    expect(readForward(session({ connection: null }))).toMatchObject({ plugin: '', connection: '', resource: '', kind: 'resource' });
    expect(readForward(session({ connection: 'acme' }))).toMatchObject({ plugin: '', connection: '', resource: '' });
  });

  it('takes the creation time as a time, and reads one it cannot (or the Go zero time) as 0: it only orders the rows', () => {
    expect(readForward(session())?.created).toBe(Date.parse('2026-11-24T10:00:00Z'));
    expect(readForward(session({ created_at: 'not a time' }))?.created).toBe(0);
    expect(readForward(session({ created_at: '0001-01-01T00:00:00Z' }))?.created).toBe(0);
    expect(readForward(session({ created_at: undefined }))?.created).toBe(0);
  });

  it('reads nothing of the encryption the session carries: its key is a secret and no row, and nothing a row is made of, holds it', () => {
    const read = readForward(session());
    if (read === undefined) {
      throw new Error('a session is read');
    }

    expect(JSON.stringify(read)).not.toContain('do-not-draw-this');
    expect(JSON.stringify(rowOf(read, NOTHING))).not.toContain('do-not-draw-this');
  });
});

describe('the row the window draws of a forward', () => {
  it('has the producer\'s facts and the words of them: the mapping reads the port to the remote port with the protocol, and no host is stated', () => {
    expect(rowOf(forward(), facts({ connectionName: 'Staging' }))).toEqual({
      id: 'forward-1',
      session: 0,
      plugin: 'acme',
      connection: 'Staging',
      kind: 'resource',
      resource: 'web-1',
      local: 8081,
      remote: 8080,
      protocol: 'TCP',
      state: 'running',
      stateWord: 'Running',
      pluginStopped: false,
      reason: undefined,
      host: '',
      endpoint: '8081',
      mapping: 'port 8081 → :8080/TCP',
    });
  });

  it('says the protocol in the mapping', () => {
    expect(rowOf(forward({ protocol: 'UDP' }), NOTHING).mapping).toBe('port 8081 → :8080/UDP');
  });

  it.each([
    ['running', 'Running'],
    ['paused', 'Paused'],
    ['stopped', 'Stopped'],
    ['failed', 'Failed'],
  ] as const)('says the state %s as %s', (state, word) => {
    const row = rowOf(forward({ state }), NOTHING);
    expect(row.state).toBe(state);
    expect(row.stateWord).toBe(word);
    expect(STATE_WORDS[state]).toBe(word);
  });

  it('says Stopping from the moment Stop was pressed, whatever the forward was, and has no other reason to say it', () => {
    for (const state of ['running', 'paused', 'stopped', 'failed'] as const) {
      const row = rowOf(forward({ state }), facts({ stopping: true }));
      expect(row.state).toBe('stopping');
      expect(row.stateWord).toBe('Stopping');
    }

    expect(STATE_WORDS.stopping).toBe('Stopping');
  });

  it('never draws the connection\'s own id for a name: a connection the window has no name for is an empty name, which the table draws as a dash', () => {
    expect(rowOf(forward({ connection: 'conn-7f3a' }), NOTHING).connection).toBe('');
    expect(JSON.stringify(rowOf(forward({ connection: 'conn-7f3a' }), NOTHING))).not.toContain('conn-7f3a');
    expect(rowOf(forward({ connection: 'conn-7f3a' }), facts({ connectionName: '  ' })).connection).toBe('');
    expect(rowOf(forward({ connection: 'conn-7f3a' }), facts({ connectionName: ' Staging ' })).connection).toBe('Staging');
  });

  it('says a static target by its address, and a connection of no name: it has none', () => {
    const row = rowOf(forward({ kind: 'static', plugin: '', connection: '', resource: 'db.internal:5432' }), facts({ connectionName: 'Staging' }));
    expect(row).toMatchObject({ kind: 'static', resource: 'db.internal:5432', connection: '', plugin: '' });
  });

  describe('when the plugin stopped', () => {
    it.each(['running', 'paused', 'stopped'] as const)('is Stopped, with the two facts the window has in the second line, for a forward the host said was %s', (state) => {
      const row = rowOf(forward({ state }), facts({ pluginStopped: true }));
      expect(row.state).toBe('stopped');
      expect(row.stateWord).toBe('Stopped');
      expect(row.reason).toBe(PLUGIN_STOPPED);
      expect(row.pluginStopped).toBe(true);
      expect(PLUGIN_STOPPED).toBe('Its plugin stopped.');
    });

    it('is still Failed for a forward the host had said failed: the producer\'s word is the more exact, and no cause is made up for it', () => {
      const row = rowOf(forward({ state: 'failed' }), facts({ pluginStopped: true }));
      expect(row.state).toBe('failed');
      expect(row.reason).toBeUndefined();
      expect(row.pluginStopped).toBe(true);
    });

    it('is not Stopping any more: a stop that waits for a plugin that is gone will not end', () => {
      const row = rowOf(forward(), facts({ pluginStopped: true, stopping: true }));
      expect(row.state).toBe('stopped');
    });

    it('says that its plugin stopped, not why a Stop failed', () => {
      expect(rowOf(forward(), facts({ pluginStopped: true, failure: 'Could not stop it.' })).reason).toBe(PLUGIN_STOPPED);
    });
  });

  describe('when a Stop could not end it', () => {
    it('keeps the state it was in and says why in the second line', () => {
      const row = rowOf(forward(), facts({ failure: 'The host could not stop it.' }));
      expect(row.state).toBe('running');
      expect(row.reason).toBe('The host could not stop it.');
    });

    it('says nothing of the failure while the next Stop is on its way', () => {
      const row = rowOf(forward(), facts({ failure: 'The host could not stop it.', stopping: true }));
      expect(row.state).toBe('stopping');
      expect(row.reason).toBeUndefined();
    });
  });

  it('says an unassigned local port as Auto, and has no endpoint to give: there is nothing to copy or to open', () => {
    const row = rowOf(forward({ local: 0 }), NOTHING);
    expect(row.mapping).toBe('Auto → :8080/TCP');
    expect(row.endpoint).toBe('');
  });
});

describe('whether two rows say the same', () => {
  const base = rowOf(forward(), facts({ connectionName: 'Staging' }));

  it('is true for a row and its twin made again', () => {
    expect(sameRow(base, rowOf(forward(), facts({ connectionName: 'Staging' })))).toBe(true);
  });

  it.each<[string, Partial<PortRow>]>([
    ['id', { id: 'x' }],
    ['plugin', { plugin: 'x' }],
    ['connection', { connection: 'x' }],
    ['kind', { kind: 'static' }],
    ['resource', { resource: 'x' }],
    ['local', { local: 1 }],
    ['remote', { remote: 1 }],
    ['protocol', { protocol: 'UDP' }],
    ['state', { state: 'failed' }],
    ['stateWord', { stateWord: 'x' }],
    ['pluginStopped', { pluginStopped: true }],
    ['reason', { reason: 'x' }],
    ['host', { host: 'x' }],
    ['endpoint', { endpoint: 'x' }],
    ['mapping', { mapping: 'x' }],
  ])('is false when only the %s differs', (_name, patch) => {
    expect(sameRow(base, { ...base, ...patch })).toBe(false);
  });
});

describe('what a person can do with a row, and why not', () => {
  // A forward that states a loopback host: Open in browser is for it only (the producer's session states none today; `where a forward listens` below is what the row says without one).
  const row = (patch: Partial<Forward> = {}, over: Partial<Facts> = {}) => rowOf(forward({ host: '127.0.0.1', ...patch }), facts(over));

  it('can stop, open and copy a forward that runs over TCP and states a loopback host: nothing is in the way, and each says so by having no reason', () => {
    expect(availabilityOf(row())).toEqual({ stop: undefined, open: undefined, copy: undefined });
  });

  it('is not offered Open in browser for UDP, which a browser does not speak: not a control with a reason, none at all', () => {
    expect(availabilityOf(row({ protocol: 'UDP' }))).toEqual({ stop: undefined, open: null, copy: undefined });
  });

  it.each(['paused', 'stopped', 'failed'] as const)('can stop a forward that is %s, which removes it (the host closes the session), and can neither open nor copy it', (state) => {
    expect(availabilityOf(row({ state }))).toEqual({ stop: undefined, open: 'The forward must be running.', copy: 'The forward must be running.' });
  });

  it('can do nothing while a Stop is on its way, and says why for Stop: it waits', () => {
    expect(availabilityOf(row({}, { stopping: true }))).toEqual({ stop: 'Waiting for the stop to finish.', open: 'The forward must be running.', copy: 'The forward must be running.' });
  });

  it('cannot stop a forward whose plugin stopped, which is the only one that can end it, and says so with the words of the row', () => {
    expect(availabilityOf(row({}, { pluginStopped: true }))).toEqual({ stop: PLUGIN_STOPPED, open: 'The forward must be running.', copy: 'The forward must be running.' });
  });

  it('cannot open or copy a forward that has no local port yet, though it runs: there is no address', () => {
    expect(availabilityOf(row({ local: 0 }))).toEqual({ stop: undefined, open: 'The local port is not assigned yet.', copy: 'The local port is not assigned yet.' });
  });

  it('opens a forward in the browser at the loopback address and its local port, over http', () => {
    expect(browserUrlOf(row())).toBe('http://127.0.0.1:8081');
    expect(browserUrlOf(row({ local: 3000 }))).toBe('http://127.0.0.1:3000');
  });
});

describe('which session of an id a row shows', () => {
  it('is the window\'s own fact, and 0 when it is not given: the row says which session it is, and two rows of one id that say it differently are not the same row', () => {
    expect(rowOf(forward(), facts()).session).toBe(0);
    const first = rowOf(forward(), facts({ session: 1 }));
    expect(first.session).toBe(1);
    expect(sameRow(first, rowOf(forward(), facts({ session: 1 })))).toBe(true);
    expect(sameRow(first, rowOf(forward(), facts({ session: 2 })))).toBe(false);
  });
});

describe('where a forward listens', () => {
  it('is what the producer states, and the SDK\'s session states a port and no host: the row says the port, and never invents a host', () => {
    expect(readForward(session())?.host).toBe('');
    const row = rowOf(forward(), facts());
    expect(row.host).toBe('');
    expect(row.mapping).toBe('port 8081 → :8080/TCP');
    expect(row.endpoint).toBe('8081');
    expect(JSON.stringify(row)).not.toContain('127.0.0.1');
  });

  it('says Auto while the port is not assigned, with no endpoint', () => {
    const row = rowOf(forward({ local: 0 }), facts());
    expect(row.mapping).toBe('Auto → :8080/TCP');
    expect(row.endpoint).toBe('');
  });

  it('reads a host the producer states (`local_host`) as text, and nothing else as one', () => {
    expect(readForward(session({ local_host: ' 127.0.0.1 ' }))?.host).toBe('127.0.0.1');
    expect(readForward(session({ local_host: 7 }))?.host).toBe('');
    expect(readForward(session({ local_host: null }))?.host).toBe('');
  });

  it.each([
    ['127.0.0.1', '127.0.0.1:8081 → :8080/TCP', '127.0.0.1:8081', 'http://127.0.0.1:8081'],
    ['::1', '[::1]:8081 → :8080/TCP', '[::1]:8081', 'http://[::1]:8081'],
    ['localhost', 'localhost:8081 → :8080/TCP', 'localhost:8081', 'http://localhost:8081'],
    ['LOCALHOST', 'LOCALHOST:8081 → :8080/TCP', 'LOCALHOST:8081', 'http://LOCALHOST:8081'],
  ])('shows a loopback host the producer states, %s, in the mapping and as the endpoint, and opens at it', (host, mapping, endpoint, url) => {
    const row = rowOf(forward({ host }), facts());
    expect(row.mapping).toBe(mapping);
    expect(row.endpoint).toBe(endpoint);
    expect(availabilityOf(row).open).toBeUndefined();
    expect(browserUrlOf(row)).toBe(url);
  });

  it.each(['0.0.0.0', '192.168.1.5', 'forward.example.test', '::'])('shows a host beyond this computer, %s, as the endpoint and does not open it', (host) => {
    const row = rowOf(forward({ host }), facts());
    expect(row.endpoint).toBe(`${host.includes(':') ? `[${host}]` : host}:8081`);
    expect(row.mapping).toBe(`${row.endpoint} → :8080/TCP`);
    expect(availabilityOf(row).open).toBe('This forward listens beyond this computer, so it is not opened from here.');
  });

  it('does not offer to open a forward whose host is not stated, whatever its state: Open in browser is unavailable for it, with the reason', () => {
    for (const state of ['running', 'paused', 'stopped', 'failed'] as const) {
      expect(availabilityOf(rowOf(forward({ state }), facts())).open).toBe('Where this forward listens is not stated, so it cannot be opened from here.');
    }

    expect(availabilityOf(rowOf(forward({ protocol: 'UDP' }), facts())).open).toBeNull();
  });

  it('offers to open a forward that states a loopback host only while it runs and has a port', () => {
    expect(availabilityOf(rowOf(forward({ host: '127.0.0.1', state: 'failed' }), facts())).open).toBe('The forward must be running.');
    expect(availabilityOf(rowOf(forward({ host: '127.0.0.1', local: 0 }), facts())).open).toBe('The local port is not assigned yet.');
  });

  it('says what Copy copies: the port when no host is stated, and host and port when one is', () => {
    expect(copyWordOf(rowOf(forward(), facts()))).toBe('Copy port');
    expect(copyWordOf(rowOf(forward({ host: '127.0.0.1' }), facts()))).toBe('Copy address');
  });

  it('tells rows that differ in the host apart', () => {
    expect(sameRow(rowOf(forward(), facts()), rowOf(forward({ host: '127.0.0.1' }), facts()))).toBe(false);
  });
});
