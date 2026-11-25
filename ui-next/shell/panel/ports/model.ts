// A forward of a port as the Ports tool draws it. Pure: the wire in, the row out, and the rules of what a row can do. The host states a forward (the SDK's session: its target, its ports, its protocol, its state), and the window adds
// four facts of its own and says them as its own: that Stop was pressed and has not ended it (`Stopping`), that the plugin that holds the forward stopped (`Stopped`, with the second line "Its plugin stopped."), why the last Stop could not end it,
// and the name the window knows for the forward's connection. Nothing else is said: the mock's bytes, errors and latency are not stated by the producer (docs/ui-next/status/PF1.md, section 1.1), so no row has them.

/** The hosts a producer may state for where a forward listens that are this computer: a browser opened here reaches them. */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];

/** A host as it is written before a port: an IPv6 host is in brackets. */
const bracketed = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);

/** Whether a host the producer states is this computer. */
const isLoopback = (host: string): boolean => LOOPBACK_HOSTS.includes(host.replace(/^\[|\]$/g, '').toLowerCase());

export type PortProtocol = 'TCP' | 'UDP';

/** What the host says a forward is: `ACTIVE` is running, `PAUSED` paused, `STOPPED` an intentional end and `FAILED` an unexpected one. */
export type ForwardState = 'running' | 'paused' | 'stopped' | 'failed';

/** What the row says. `stopping` is the window's own, from the press of Stop until the host says the forward is closed. */
export type PortState = ForwardState | 'stopping';

/** A forward as the host states it: only what the row needs of the session, and nothing it does not (the session's `encryption` is never read, and its labels are not the row's business). */
export type Forward = {
  readonly id: string;
  /** The plugin that holds it: the id the host knows it by. Empty for a static target, which names none. */
  readonly plugin: string;
  /** The plugin's own id for the connection: how the window looks the connection's name up, and never drawn. Empty for a static target. */
  readonly connection: string;
  readonly kind: 'resource' | 'static';
  /** The resource's id; the address of a static target. Empty when the producer names none. */
  readonly resource: string;
  /** The port on this computer; 0 when it is not assigned. */
  readonly local: number;
  readonly remote: number;
  readonly protocol: PortProtocol;
  readonly state: ForwardState;
  /** When the host created it, epoch milliseconds; 0 when it does not say. Only orders the rows. */
  readonly created: number;
  /** Where the producer says the forward listens (the session's `local_host`); empty when it says nothing, which the SDK's session does today: it states a port and no host, and the tool shows what the producer states. */
  readonly host: string;
};

/** The facts the window adds to what the host states. */
export type Facts = {
  /** Stop was pressed and the host has not said the forward is closed. */
  readonly stopping: boolean;
  /** The host said that the plugin which holds the forward stopped, and has not said that it runs again. */
  readonly pluginStopped: boolean;
  /** Why the last Stop could not end it, in plain words; absent when there is nothing to say. */
  readonly failure: string | undefined;
  /** The name the window knows for the forward's connection. */
  readonly connectionName: string | undefined;
  /** Which session of its id the window holds (the store's own count): a button is drawn for one, and a press carries it. Absent: 0. */
  readonly session?: number | undefined;
};

export type PortRow = {
  readonly id: string;
  /** Which session of its id the row shows: a command carries it, so that a button drawn for one session never acts on another that took its id. */
  readonly session: number;
  readonly plugin: string;
  /** The connection's NAME. Never its id: a connection the window has no name for is empty, and the table draws a dash. Empty for a static target. */
  readonly connection: string;
  readonly kind: 'resource' | 'static';
  readonly resource: string;
  readonly local: number;
  readonly remote: number;
  readonly protocol: PortProtocol;
  readonly state: PortState;
  readonly stateWord: string;
  /** Whether the host said that the plugin which holds the forward stopped: the forward cannot be stopped from here until the plugin runs again. */
  readonly pluginStopped: boolean;
  /** The second line of the Resource cell: a fact the window states about this forward (its plugin stopped, a Stop could not end it). Absent when there is none. */
  readonly reason?: string | undefined;
  /** Where the producer says the forward listens; empty when it says nothing. Never a default. */
  readonly host: string;
  /** What names the forward's local end and what Copy puts on the clipboard: `<host>:<port>` when the producer states a host (an IPv6 host in brackets), else the port alone; empty while the port is not assigned. */
  readonly endpoint: string;
  /** `port <local> → :<remote>/<protocol>`, or `<host>:<local> → ...` when the producer states a host; `Auto` for a port not assigned yet. */
  readonly mapping: string;
};

export const STATE_WORDS: Readonly<Record<PortState, string>> = Object.freeze({ running: 'Running', paused: 'Paused', stopped: 'Stopped', failed: 'Failed', stopping: 'Stopping' });

/** The second line of a forward whose plugin stopped: two facts the window has (the plugin's stop was announced, and the forward is the plugin's), and no guess about what became of the tunnel. */
export const PLUGIN_STOPPED = 'Its plugin stopped.';
export const NOT_RUNNING = 'The forward must be running.';
export const NO_LOCAL_PORT = 'The local port is not assigned yet.';
export const STOP_WAITING = 'Waiting for the stop to finish.';
/** Why Open in browser is unavailable for a forward whose host the producer does not state (every forward, today): a browser is sent to an address, and the tool does not make one up. */
export const OPEN_HOST_UNSTATED = 'Where this forward listens is not stated, so it cannot be opened from here.';
/** Why it is unavailable for a forward that listens beyond this computer: a browser opened here is not sent to another machine. */
export const OPEN_BEYOND = 'This forward listens beyond this computer, so it is not opened from here.';

/** What a row's actions are called: the buttons, their tips and the menu's items say the same words. Copy is Copy port while the producer states no host, and Copy address when it does (an address would assert a host). */
export const ACTION_WORDS = Object.freeze({ stop: 'Stop', open: 'Open in browser', copyPort: 'Copy port', copyAddress: 'Copy address' });

/** What Copy is called for a row: it copies the port when the producer states no host, and host and port when it does. */
export const copyWordOf = (row: PortRow): string => (row.host === '' ? ACTION_WORDS.copyPort : ACTION_WORDS.copyAddress);

const member = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined);
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const portOf = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : 0);

const STATES: Readonly<Record<string, ForwardState>> = { ACTIVE: 'running', PAUSED: 'paused', STOPPED: 'stopped', FAILED: 'failed' };

/** The producer's state as the window knows it. A word it does not know is a forward that is not said to run: stopped, as the SDK reads an unknown state itself (`SessionState.ToProto`). */
const stateOf = (word: unknown): ForwardState => {
  const known = typeof word === 'string' && Object.hasOwn(STATES, word) ? STATES[word] : undefined;
  return known ?? 'stopped';
};

/** When the host created the forward. The Go zero time, and a time that is not one, are 0. */
const createdOf = (value: unknown): number => {
  const time = Date.parse(textOf(value));
  return Number.isFinite(time) && time > 0 ? time : 0;
};

/**
 * The forward a session states, or nothing for a value that is not a session (no id). A member the producer leaves out is empty or 0, never invented: the resource's own id is what a forward is called, and the connection is
 * kept by the plugin's id for it, which the window turns into a name and never draws. The session's encryption and labels are not read.
 */
export function readForward(raw: unknown): Forward | undefined {
  const id = textOf(member(raw, 'id'));
  if (id === '') {
    return undefined;
  }

  const target = member(raw, 'connection');
  const type = member(raw, 'connection_type');
  const address = textOf(member(target, 'address'));
  const isStatic = type === 'STATIC' || (type !== 'RESOURCE' && address !== '');
  return {
    id,
    plugin: isStatic ? '' : textOf(member(target, 'plugin_id')),
    connection: isStatic ? '' : textOf(member(target, 'connection_id')),
    kind: isStatic ? 'static' : 'resource',
    resource: isStatic ? address : textOf(member(target, 'resource_id')),
    local: portOf(member(raw, 'local_port')),
    remote: portOf(member(raw, 'remote_port')),
    protocol: member(raw, 'protocol') === 'UDP' ? 'UDP' : 'TCP',
    state: stateOf(member(raw, 'state')),
    created: createdOf(member(raw, 'created_at')),
    host: textOf(member(raw, 'local_host')),
  };
}

/** The row a forward is, with the facts the window adds. The producer's `failed` outranks the plugin's stop (it says more), and a stop that waits for a plugin that is gone is not waited for. */
export function rowOf(forward: Forward, facts: Facts): PortRow {
  const failed = forward.state === 'failed';
  const state: PortState = facts.pluginStopped ? (failed ? 'failed' : 'stopped') : facts.stopping ? 'stopping' : forward.state;
  const host = forward.host === '' ? '' : bracketed(forward.host);
  const endpoint = forward.local === 0 ? '' : host === '' ? String(forward.local) : `${host}:${String(forward.local)}`;
  const remote = forward.remote > 0 ? String(forward.remote) : '—';
  return {
    id: forward.id,
    session: facts.session ?? 0,
    plugin: forward.plugin,
    connection: forward.kind === 'static' ? '' : textOf(facts.connectionName),
    kind: forward.kind,
    resource: forward.resource,
    local: forward.local,
    remote: forward.remote,
    protocol: forward.protocol,
    state,
    stateWord: STATE_WORDS[state],
    pluginStopped: facts.pluginStopped,
    reason: facts.pluginStopped ? (failed ? undefined : PLUGIN_STOPPED) : facts.stopping ? undefined : facts.failure,
    host: forward.host,
    endpoint,
    mapping: `${forward.local === 0 ? 'Auto' : host === '' ? `port ${String(forward.local)}` : endpoint} → :${remote}/${forward.protocol}`,
  };
}

/** Whether two rows say the same, so that a row that did not change is the same object and the row that shows it does not render. */
export const sameRow = (a: PortRow, b: PortRow): boolean =>
  a.id === b.id &&
  a.session === b.session &&
  a.plugin === b.plugin &&
  a.connection === b.connection &&
  a.kind === b.kind &&
  a.resource === b.resource &&
  a.local === b.local &&
  a.remote === b.remote &&
  a.protocol === b.protocol &&
  a.state === b.state &&
  a.stateWord === b.stateWord &&
  a.pluginStopped === b.pluginStopped &&
  a.reason === b.reason &&
  a.host === b.host &&
  a.endpoint === b.endpoint &&
  a.mapping === b.mapping;

/**
 * What a person can do with a row: for each action, why it cannot be done now (a sentence, which the control says in its description and its tip), nothing when it can, and for Open in browser `null` when it is never
 * offered for the row (a browser speaks TCP only). Stop is open to every forward whose plugin runs, whatever state it is in: the host's close removes a session that has ended as it ends one that runs, and a forward that
 * ended on its own has no other way off the list. Copy needs a forward that runs and has a local port to name. Open needs that too, and a host the producer states that is this computer: where a forward listens is the producer's to
 * say, and the tool does not guess it (the SDK's session states none today, so Open is unavailable for every forward until it does).
 */
export type Availability = {
  readonly stop: string | undefined;
  readonly open: string | undefined | null;
  readonly copy: string | undefined;
};

export function availabilityOf(row: PortRow): Availability {
  const reach = row.state !== 'running' ? NOT_RUNNING : row.local === 0 ? NO_LOCAL_PORT : undefined;
  return {
    stop: row.pluginStopped ? PLUGIN_STOPPED : row.state === 'stopping' ? STOP_WAITING : undefined,
    open: row.protocol === 'UDP' ? null : row.host === '' ? OPEN_HOST_UNSTATED : isLoopback(row.host) ? reach : OPEN_BEYOND,
    copy: reach,
  };
}

/** Where Open in browser goes: the host the producer states and the port, over http. Asked only of a row that can be opened, which has a loopback host stated. */
export const browserUrlOf = (row: PortRow): string => `http://${bracketed(row.host)}:${String(row.local)}`;

/**
 * Whether two forwards are the same session of the host and not a later one that took its id: a plugin that restarts may hand an id out again, and what was said of the first (that its Stop is on its way, that it was closed) is not said of the
 * second. A session is told by its id, when it was created and what it forwards to; its state and its local port are what change over its life, and a creation time that one of them does not give is not held against it.
 */
export const sameSession = (a: Forward, b: Forward): boolean =>
  a.id === b.id &&
  (a.created === b.created || a.created === 0 || b.created === 0) &&
  a.plugin === b.plugin &&
  a.connection === b.connection &&
  a.kind === b.kind &&
  a.resource === b.resource &&
  a.remote === b.remote &&
  a.protocol === b.protocol;
