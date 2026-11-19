// The log viewer's data contract: one function, `openLogStream`, and the types of what it hands back. It is exported by the curated entry
// `@omniviewdev/runtime/ui/v1` (src/ui/v1.ts) and by nothing else.
//
// What it is. A session is opened for a target (a Pod, with a container) and its output reaches a CONSUMER (the host's log view) through a
// store that is not React's and does not need it: `subscribe` and `getSnapshot` are the two functions `useSyncExternalStore` takes, and `read`
// is how lines come out of it.
//
//   push from Go  ->  decode once per batch  ->  a bounded buffer of `LogLine`s  ->  the consumer reads batches at its own pace
//
// Backpressure. Nothing in the Wails boundary pushes back: the host emits a batch (at most 100 lines, one JSON string, every 50 ms or sooner) into
// an unbounded queue and goes on (docs/ui-next/status/P1b-1.md, backend catalog). So the bound is here. The consumer owns the pace (`read(max)`
// takes at most `max` lines, a frame's worth); lines it has not read are held, up to `maxBufferedLines` and `maxBufferedChars`; past either the
// OLDEST are dropped and counted (`LogBatch.dropped`, `LogStreamStats.dropped`, and a jump in `LogLine.seq`). A paused stream holds the same
// bounded buffer: the pause is local, the backend keeps sending (the SDK's own pause discards lines).
//
// What reaches React. `getSnapshot()` is a new object only when the status changes (state, pause, cause, the list of sources), a few times in a
// session and never per line: 10,000 lines a second are not 10,000 commits. A consumer that draws lines subscribes with the same `subscribe`
// and reads on its own clock (one animation frame): the listener runs at most once between two `read()` calls for lines.

import type { CancellablePromise } from '@wailsio/runtime';
import type { LogSession } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import { parseAppError } from './errors/parseAppError';
import type { AppError } from './errors/types';
import { CloseSession, CreateSession, SubscribeSessionEvents, type LogSessionRequest } from './logs';
import { decodePayload } from './logSessionEvents';
import type { AccessRoute, ResourceReference, Value } from './resource/v2/domain';
import { observeFrontendOperation } from './telemetry/frontendSpans';

/** How serious a line is, as the BACKEND says. The SDK has the field and sets it for no line today: a consumer that wants a level detects one from the text. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** `previous` is output kept from an earlier instance of the source, `system` a message of the log engine itself. */
export type LogLineOrigin = 'current' | 'previous' | 'system';

/** One line of a log. Immutable: a consumer may keep the object and compare it by identity. */
export interface LogLine {
  /** The line's number in this stream, from 1, in arrival order. A jump is a gap: the stream dropped the lines between. */
  readonly seq: number;
  /** The id of the source the line came from (for a Pod, `pod/container`); '' when the backend names none. The same string for every line of a source. */
  readonly source: string;
  /** When the backend says the line was written, as the RFC 3339 text it sent; '' when it has no time for it. */
  readonly timestamp: string;
  /** The line as the backend sent it, with its ANSI escapes. */
  readonly text: string;
  /** The level the backend gave the line; undefined when it gave none (it gives none today). */
  readonly level: LogLevel | undefined;
  /** Where the backend says the line comes from; `current` for every line today. */
  readonly origin: LogLineOrigin;
}

/** What one `read` returns. */
export interface LogBatch {
  /** At most the `max` asked for, oldest first. Empty while the stream is paused or closed, or when nothing is held. */
  readonly lines: readonly LogLine[];
  /** How many lines the stream dropped, for want of room, since the previous batch that was not paused: they sat between that batch and `lines[0]`. */
  readonly dropped: number;
  /** How many lines are still held after this batch. A consumer that stopped at `max` reads again while this is above 0. */
  readonly held: number;
}

/**
 * `starting` until the backend says the sources are connected or a line arrives; `streaming`; `paused` while `pause()` holds reads (the backend still
 * sends); `ended` when the session is over, which a finite read does by itself and `close()` does by hand; `failed` with a `cause`.
 */
export type LogStreamState = 'starting' | 'streaming' | 'paused' | 'ended' | 'failed';

/**
 * What a source is doing, from the events the backend sends for it. The backend sends no event when a source connects or when one ends by itself,
 * so a source is `connecting` until its first line, and an ended source is only known when the whole session ends.
 */
export type LogSourceState = 'connecting' | 'streaming' | 'reconnecting' | 'ended' | 'failed' | 'removed';

/** One source of a session (for a Pod, one container), as far as the backend's events and lines tell. */
export interface LogSourceInfo {
  /** The id lines name in `LogLine.source`. */
  readonly id: string;
  /** What the backend labels the source with (for a Pod: `pod`, `container`, `namespace`, `node`). Empty until the source's first line or the answer to `CreateSession` names it. */
  readonly labels: Readonly<Record<string, string>>;
  /** What the source is doing now. */
  readonly state: LogSourceState;
  /** The backend's last message about the source: the reconnect attempt, the failure. */
  readonly message?: string | undefined;
}

/** Why a stream failed. */
export interface LogStreamCause {
  /** `create`: the call that opens the session failed. `session`: the backend failed the session as a whole. `source`: every source failed. */
  readonly stage: 'create' | 'session' | 'source';
  /** The failing source's id, for stage `source`. */
  readonly source?: string | undefined;
  /** One sentence to show: the backend's own message, or what the runtime makes of the failed call. */
  readonly message: string;
  /** The runtime's reading of the error, when a call failed (stage `create`). */
  readonly error?: AppError | undefined;
}

/** The status of a stream. A new object when something in it changed, the same one otherwise. */
export interface LogStreamSnapshot {
  /** The session's id: the one reserved before the session was created. */
  readonly id: string;
  /** Where the stream is. `paused` while `paused` is true, unless it has ended or failed. */
  readonly state: LogStreamState;
  /** True from `pause()` to `resume()`, whatever `state` says: a session that ended while paused is still held. */
  readonly paused: boolean;
  /** Why the stream failed; undefined unless `state` is `failed`. */
  readonly cause: LogStreamCause | undefined;
  /** Every source the stream has heard of, in the order it heard of them; the list changes at most every 50 ms. */
  readonly sources: readonly LogSourceInfo[];
}

/** Counters of the buffer. Read them when a frame draws: they change with every batch and are not part of the snapshot. */
export interface LogStreamStats {
  /** Lines accepted since the stream opened, dropped ones included. */
  readonly received: number;
  /** Lines dropped because the buffer was full. */
  readonly dropped: number;
  /** Lines held now, waiting for `read`. */
  readonly held: number;
}

/** What to read, and how. A Pod is `resourceKey` `k8s:/pods`, its name `resourceId`, its container `target`. */
export interface LogStreamRequest {
  /** The plugin that serves the resource, by the id it is installed under. */
  readonly plugin: string;
  /** The connection to read through. */
  readonly connection: string;
  /** The plugin's key for the kind of resource. */
  readonly resourceKey: string;
  /** The resource's id (for a Pod, its name). */
  readonly resourceId: string;
  /** The record of the resource, as the data hooks return it: the plugin reads the container list of a Pod from it. */
  readonly resourceData?: Value | undefined;
  /** The reference the host admitted the record under, when the plugin reads through one. */
  readonly reference?: ResourceReference | undefined;
  /** The connection the reference was admitted for. */
  readonly route?: AccessRoute | undefined;
  /** One source to read alone (for a Pod, a container name); omitted or '' reads every source the resource has. */
  readonly target?: string | undefined;
  /** Keep reading as lines are written (default true). */
  readonly follow?: boolean | undefined;
  /** How many of the latest lines to start from (default 1,000; 0 asks for no limit, which a viewer should not). */
  readonly tailLines?: number | undefined;
  /** Start from this many seconds ago (default: no limit). */
  readonly sinceSeconds?: number | undefined;
  /** Read the previous instance of the source (for a container, the one that exited). */
  readonly previous?: boolean | undefined;
  /** Parameters the plugin defines, passed as they are. */
  readonly params?: Readonly<Record<string, string>> | undefined;
}

/** How much a stream may hold for a consumer that reads slowly or not at all. */
export interface LogStreamOptions {
  /** The most lines held unread (default 100,000, the cap of the viewer's own buffer). */
  readonly maxBufferedLines?: number | undefined;
  /** The most characters the held lines may add up to (default 33,554,432). */
  readonly maxBufferedChars?: number | undefined;
}

/** The store of one log session: its lines, its status, and the controls. Every member works unbound, as `useSyncExternalStore` needs. */
export interface LogStream {
  /** The session's id. */
  readonly id: string;
  /**
   * `useSyncExternalStore`'s first argument. The listener runs when `getSnapshot()` changed, and when held lines became readable after a `read` (at
   * most once between two reads); in the second case the snapshot is the same object. Returns the function that removes the listener.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /** `useSyncExternalStore`'s second argument. */
  readonly getSnapshot: () => LogStreamSnapshot;
  /** Takes up to `maxLines` held lines out of the stream, oldest first. Only one consumer may read a stream. */
  readonly read: (maxLines: number) => LogBatch;
  /** What the buffer has taken and let go; read when a frame draws. */
  readonly stats: () => LogStreamStats;
  /** Holds reads: `read` returns nothing and lines go on being held (and dropped past the bound) until `resume()`. */
  readonly pause: () => void;
  /** Lets reads through again; the lines held come out in slices of the consumer's choosing. */
  readonly resume: () => void;
  /**
   * Stops listening, releases the buffer and every listener, and closes the session in the backend. The returned promise settles when the backend has
   * answered; it rejects if the backend refused for a reason other than not knowing the session, and the stream is closed either way. Safe to call twice.
   */
  readonly close: () => Promise<void>;
}

/** Lines held unread: the viewer's own cap (docs/ui-next/optimisations.md, HLT-4 and HLT-6). */
const DEFAULT_MAX_LINES = 100_000;
const DEFAULT_MAX_CHARS = 32 * 1024 * 1024;
/** The latest lines a new session starts from (HLT-20): a busy Pod must not start with an unbounded history read. */
const DEFAULT_TAIL_LINES = 1000;
/** Source changes reach subscribers at most this often: 500 sources connecting are not 500 renders. */
const SOURCES_PUBLISH_MS = 50;

// The SDK's LogStreamEventType and LogLevel are iota enums (plugin-sdk pkg/v1/logs/stream.go).
const EVENT_SOURCE_ADDED = 0;
const EVENT_SOURCE_REMOVED = 1;
const EVENT_STREAM_ERROR = 2;
const EVENT_RECONNECTING = 3;
const EVENT_RECONNECTED = 4;
const EVENT_STREAM_ENDED = 5;
const EVENT_SESSION_READY = 6;
const LEVELS: ReadonlyArray<LogLevel | undefined> = [undefined, 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const ORIGINS: readonly LogLineOrigin[] = ['current', 'previous', 'system'];
/** Go writes the zero time for a line that has none. */
const ZERO_TIME = '0001-';
const NO_LABELS: Readonly<Record<string, string>> = Object.freeze({});
/** Past this many released slots, and once they are half of the array, the buffer is rebuilt without them. */
const COMPACT_AFTER = 4096;

type WireLine = { source_id?: unknown; labels?: unknown; timestamp?: unknown; content?: unknown; origin?: unknown; level?: unknown };
type WireEvent = { type?: unknown; source_id?: unknown; message?: unknown };
type Phase = 'starting' | 'streaming' | 'ended' | 'failed';
type SourceRecord = { id: string; labels: Readonly<Record<string, string>>; state: LogSourceState; message: string | undefined; view: LogSourceInfo | undefined };
/** What a line with no source id is attributed to. Never listed and never changed: frozen, so that a change attempted anywhere fails at once and cannot hand the next stream labels. */
const UNNAMED: SourceRecord = Object.freeze({ id: '', labels: NO_LABELS, state: 'streaming', message: undefined, view: undefined });

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function required(name: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

/** The labels of a wire line or source, or the shared empty object when it has none. */
function labelsOf(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null) {
    return NO_LABELS;
  }
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return Object.freeze(value as Record<string, string>);
    }
  }
  return NO_LABELS;
}

/** The request the runtime's `CreateSession` takes: the SDK's own shape. */
function sessionRequest(id: string, request: LogStreamRequest): LogSessionRequest {
  return {
    session_id: id,
    resource_key: required('resourceKey', request.resourceKey),
    resource_id: required('resourceId', request.resourceId),
    resource_data: request.resourceData,
    reference: request.reference,
    route: request.route,
    options: {
      target: request.target ?? '',
      follow: request.follow ?? true,
      include_previous: request.previous ?? false,
      include_timestamps: true,
      tail_lines: nonNegativeInteger('tailLines', request.tailLines ?? DEFAULT_TAIL_LINES),
      since_seconds: nonNegativeInteger('sinceSeconds', request.sinceSeconds ?? 0),
      limit_bytes: 0,
      include_source_events: true,
      params: { ...request.params },
    },
  };
}

/** Opens a log session and returns its stream at once, `starting`; failures arrive as the state `failed`, not as exceptions (a request that is not well formed throws). */
export function openLogStream(request: LogStreamRequest, options: LogStreamOptions = {}): LogStream {
  const plugin = required('plugin', request.plugin);
  const connection = required('connection', request.connection);
  const maxLines = positiveInteger('maxBufferedLines', options.maxBufferedLines ?? DEFAULT_MAX_LINES);
  const maxChars = positiveInteger('maxBufferedChars', options.maxBufferedChars ?? DEFAULT_MAX_CHARS);
  const id = crypto.randomUUID();
  const wire = sessionRequest(id, request);

  // The buffer: lines from `head` on are held; the slots before it are released, and the array is rebuilt once most of it is.
  let ring: LogLine[] = [];
  let head = 0;
  let heldChars = 0;
  let seq = 0;
  let dropped = 0;
  let droppedSinceRead = 0;

  // The status.
  let phase: Phase = 'starting';
  let paused = false;
  let cause: LogStreamCause | undefined;
  let closed = false;
  let hasNoSession = false;
  const sources = new Map<string, SourceRecord>();
  let lastSource: SourceRecord | undefined;
  let lastFailure: { source: string; message: string } | undefined;
  let sourcesChanged = false;
  let sourcesTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  let isReadableNotified = false;
  let disconnect = (): void => undefined;
  let creation: CancellablePromise<LogSession | null> | undefined;
  let closing: Promise<void> | undefined;
  let snapshot: LogStreamSnapshot = { id, state: 'starting', paused: false, cause: undefined, sources: [] };

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('A log stream listener failed:', error);
      }
    }
  };

  /** A new snapshot, and every listener told. The list of sources is rebuilt only when a source changed. */
  const publish = (): void => {
    clearTimeout(sourcesTimer);
    sourcesTimer = undefined;
    let list = snapshot.sources;
    if (sourcesChanged) {
      sourcesChanged = false;
      list = [...sources.values()].map((source) => (source.view ??= { id: source.id, labels: source.labels, state: source.state, message: source.message }));
    }
    snapshot = { id, state: phase === 'ended' || phase === 'failed' ? phase : paused ? 'paused' : phase, paused, cause, sources: list };
    notify();
  };

  /** Source changes alone are published on a short timer: a burst of them is one render. */
  const publishSoon = (): void => {
    if (sourcesTimer === undefined && !closed) {
      sourcesTimer = setTimeout(publish, SOURCES_PUBLISH_MS);
    }
  };

  const touch = (source: SourceRecord, state: LogSourceState, message?: string): void => {
    if (source.state !== state || source.message !== message) {
      source.state = state;
      source.message = message;
      source.view = undefined;
      sourcesChanged = true;
    }
  };

  /**
   * Gives a source the labels it lacks. An event never carries any, so a source an event named first learns them from the answer to the create call, or from
   * the first line that has some; once it has them they are not read again, and a line that has none changes nothing. The record of a line that names no
   * source is shared by every stream, and takes none.
   */
  const learnLabels = (source: SourceRecord, wireLabels: unknown): void => {
    if (source.labels === NO_LABELS && source !== UNNAMED) {
      const labels = labelsOf(wireLabels);
      if (labels !== NO_LABELS) {
        source.labels = labels;
        source.view = undefined;
        sourcesChanged = true;
      }
    }
  };

  /** The record of a source, made if the stream had not heard of it; a source first heard of after the session ended has ended with it. */
  const sourceOf = (sourceId: string, wireLabels: unknown, state: LogSourceState): SourceRecord => {
    const known = sources.get(sourceId);
    if (known !== undefined) {
      learnLabels(known, wireLabels);
      return known;
    }
    const source: SourceRecord = { id: sourceId, labels: labelsOf(wireLabels), state: phase === 'ended' ? 'ended' : state, message: undefined, view: undefined };
    sources.set(sourceId, source);
    sourcesChanged = true;
    return source;
  };

  /** The session is over, and so is every source still going; one that failed or was removed stays what it became. */
  const endSources = (): void => {
    for (const source of sources.values()) {
      if (source.state !== 'ended' && source.state !== 'failed' && source.state !== 'removed') {
        touch(source, 'ended');
      }
    }
  };

  const notifyReadable = (): void => {
    if (!isReadableNotified && !paused && !closed && ring.length > head) {
      isReadableNotified = true;
      notify();
    }
  };

  const fail = (next: LogStreamCause): void => {
    if (phase !== 'failed') {
      phase = 'failed';
      cause = next;
      publish();
    }
  };

  const failCreate = (error: unknown): void => {
    hasNoSession = true;
    disconnect();
    const app = parseAppError(error);
    fail({ stage: 'create', message: app.detail || app.title, error: app });
  };

  /** Releases the slots read or dropped; once most of the array is released, or all of it, the array is rebuilt. */
  const compact = (): void => {
    if (head === ring.length) {
      ring = [];
      head = 0;
      heldChars = 0;
    } else if (head > COMPACT_AFTER && head * 2 >= ring.length) {
      ring = ring.slice(head);
      head = 0;
    }
  };

  /** Drops the oldest lines until the buffer is within both bounds. */
  const enforceBounds = (): void => {
    let held = ring.length - head;
    if (held <= maxLines && heldChars <= maxChars) {
      return;
    }
    while (held > 0 && (held > maxLines || heldChars > maxChars)) {
      heldChars -= ring[head]!.text.length;
      ring[head++] = undefined as never;
      held--;
      dropped++;
      droppedSinceRead++;
    }
    compact();
  };

  const onLines = (data: unknown): void => {
    if (closed) {
      return;
    }
    let batch: unknown;
    try {
      batch = decodePayload(data);
    } catch (error) {
      console.error('Failed to parse log lines:', error);
      return;
    }
    if (!Array.isArray(batch) || batch.length === 0) {
      return;
    }
    for (const raw of batch as Array<WireLine | null>) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const sourceId = typeof raw.source_id === 'string' ? raw.source_id : '';
      let source = lastSource !== undefined && lastSource.id === sourceId ? lastSource : sources.get(sourceId);
      if (source === undefined) {
        // A line that names no source belongs to none: there is no source to list for it.
        source = sourceId === '' ? UNNAMED : sourceOf(sourceId, raw.labels, 'streaming');
      } else {
        // An event named this source first, or the lines before this one had no labels: the first line that has some gives them.
        learnLabels(source, raw.labels);
        if (source.state === 'connecting') {
          touch(source, 'streaming');
        }
      }
      lastSource = source;
      const text = typeof raw.content === 'string' ? raw.content : '';
      ring.push({
        seq: ++seq,
        source: source.id,
        timestamp: typeof raw.timestamp === 'string' && !raw.timestamp.startsWith(ZERO_TIME) ? raw.timestamp : '',
        text,
        level: LEVELS[(raw.level as number | undefined) ?? 0],
        origin: ORIGINS[(raw.origin as number | undefined) ?? 0] ?? 'current',
      });
      heldChars += text.length;
    }
    enforceBounds();
    if (phase === 'starting') {
      phase = 'streaming';
      publish();
    } else if (sourcesChanged) {
      publishSoon();
    }
    notifyReadable();
  };

  const onEvent = (data: unknown): void => {
    if (closed) {
      return;
    }
    let event: WireEvent | null;
    try {
      event = decodePayload(data) as WireEvent | null;
    } catch (error) {
      console.error('Failed to parse log event:', error);
      return;
    }
    if (event === null || typeof event !== 'object') {
      return;
    }
    const sourceId = typeof event.source_id === 'string' ? event.source_id : '';
    const message = typeof event.message === 'string' && event.message !== '' ? event.message : undefined;
    // The source an event names, made known if it was not; undefined for an event about the session.
    const source = (): SourceRecord | undefined => (sourceId === '' ? undefined : sourceOf(sourceId, NO_LABELS, 'connecting'));
    switch (event.type) {
      case EVENT_SESSION_READY:
        if (phase === 'starting') {
          phase = 'streaming';
          publish();
        }
        return;
      case EVENT_STREAM_ERROR: {
        const failing = source();
        if (failing === undefined) {
          fail({ stage: 'session', message: message ?? 'The log session failed.' });
          return;
        }
        lastFailure = { source: failing.id, message: message ?? 'The log source failed.' };
        touch(failing, 'failed', lastFailure.message);
        break;
      }
      case EVENT_STREAM_ENDED: {
        const ended = source();
        if (ended !== undefined) {
          touch(ended, 'ended');
          break;
        }
        if (phase === 'starting' || phase === 'streaming') {
          const all = [...sources.values()];
          if (lastFailure !== undefined && all.length > 0 && all.every((each) => each.state === 'failed')) {
            fail({ stage: 'source', source: lastFailure.source, message: lastFailure.message });
          } else {
            phase = 'ended';
            endSources();
            publish();
          }
        }
        return;
      }
      case EVENT_SOURCE_ADDED: {
        const added = source();
        if (added !== undefined && added.state !== 'streaming') {
          touch(added, 'connecting');
        }
        break;
      }
      case EVENT_SOURCE_REMOVED: {
        const removed = source();
        if (removed !== undefined) {
          touch(removed, 'removed');
        }
        break;
      }
      case EVENT_RECONNECTING: {
        const reconnecting = source();
        if (reconnecting !== undefined) {
          touch(reconnecting, 'reconnecting', message);
        }
        break;
      }
      case EVENT_RECONNECTED: {
        const reconnected = source();
        if (reconnected !== undefined) {
          touch(reconnected, 'streaming');
        }
        break;
      }
      default:
        return;
    }
    if (sourcesChanged) {
      publishSoon();
    }
  };

  const read = (maxLines: number): LogBatch => {
    const held = ring.length - head;
    const count = Math.min(maxLines > 0 ? Math.floor(maxLines) : 0, held);
    if (closed || paused || (count === 0 && held > 0)) {
      return { lines: [], dropped: 0, held };
    }
    const lines = ring.slice(head, head + count);
    for (const line of lines) {
      heldChars -= line.text.length;
      ring[head++] = undefined as never;
    }
    compact();
    const batch = { lines, dropped: droppedSinceRead, held: ring.length - head };
    droppedSinceRead = 0;
    isReadableNotified = false;
    return batch;
  };

  const pause = (): void => {
    if (!paused && !closed) {
      paused = true;
      publish();
    }
  };

  const resume = (): void => {
    if (paused && !closed) {
      paused = false;
      isReadableNotified = false;
      publish();
      notifyReadable();
    }
  };

  const close = (): Promise<void> => {
    if (closing !== undefined) {
      return closing;
    }
    // The answer is reserved before anyone is told anything: a subscriber that closes the stream in reply to what it hears is handed this promise and starts nothing.
    // (An executor, not `Promise.withResolvers`: that is ES2024, and this package compiles against ES2020.)
    let finish!: (backend: Promise<void>) => void;
    closing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    closed = true;
    clearTimeout(sourcesTimer);
    sourcesTimer = undefined;
    disconnect();
    ring = [];
    head = 0;
    heldChars = 0;
    if (phase === 'starting' || phase === 'streaming') {
      phase = 'ended';
      endSources();
    }
    publish();
    listeners.clear();
    const pending = creation;
    finish((async () => {
      if (hasNoSession) {
        return;
      }
      if (pending !== undefined) {
        // The call that opens the session may still be out: cancel it and wait for it to settle, so that the backend has retired what it was creating before the close below asks.
        try {
          await pending.cancel();
          await pending.then(() => undefined, () => undefined);
        } catch {
          // The cancelled call rejects; what matters is that it settled.
        }
      }
      try {
        await observeFrontendOperation('frontend.logs.session', { plugin_id: plugin, operation: 'close' }, CloseSession(id));
      } catch (error) {
        if (parseAppError(error).status !== 404) {
          throw error;
        }
      }
    })());
    return closing;
  };

  // Open. The runtime subscribes to the session's two topics before the call leaves (output the backend sends while it is still answering is kept), and
  // the stream takes the subscription over at once: lines and events reach it from the first.
  try {
    creation = CreateSession(plugin, connection, wire);
    observeFrontendOperation('frontend.logs.session', { plugin_id: plugin, operation: 'create' }, creation);
    disconnect = SubscribeSessionEvents(id, { onLines, onEvent });
    creation.then(
      (session) => {
        if (closed || session === null) {
          return;
        }
        // Go sends `null`, not `[]`, for a session that has no sources yet, and the runtime's create call hands the JSON back as it came.
        for (const source of session.active_sources ?? []) {
          sourceOf(source.id, source.labels, 'connecting');
        }
        if (sourcesChanged) {
          publishSoon();
        }
      },
      (error: unknown) => {
        if (!closed) {
          failCreate(error);
        }
      },
    );
  } catch (error) {
    // Nothing is listening and no session exists: the call threw before it left, or its topics could not be subscribed.
    Promise.resolve(creation?.cancel()).catch(() => undefined);
    failCreate(error);
  }

  return {
    id,
    subscribe: (listener) => {
      if (closed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    read,
    stats: () => ({ received: seq, dropped, held: ring.length - head }),
    pause,
    resume,
    close,
  };
}
