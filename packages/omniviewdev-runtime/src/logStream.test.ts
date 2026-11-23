// The log stream, exercised through the curated entry `./ui/v1` the way the host's viewer reaches it, with the Wails runtime replaced by a transport the
// test drives: the create call it settles by hand, the two topics of a session it emits on, and a count of the listeners that are live.
import { act, render } from '@testing-library/react';
import type * as WailsRuntime from '@wailsio/runtime';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { createElement, Profiler, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as curated from './ui/v1';
import type { LogStream, LogStreamOptions, LogStreamRequest } from './ui/v1';

type Listener = (event: { data: unknown }) => void;
const transport = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  /** The create call: `Call.ByName(method, plugin, connection, encodedRequest)`. */
  create: vi.fn<(method: string, plugin: string, connection: string, encodedRequest: string) => unknown>(),
  /** Every other call: `Call.ByID(id, ...args)`; the close of a session is the only one the stream makes. */
  call: vi.fn<(id: number, ...args: unknown[]) => unknown>(() => Promise.resolve()),
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Call: { ...actual.Call, ByName: transport.create, ByID: transport.call },
    Events: {
      ...actual.Events,
      On(key: string, listener: Listener) {
        const listeners = transport.listeners.get(key) ?? new Set();
        listeners.add(listener);
        transport.listeners.set(key, listeners);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
});

// The SDK's event types.
const SOURCE_ADDED = 0;
const SOURCE_REMOVED = 1;
const STREAM_ERROR = 2;
const RECONNECTING = 3;
const RECONNECTED = 4;
const STREAM_ENDED = 5;
const SESSION_READY = 6;
const SOURCE_CAUGHT_UP = 7;

const request: LogStreamRequest = { plugin: 'kubernetes', connection: 'conn-1', resourceKey: 'k8s:/pods', resourceId: 'web-0', target: 'app' };

afterEach(() => {
  transport.listeners.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) {
    await Promise.resolve();
  }
};
const listenerCount = (): number => [...transport.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);

type ActiveSource = { id: string; labels: Record<string, string> };

/** Opens a stream against a create call the test settles by hand. */
function open(options?: LogStreamOptions, over: Partial<LogStreamRequest> = {}) {
  const creation = CancellablePromise.withResolvers<{ id: string; active_sources: ActiveSource[] | null; replay_markers?: boolean } | null>();
  transport.create.mockReturnValue(creation.promise);
  const stream = curated.openLogStream({ ...request, ...over }, options);
  return {
    stream,
    creation,
    created: async (activeSources: ActiveSource[] | null = [], replayMarkers?: boolean): Promise<void> => {
      creation.resolve({ id: stream.id, active_sources: activeSources, ...(replayMarkers === undefined ? {} : { replay_markers: replayMarkers }) });
      await settle();
    },
  };
}

function emit(id: string, channel: 'lines' | 'event', data: unknown): void {
  for (const listener of [...(transport.listeners.get(`core/logs/${channel}/${id}`) ?? [])]) {
    listener({ data });
  }
}
const event = (stream: LogStream, type: number, source = '', message = ''): void => {
  emit(stream.id, 'event', JSON.stringify({ type, source_id: source, message, timestamp: '2026-11-19T10:00:00Z' }));
};

/** A line as the host's JSON carries it (`logs.LogLine`). */
function wireLine(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 's',
    source_id: 'web-0/app',
    labels: { pod: 'web-0', container: 'app', namespace: 'default', node: 'node-1' },
    timestamp: '2026-11-19T10:00:00.123456789Z',
    content: `line ${String(n)}`,
    origin: 0,
    level: 0,
    ...over,
  };
}
/** One batch as the host emits it: a JSON string of lines. */
const batch = (from: number, count: number, over: Record<string, unknown> = {}): string =>
  JSON.stringify(Array.from({ length: count }, (_, index) => wireLine(from + index, over)));

describe('the entry', () => {
  it('exports the function and hands back the store, the reader and the controls', () => {
    expect(typeof curated.openLogStream).toBe('function');
    const { stream } = open();
    expect(Object.keys(stream).sort()).toEqual(['close', 'getSnapshot', 'id', 'pause', 'read', 'resume', 'stats', 'subscribe']);
    expect(stream.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stream.getSnapshot()).toEqual({ id: stream.id, state: 'starting', paused: false, cause: undefined, sources: [], markers: 'pending' });
    expect(stream.stats()).toEqual({ received: 0, dropped: 0, held: 0, live: undefined });
    void stream.close();
  });

  it('asks the backend for the session it reserved, with the defaults a viewer must not lose', () => {
    const { stream } = open();
    expect(transport.create).toHaveBeenCalledTimes(1);
    const [method, plugin, connection, encoded] = transport.create.mock.calls[0]!;
    expect(method).toBe('github.com/omniviewdev/omniview/backend/pkg/plugin/logs.ServiceWrapper.CreateSession');
    expect([plugin, connection]).toEqual(['kubernetes', 'conn-1']);
    expect(JSON.parse(encoded)).toEqual({
      session_id: stream.id,
      resource_key: 'k8s:/pods',
      resource_id: 'web-0',
      options: {
        target: 'app',
        follow: true,
        include_previous: false,
        include_timestamps: true,
        tail_lines: 1000,
        since_seconds: 0,
        limit_bytes: 0,
        include_source_events: true,
        params: {},
      },
    });
    void stream.close();
  });

  it('passes what the request names: since, previous, tail, follow, params, the record and its reference', () => {
    const reference = { address: { provider: 'k8s', authority: 'conn-1', type: 'k8s:/pods', scope: [], id: 'web-0' } };
    const { stream } = open(undefined, {
      follow: false,
      tailLines: 200,
      sinceSeconds: 60,
      previous: true,
      target: '',
      params: { filter_labels: 'container' },
      resourceData: { kind: 'string', value: 'body' },
      reference,
      route: { connection: 'conn-1' },
    });
    const encoded: Record<string, unknown> = JSON.parse(transport.create.mock.calls[0]![3]);
    expect(encoded).toMatchObject({
      resource_data: { kind: 'string', value: 'body' },
      reference,
      route: { connection: 'conn-1' },
      options: { target: '', follow: false, tail_lines: 200, since_seconds: 60, include_previous: true, params: { filter_labels: 'container' } },
    });
    void stream.close();
  });

  it('throws for a request that is not well formed and opens nothing', () => {
    expect(() => curated.openLogStream({ ...request, plugin: '' })).toThrow(TypeError);
    expect(() => curated.openLogStream({ ...request, connection: '' })).toThrow(TypeError);
    expect(() => curated.openLogStream({ ...request, resourceKey: '' })).toThrow(TypeError);
    expect(() => curated.openLogStream({ ...request, resourceId: '' })).toThrow(TypeError);
    expect(() => curated.openLogStream({ ...request, tailLines: -1 })).toThrow(RangeError);
    expect(() => curated.openLogStream({ ...request, tailLines: 1.5 })).toThrow(RangeError);
    expect(() => curated.openLogStream({ ...request, sinceSeconds: -1 })).toThrow(RangeError);
    expect(() => curated.openLogStream(request, { maxBufferedLines: 0 })).toThrow(RangeError);
    expect(() => curated.openLogStream(request, { maxBufferedChars: -5 })).toThrow(RangeError);
    expect(transport.create).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });
});

describe('delivery', () => {
  it('delivers 100,000 lines in batches of 100, in order, to a consumer that reads a frame at a time, and never holds more than a frame and a batch', async () => {
    const { stream, created } = open();
    await created();
    const batches = Array.from({ length: 1000 }, (_, index) => batch(index * 100 + 1, 100));
    let notified = 0;
    stream.subscribe(() => {
      notified++;
    });
    let expected = 1;
    let peak = 0;
    let reads = 0;
    for (let index = 0; index < batches.length; index++) {
      emit(stream.id, 'lines', batches[index]);
      peak = Math.max(peak, stream.stats().held);
      if (index % 5 === 4) {
        // One animation frame: five batches have arrived, the consumer takes what it can draw.
        const frame = stream.read(500);
        reads++;
        expect(frame.dropped).toBe(0);
        expect(frame.held).toBe(0);
        for (const line of frame.lines) {
          if (line.seq !== expected++) {
            throw new Error(`line ${String(line.seq)} arrived where ${String(expected - 1)} was due`);
          }
        }
      }
    }
    expect(expected).toBe(100_001);
    expect(peak).toBe(500);
    expect(stream.stats()).toEqual({ received: 100_000, dropped: 0, held: 0 });
    // One notification for the first line (the state changed) and one per frame: the 1,000 batches did not each wake the consumer.
    expect(notified).toBeLessThanOrEqual(reads + 1);
    void stream.close();
  });

  it('holds a consumer that never reads to the bound: the oldest lines are dropped and counted, and the gap shows in seq', async () => {
    const { stream, created } = open({ maxBufferedLines: 1000 });
    await created();
    let peak = 0;
    for (let index = 0; index < 1000; index++) {
      emit(stream.id, 'lines', batch(index * 100 + 1, 100));
      peak = Math.max(peak, stream.stats().held);
    }
    expect(peak).toBeLessThanOrEqual(1000);
    expect(stream.stats()).toEqual({ received: 100_000, dropped: 99_000, held: 1000 });
    const read = stream.read(5000);
    expect(read.lines).toHaveLength(1000);
    expect(read.lines[0]?.seq).toBe(99_001);
    expect(read.lines.at(-1)?.seq).toBe(100_000);
    expect(read.dropped).toBe(99_000);
    expect(read.held).toBe(0);
    expect(stream.read(5000)).toEqual({ lines: [], dropped: 0, held: 0 });
    void stream.close();
  });

  it('bounds the characters held as well as the lines, and drops a line that alone is over the bound', async () => {
    const { stream, created } = open({ maxBufferedChars: 100 });
    await created();
    emit(stream.id, 'lines', JSON.stringify(Array.from({ length: 30 }, (_, index) => wireLine(index, { content: 'x'.repeat(10) }))));
    expect(stream.stats()).toEqual({ received: 30, dropped: 20, held: 10 });
    emit(stream.id, 'lines', JSON.stringify([wireLine(0, { content: 'y'.repeat(500) })]));
    expect(stream.stats()).toEqual({ received: 31, dropped: 31, held: 0 });
    expect(stream.read(10)).toEqual({ lines: [], dropped: 31, held: 0 });
    void stream.close();
  });

  it('counts characters out as well as in: a reader that keeps up loses no line to the bound, and a drop gives its characters back', async () => {
    const { stream, created } = open({ maxBufferedChars: 100 });
    await created();
    const lines = (count: number): string => JSON.stringify(Array.from({ length: count }, (_, index) => wireLine(index, { content: 'x'.repeat(10) })));
    // One line is always left held, so that the buffer is never emptied (an empty buffer starts its count over, which would hide a miscount).
    emit(stream.id, 'lines', lines(1));
    for (let round = 0; round < 20; round++) {
      emit(stream.id, 'lines', lines(5));
      expect(stream.read(5).lines).toHaveLength(5);
    }
    expect(stream.stats()).toEqual({ received: 101, dropped: 0, held: 1 });
    stream.read(1);
    emit(stream.id, 'lines', lines(30));
    expect(stream.stats()).toMatchObject({ dropped: 20, held: 10 });
    stream.read(9);
    emit(stream.id, 'lines', lines(5));
    expect(stream.stats()).toMatchObject({ dropped: 20, held: 6 });
    void stream.close();
  });

  it('takes at most the lines it is asked for, oldest first, and says what is left', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 10));
    expect(stream.read(0)).toEqual({ lines: [], dropped: 0, held: 10 });
    expect(stream.read(Number.NaN).lines).toEqual([]);
    const first = stream.read(4);
    expect(first.lines.map((line) => line.seq)).toEqual([1, 2, 3, 4]);
    expect(first.held).toBe(6);
    const rest = stream.read(Infinity);
    expect(rest.lines.map((line) => line.seq)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(rest.held).toBe(0);
    void stream.close();
  });

  it('reads the wire as the SDK writes it: no time is empty, a level the backend gave is a name, a source is one string', async () => {
    const { stream, created } = open();
    await created();
    emit(
      stream.id,
      'lines',
      JSON.stringify([
        wireLine(1, { timestamp: '0001-01-01T00:00:00Z', level: 0 }),
        wireLine(2, { level: 5, origin: 2 }),
        wireLine(3, { level: 99, origin: 9 }),
        wireLine(4, { level: 1, origin: 1, content: undefined }),
        null,
        'not a line',
      ]),
    );
    const [first, second, third, fourth, ...others] = stream.read(10).lines;
    expect(others).toEqual([]);
    expect(first).toEqual({ seq: 1, source: 'web-0/app', timestamp: '', text: 'line 1', level: undefined, origin: 'current', replay: false });
    expect(second).toMatchObject({ timestamp: '2026-11-19T10:00:00.123456789Z', level: 'error', origin: 'system' });
    expect(third).toMatchObject({ level: undefined, origin: 'current' });
    expect(fourth).toMatchObject({ level: 'trace', origin: 'previous', text: '' });
    expect(second?.source).toBe(first?.source);
    expect(fourth?.source).toBe(first?.source);
    void stream.close();
  });

  it('keeps output the backend sends while the call is still out', async () => {
    const creation = CancellablePromise.withResolvers<{ id: string; active_sources: [] }>();
    transport.create.mockImplementation((_method: string, _plugin: string, _connection: string, encoded: string) => {
      const sent: { session_id: string } = JSON.parse(encoded);
      const id = sent.session_id;
      emit(id, 'lines', batch(1, 3));
      emit(id, 'event', JSON.stringify({ type: SESSION_READY, source_id: '' }));
      return creation.promise;
    });
    const stream = curated.openLogStream(request);
    expect(stream.read(10).lines.map((line) => line.text)).toEqual(['line 1', 'line 2', 'line 3']);
    expect(stream.getSnapshot().state).toBe('streaming');
    creation.resolve({ id: stream.id, active_sources: [] });
    await settle();
    expect(listenerCount()).toBe(2);
    void stream.close();
  });

  it('ignores a payload that does not parse or is not a batch, and goes on', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', '{not json');
    emit(stream.id, 'lines', '{"not":"an array"}');
    emit(stream.id, 'lines', '[]');
    emit(stream.id, 'event', '{not json');
    emit(stream.id, 'event', '7');
    emit(stream.id, 'lines', [batch(1, 2)]);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(stream.read(10).lines).toHaveLength(2);
    expect(stream.getSnapshot().state).toBe('streaming');
    void stream.close();
  });

  it('keeps taking lines after the session ended: the host sends the end ahead of the last batch', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 100));
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot().state).toBe('ended');
    emit(stream.id, 'lines', batch(101, 50));
    expect(stream.read(1000).lines).toHaveLength(150);
    expect(stream.getSnapshot().state).toBe('ended');
    void stream.close();
  });
});

describe('subscribers', () => {
  it('wakes a subscriber once per read, not once per batch', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 1));
    stream.read(10);
    const woken = vi.fn();
    stream.subscribe(woken);
    for (let index = 0; index < 100; index++) {
      emit(stream.id, 'lines', batch(2 + index * 100, 100));
    }
    expect(woken).toHaveBeenCalledTimes(1);
    expect(stream.read(500).held).toBe(9500);
    emit(stream.id, 'lines', batch(1, 1));
    expect(woken).toHaveBeenCalledTimes(2);
    stream.read(100_000);
    emit(stream.id, 'lines', batch(1, 1));
    expect(woken).toHaveBeenCalledTimes(3);
    void stream.close();
  });

  it('hands React a new snapshot when the status changes and the same one while lines go by', async () => {
    const { stream, created } = open();
    await created();
    const first = stream.getSnapshot();
    emit(stream.id, 'lines', batch(1, 100));
    const streaming = stream.getSnapshot();
    expect(streaming).not.toBe(first);
    expect(streaming.state).toBe('streaming');
    for (let index = 0; index < 50; index++) {
      emit(stream.id, 'lines', batch(101 + index * 100, 100));
      stream.read(10_000);
    }
    expect(stream.getSnapshot()).toBe(streaming);
    stream.pause();
    expect(stream.getSnapshot()).not.toBe(streaming);
    void stream.close();
  });

  it('costs a React tree no commit for 10,000 lines, and one for each change of status', async () => {
    const { stream, created } = open();
    await created();
    event(stream, SESSION_READY);
    let commits = 0;
    function Probe() {
      const snapshot = useSyncExternalStore(stream.subscribe, stream.getSnapshot);
      return createElement('span', { 'data-state': snapshot.state });
    }
    const view = render(
      createElement(
        Profiler,
        {
          id: 'probe',
          onRender: () => {
            commits++;
          },
        },
        createElement(Probe),
      ),
    );
    expect(commits).toBe(1);
    await act(async () => {
      for (let index = 0; index < 100; index++) {
        emit(stream.id, 'lines', batch(1 + index * 100, 100));
      }
      await settle();
    });
    expect(stream.stats().received).toBe(10_000);
    expect(commits).toBe(1);
    await act(async () => {
      stream.pause();
      await settle();
    });
    expect(view.container.querySelector('span')?.getAttribute('data-state')).toBe('paused');
    expect(commits).toBe(2);
    await act(async () => {
      stream.resume();
      await settle();
    });
    expect(view.container.querySelector('span')?.getAttribute('data-state')).toBe('streaming');
    expect(commits).toBe(3);
    view.unmount();
    void stream.close();
  });

  it('survives a subscriber that throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { stream, created } = open();
    await created();
    const after = vi.fn();
    stream.subscribe(() => {
      throw new Error('bad subscriber');
    });
    stream.subscribe(after);
    emit(stream.id, 'lines', batch(1, 3));
    expect(errors).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(stream.read(10).lines).toHaveLength(3);
    void stream.close();
  });
});

describe('pause', () => {
  it('holds a bounded buffer while paused and reports what it dropped when reading resumes', async () => {
    const { stream, created } = open({ maxBufferedLines: 500 });
    await created();
    emit(stream.id, 'lines', batch(1, 100));
    expect(stream.read(100).lines).toHaveLength(100);
    const woken = vi.fn();
    stream.subscribe(woken);
    stream.pause();
    expect(stream.getSnapshot()).toMatchObject({ state: 'paused', paused: true });
    expect(woken).toHaveBeenCalledTimes(1);
    const paused = stream.getSnapshot();
    // A paused viewer is sent 2,000 lines it cannot draw: it keeps the newest 500 and counts the 1,500 it let go.
    for (let index = 0; index < 20; index++) {
      emit(stream.id, 'lines', batch(101 + index * 100, 100));
    }
    expect(stream.stats()).toEqual({ received: 2100, dropped: 1500, held: 500 });
    expect(stream.read(1000)).toEqual({ lines: [], dropped: 0, held: 500 });
    expect(stream.getSnapshot()).toBe(paused);
    expect(woken).toHaveBeenCalledTimes(1);

    stream.resume();
    expect(stream.getSnapshot()).toMatchObject({ state: 'streaming', paused: false });
    expect(woken).toHaveBeenCalledTimes(3);
    const resumed = stream.read(1000);
    expect(resumed.lines).toHaveLength(500);
    expect(resumed.lines[0]?.seq).toBe(1601);
    expect(resumed.lines.at(-1)?.seq).toBe(2100);
    expect(resumed.dropped).toBe(1500);
    expect(resumed.held).toBe(0);
    void stream.close();
  });

  it('pauses and resumes once: a repeat changes nothing and says nothing', async () => {
    const { stream, created } = open();
    await created();
    const woken = vi.fn();
    stream.subscribe(woken);
    stream.pause();
    stream.pause();
    expect(woken).toHaveBeenCalledTimes(1);
    stream.resume();
    stream.resume();
    expect(woken).toHaveBeenCalledTimes(2);
    void stream.close();
  });

  it('keeps holding a session that ended while paused, until it is resumed', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 5));
    stream.pause();
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot()).toMatchObject({ state: 'ended', paused: true });
    expect(stream.read(10).lines).toEqual([]);
    stream.resume();
    expect(stream.getSnapshot()).toMatchObject({ state: 'ended', paused: false });
    expect(stream.read(10).lines).toHaveLength(5);
    void stream.close();
  });

  it('wakes the reader when a resume finds lines held, even if it was woken before the pause', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 5));
    const woken = vi.fn();
    stream.subscribe(woken);
    stream.pause();
    stream.resume();
    expect(woken.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(stream.read(10).lines).toHaveLength(5);
    void stream.close();
  });
});

describe('state', () => {
  it('is starting until the sources are connected, or a line arrives', async () => {
    const ready = open();
    await ready.created();
    expect(ready.stream.getSnapshot().state).toBe('starting');
    event(ready.stream, SESSION_READY);
    expect(ready.stream.getSnapshot().state).toBe('streaming');
    const line = open();
    await line.created();
    emit(line.stream.id, 'lines', batch(1, 1));
    expect(line.stream.getSnapshot().state).toBe('streaming');
    void ready.stream.close();
    void line.stream.close();
  });

  it('ends when the session ends', async () => {
    const { stream, created } = open();
    await created();
    event(stream, SESSION_READY);
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot()).toMatchObject({ state: 'ended', cause: undefined });
    void stream.close();
  });

  it('fails with the cause when the call that opens the session fails, and stops listening', async () => {
    const { stream, creation } = open();
    expect(listenerCount()).toBe(2);
    creation.reject(new Error(JSON.stringify({ type: 'urn:omniview:forbidden', title: 'Forbidden', status: 403, detail: 'pods/log is forbidden', code: 'FORBIDDEN' })));
    await settle();
    const snapshot = stream.getSnapshot();
    expect(snapshot.state).toBe('failed');
    expect(snapshot.cause).toMatchObject({ stage: 'create', message: 'pods/log is forbidden' });
    expect(snapshot.cause?.error?.status).toBe(403);
    expect(listenerCount()).toBe(0);
    await stream.close();
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('fails the same way when the call throws before it leaves', () => {
    transport.create.mockImplementation(() => {
      throw new Error('Request JSON byte limit');
    });
    const stream = curated.openLogStream(request);
    expect(stream.getSnapshot().state).toBe('failed');
    expect(stream.getSnapshot().cause?.stage).toBe('create');
    expect(listenerCount()).toBe(0);
    return stream.close();
  });

  it('accepts the answer of a session that has no sources yet, which Go sends with `active_sources: null`', async () => {
    // The runtime's create call returns the JSON as it came (no `createFrom`), and Go marshals an empty slice it never made as null: found by running the
    // stream over the real runtime in WebKit and Chromium (packages/omniviewdev-runtime/scripts/log-stream-browser.mjs); a mock that answered `[]` never saw it.
    const { stream, created } = open();
    await created(null);
    expect(stream.getSnapshot()).toMatchObject({ state: 'starting', cause: undefined, sources: [] });
    emit(stream.id, 'lines', batch(1, 2));
    expect(stream.read(10).lines).toHaveLength(2);
    await stream.close();
  });

  it('fails with the backend\'s own words when it fails the session', async () => {
    const { stream, created } = open();
    await created();
    event(stream, STREAM_ERROR, '', 'no log handler found for resource type k8s:/widgets');
    expect(stream.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'session', message: 'no log handler found for resource type k8s:/widgets' } });
    // The end that follows an error does not turn it into an ending.
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot().state).toBe('failed');
    void stream.close();
  });

  it('keeps streaming while one source fails, and names it', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    event(stream, SOURCE_ADDED, 'web-0/app');
    event(stream, SOURCE_ADDED, 'web-0/sidecar');
    emit(stream.id, 'lines', batch(1, 3));
    event(stream, STREAM_ERROR, 'web-0/sidecar', 'Failed to reconnect after 5 attempts');
    vi.advanceTimersByTime(60);
    const snapshot = stream.getSnapshot();
    expect(snapshot.state).toBe('streaming');
    expect(snapshot.sources.map((source) => [source.id, source.state, source.message])).toEqual([
      ['web-0/app', 'streaming', undefined],
      ['web-0/sidecar', 'failed', 'Failed to reconnect after 5 attempts'],
    ]);
    void stream.close();
  });

  it('fails when every source failed and the session ended, with the last cause', async () => {
    const { stream, created } = open();
    await created();
    event(stream, SOURCE_ADDED, 'web-0/app');
    event(stream, RECONNECTING, 'web-0/app', 'Reconnecting (attempt 1/5)');
    event(stream, STREAM_ERROR, 'web-0/app', 'Failed to reconnect after 5 attempts');
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot()).toMatchObject({
      state: 'failed',
      cause: { stage: 'source', source: 'web-0/app', message: 'Failed to reconnect after 5 attempts' },
    });
    void stream.close();
  });

  it('ends, not fails, when only some sources failed', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 1));
    event(stream, STREAM_ERROR, 'web-0/other', 'gone');
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot()).toMatchObject({ state: 'ended', cause: undefined });
    void stream.close();
  });

  it('follows a source through the events the backend sends for it', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created([{ id: 'web-0/app', labels: { container: 'app' } }]);
    const states = (): string[] => stream.getSnapshot().sources.map((source) => `${source.id}:${source.state}`);
    vi.advanceTimersByTime(60);
    expect(states()).toEqual(['web-0/app:connecting']);
    expect(stream.getSnapshot().sources[0]?.labels).toEqual({ container: 'app' });
    event(stream, RECONNECTING, 'web-0/app', 'Reconnecting (attempt 2/5)');
    vi.advanceTimersByTime(60);
    expect(stream.getSnapshot().sources[0]).toMatchObject({ state: 'reconnecting', message: 'Reconnecting (attempt 2/5)' });
    event(stream, RECONNECTED, 'web-0/app');
    event(stream, SOURCE_REMOVED, 'web-0/gone');
    event(stream, STREAM_ENDED, 'web-0/app');
    vi.advanceTimersByTime(60);
    expect(states()).toEqual(['web-0/app:ended', 'web-0/gone:removed']);
    void stream.close();
  });

  it('learns a source\'s labels from its first line, and a source it was never told of', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    event(stream, SOURCE_ADDED, 'web-0/app');
    emit(stream.id, 'lines', batch(1, 2));
    emit(stream.id, 'lines', JSON.stringify([wireLine(3, { source_id: 'web-1/app', labels: { container: 'app', pod: 'web-1' } })]));
    vi.advanceTimersByTime(60);
    const sources = stream.getSnapshot().sources;
    expect(sources.map((source) => [source.id, source.state])).toEqual([
      ['web-0/app', 'streaming'],
      ['web-1/app', 'streaming'],
    ]);
    expect(sources[0]?.labels).toEqual({ pod: 'web-0', container: 'app', namespace: 'default', node: 'node-1' });
    expect(sources[1]?.labels).toEqual({ container: 'app', pod: 'web-1' });
    void stream.close();
  });

  it('publishes a burst of 500 sources as one change', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    event(stream, SESSION_READY);
    const woken = vi.fn();
    stream.subscribe(woken);
    for (let index = 0; index < 500; index++) {
      event(stream, SOURCE_ADDED, `pod-${String(index)}/app`);
    }
    expect(woken).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(woken).toHaveBeenCalledTimes(1);
    expect(stream.getSnapshot().sources).toHaveLength(500);
    void stream.close();
  });

  it('says nothing about an event that changes nothing', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 1));
    vi.advanceTimersByTime(60);
    const woken = vi.fn();
    stream.subscribe(woken);
    const before = stream.getSnapshot();
    event(stream, SOURCE_ADDED, 'web-0/app');
    event(stream, RECONNECTED, 'web-0/app');
    event(stream, 99, 'web-0/app');
    event(stream, SOURCE_ADDED, '');
    vi.advanceTimersByTime(100);
    expect(woken).not.toHaveBeenCalled();
    expect(stream.getSnapshot()).toBe(before);
    void stream.close();
  });
});

// SDK v0.22.0: an event kind the SDK does not know arrives as -1 (v0.21.0 sent it as 0, SOURCE_ADDED, with the event's source_id: a phantom source here). A reader of the
// stream ignores it, and the kinds past the ones the SDK names (SOURCE_CAUGHT_UP, 7, is read: see 'replay markers' below).
describe('an event kind the stream does not read', () => {
  const UNKNOWN = -1;
  const unread: ReadonlyArray<readonly [number, string]> = [
    [UNKNOWN, 'phantom'],
    [UNKNOWN, ''],
    [8, 'phantom'],
    [8, ''],
  ];

  it('adds no source and changes no state, however the session stands: starting, streaming, ended', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    // The answer to the create call says whether markers will come, and that is published with the next change of status: let it be before the snapshot is taken as the stable one.
    vi.advanceTimersByTime(60);
    const woken = vi.fn();
    stream.subscribe(woken);
    const before = stream.getSnapshot();
    for (const [type, source] of unread) {
      event(stream, type, source, 'x');
    }
    vi.advanceTimersByTime(200);
    expect(stream.getSnapshot()).toBe(before);
    expect(before).toMatchObject({ state: 'starting', sources: [] });

    event(stream, SESSION_READY);
    vi.advanceTimersByTime(60);
    const ready = stream.getSnapshot();
    expect(ready).toMatchObject({ state: 'streaming', sources: [] });
    woken.mockClear();
    for (const [type, source] of unread) {
      event(stream, type, source, 'x');
    }
    vi.advanceTimersByTime(200);
    expect(stream.getSnapshot()).toBe(ready);

    event(stream, STREAM_ENDED);
    vi.advanceTimersByTime(60);
    const ended = stream.getSnapshot();
    expect(ended).toMatchObject({ state: 'ended', sources: [] });
    woken.mockClear();
    for (const [type, source] of unread) {
      event(stream, type, source, 'x');
    }
    vi.advanceTimersByTime(200);
    expect(woken).not.toHaveBeenCalled();
    expect(stream.getSnapshot()).toBe(ended);
    void stream.close();
  });

  it('leaves the state, message and set of the sources it was told of as they were', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created([{ id: 'web-0/app', labels: { container: 'app' } }]);
    event(stream, RECONNECTING, 'web-0/app', 'Reconnecting (attempt 2/5)');
    event(stream, STREAM_ERROR, 'web-1/app', 'Reader denied');
    event(stream, SOURCE_REMOVED, 'web-2/app');
    vi.advanceTimersByTime(60);
    const before = stream.getSnapshot();
    const states = (): string[] => before.sources.map((source) => `${source.id}:${source.state}:${source.message ?? ''}`);
    expect(states()).toEqual([
      'web-0/app:reconnecting:Reconnecting (attempt 2/5)',
      'web-1/app:failed:Reader denied',
      'web-2/app:removed:',
    ]);
    for (const source of ['web-0/app', 'web-1/app', 'web-2/app', 'phantom', '']) {
      for (const type of [UNKNOWN, 8]) {
        event(stream, type, source, 'x');
      }
    }
    vi.advanceTimersByTime(200);
    expect(stream.getSnapshot()).toBe(before);
    void stream.close();
  });

  it('keeps what it was told while the create call was out, through a burst of them', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    event(stream, SESSION_READY);
    event(stream, SOURCE_REMOVED, 'web-0/gone');
    event(stream, STREAM_ERROR, 'web-1/app', 'Reader denied');
    for (let index = 0; index < 150; index++) {
      event(stream, UNKNOWN, `phantom-${String(index)}`, 'x');
      event(stream, 8, `later-${String(index)}`);
      event(stream, UNKNOWN, '');
    }
    event(stream, STREAM_ENDED, 'web-1/app');
    await created();
    vi.advanceTimersByTime(60);
    const snapshot = stream.getSnapshot();
    expect(snapshot.state).toBe('streaming');
    expect(snapshot.sources.map((source) => `${source.id}:${source.state}`)).toEqual(['web-0/gone:removed', 'web-1/app:ended']);
    void stream.close();
  });
});

// SDK v0.22.0 replay markers (S1-host). The host's Go lane asks for them (the runtime sends no parameter of the SDK's), and the backend then says three things: whether markers will come for the session
// (the answer to the create call: `replay_markers`), which lines are replay (a line's own `replay`), and when a source's replay is over (the event SOURCE_CAUGHT_UP, kind 7, once for each opening of a source). The
// stream keeps each source in one of three states and counts what a rate may be made of: the lines that are NOT flagged replay and come from a source whose replay is over. It never guesses: no time, no gap, no clock.
describe('replay markers: what the backend says of a source\'s replay, and the lines a rate may count', () => {
  const LABELS = { pod: 'web-0', container: 'app', namespace: 'default', node: 'node-1' };
  /** What the snapshot says of each source's replay: it is published with the next change of status (within 50 ms), so a test lets that pass first. */
  const replayOf = (stream: LogStream): string[] => {
    vi.advanceTimersByTime(60);
    return stream.getSnapshot().sources.map((source) => `${source.id}:${source.replay}`);
  };
  /** `count` lines of `source` as the host's JSON carries them, flagged replay or not. */
  const lines = (stream: LogStream, source: string, count: number, replay: boolean): void => {
    emit(stream.id, 'lines', JSON.stringify(Array.from({ length: count }, (_, index) => wireLine(index + 1, { source_id: source, ...(replay ? { replay: true } : {}) }))));
  };
  /** A session that asked and was accepted, with the sources the answer lists. */
  const accepted = async (sources: readonly string[], options?: LogStreamOptions) => {
    vi.useFakeTimers();
    const opened = open(options);
    await opened.created(
      sources.map((id) => ({ id, labels: LABELS })),
      true,
    );
    vi.advanceTimersByTime(60);
    return opened.stream;
  };

  describe('what the session says', () => {
    it('is pending until the answer to the create call, then yes or no, and never changes again', async () => {
      vi.useFakeTimers();
      const yes = open();
      expect(yes.stream.getSnapshot().markers).toBe('pending');
      await yes.created([], true);
      vi.advanceTimersByTime(60);
      expect(yes.stream.getSnapshot().markers).toBe('yes');
      const absent = open();
      await absent.created([]);
      vi.advanceTimersByTime(60);
      expect(absent.stream.getSnapshot().markers).toBe('no');
      const refused = open();
      await refused.created([], false);
      vi.advanceTimersByTime(60);
      expect(refused.stream.getSnapshot().markers).toBe('no');
      // Neither a later line nor a marker's absence changes what the answer said.
      emit(absent.stream.id, 'lines', batch(1, 3, { replay: true }));
      vi.advanceTimersByTime(60);
      expect(absent.stream.getSnapshot().markers).toBe('no');
      for (const { stream } of [yes, absent, refused]) {
        void stream.close();
      }
    });

    it('starts a source of an accepted session as replaying, and one of a session without markers as unknown: the backend will say nothing more of it', async () => {
      const marked = await accepted(['a/app', 'b/app']);
      expect(replayOf(marked)).toEqual(['a/app:replaying', 'b/app:replaying']);
      // A source first heard of in a line or an event after the answer takes the answer's state too.
      event(marked, SOURCE_ADDED, 'c/app');
      lines(marked, 'd/app', 1, false);
      vi.advanceTimersByTime(60);
      expect(replayOf(marked)).toEqual(['a/app:replaying', 'b/app:replaying', 'c/app:replaying', 'd/app:replaying']);

      const unmarked = open();
      await unmarked.created([{ id: 'a/app', labels: {} }]);
      event(unmarked.stream, SOURCE_ADDED, 'b/app');
      vi.advanceTimersByTime(60);
      expect(replayOf(unmarked.stream)).toEqual(['a/app:unknown', 'b/app:unknown']);
      void marked.close();
      void unmarked.stream.close();
    });

    it('turns what it heard before the answer into the answer\'s state: unknown becomes replaying when markers will come, and stays unknown when they will not', async () => {
      vi.useFakeTimers();
      const yes = open();
      event(yes.stream, SOURCE_ADDED, 'a/app');
      vi.advanceTimersByTime(60);
      expect(replayOf(yes.stream)).toEqual(['a/app:unknown']);
      await yes.created([], true);
      vi.advanceTimersByTime(60);
      expect(replayOf(yes.stream)).toEqual(['a/app:replaying']);

      const no = open();
      event(no.stream, SOURCE_ADDED, 'a/app');
      await no.created([], false);
      vi.advanceTimersByTime(60);
      expect(replayOf(no.stream)).toEqual(['a/app:unknown']);
      void yes.stream.close();
      void no.stream.close();
    });
  });

  describe('the lines a rate may count', () => {
    it('are none for a session without markers: its lines say nothing of replay, and the stream makes no count of them', async () => {
      vi.useFakeTimers();
      const { stream, created } = open();
      await created([{ id: 'a/app', labels: {} }]);
      lines(stream, 'a/app', 50, false);
      expect(stream.stats()).toEqual({ received: 50, dropped: 0, held: 50, live: undefined });
      // A kind 7 it was never going to get is still the backend's word: nothing else would make this source live.
      void stream.close();
    });

    it('are none until a source is caught up, then the lines of that source that are not flagged: the replay is never counted, flagged or not', async () => {
      const stream = await accepted(['a/app']);
      lines(stream, 'a/app', 1000, true);
      lines(stream, 'a/app', 5, false);
      // Nothing is live yet: the source has not said its replay is over, and a line it sends unflagged before that is not taken for live either.
      expect(stream.stats().live).toBeUndefined();
      expect(stream.stats().received).toBe(1005);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      expect(stream.stats().live).toBe(0);
      lines(stream, 'a/app', 5, false);
      expect(stream.stats().live).toBe(5);
      lines(stream, 'a/app', 3, true);
      expect(stream.stats().live).toBe(5);
      void stream.close();
    });

    it('survive an event that overtakes the end of the replay: the host batches lines and sends events at once, so the tail of the replay arrives after the word that it is over', async () => {
      const stream = await accepted(['a/app']);
      lines(stream, 'a/app', 50, true);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      // The rest of the replay, flagged, and the first live lines, in one batch.
      emit(
        stream.id,
        'lines',
        JSON.stringify([
          ...Array.from({ length: 50 }, (_, index) => wireLine(index, { source_id: 'a/app', replay: true })),
          ...Array.from({ length: 5 }, (_, index) => wireLine(100 + index, { source_id: 'a/app' })),
        ]),
      );
      expect(stream.stats()).toEqual({ received: 105, dropped: 0, held: 105, live: 5 });
      void stream.close();
    });

    it('are counted when the stream accepts them, whoever reads: a stream nobody reads, a paused one, and lines the bound drops all count', async () => {
      const stream = await accepted(['a/app'], { maxBufferedLines: 10 });
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      stream.pause();
      lines(stream, 'a/app', 100, false);
      expect(stream.stats()).toEqual({ received: 100, dropped: 90, held: 10, live: 100 });
      stream.resume();
      void stream.close();
    });

    it('are those of the sources that are caught up, with two sources interleaved: the other one contributes nothing until its own word', async () => {
      const stream = await accepted(['a/app', 'b/app']);
      lines(stream, 'a/app', 10, true);
      lines(stream, 'b/app', 10, true);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      lines(stream, 'a/app', 4, false);
      lines(stream, 'b/app', 7, false);
      // b is still replaying: its lines are not the rate, though they are not flagged.
      expect(stream.stats().live).toBe(4);
      expect(replayOf(stream)).toEqual(['a/app:live', 'b/app:replaying']);
      lines(stream, 'b/app', 3, true);
      event(stream, SOURCE_CAUGHT_UP, 'b/app');
      lines(stream, 'b/app', 6, false);
      lines(stream, 'a/app', 1, false);
      expect(stream.stats().live).toBe(4 + 6 + 1);
      expect(replayOf(stream)).toEqual(['a/app:live', 'b/app:live']);
      void stream.close();
    });

    it('are none for a line that names no source, and none from a source that failed, ended or was removed', async () => {
      const stream = await accepted(['a/app', 'b/app', 'c/app', 'd/app']);
      for (const id of ['a/app', 'b/app', 'c/app', 'd/app']) {
        event(stream, SOURCE_CAUGHT_UP, id);
      }
      lines(stream, '', 5, false);
      expect(stream.stats().live).toBe(0);
      event(stream, STREAM_ERROR, 'a/app', 'denied');
      event(stream, STREAM_ENDED, 'b/app');
      event(stream, SOURCE_REMOVED, 'c/app');
      lines(stream, 'a/app', 3, false);
      lines(stream, 'b/app', 3, false);
      lines(stream, 'c/app', 3, false);
      expect(stream.stats().live).toBe(0);
      lines(stream, 'd/app', 3, false);
      expect(stream.stats().live).toBe(3);
      // The last source that was live ends: the stream is left with no source whose lines make a rate.
      event(stream, STREAM_ENDED, 'd/app');
      expect(stream.stats().live).toBeUndefined();
      void stream.close();
    });
  });

  describe('the marker of a source', () => {
    it('for a source the stream never heard of makes it known and live: the backend said it, and nothing is guessed about the others', async () => {
      const stream = await accepted(['a/app']);
      event(stream, SOURCE_CAUGHT_UP, 'ghost/app');
      vi.advanceTimersByTime(60);
      expect(replayOf(stream)).toEqual(['a/app:replaying', 'ghost/app:live']);
      lines(stream, 'a/app', 4, false);
      lines(stream, 'ghost/app', 2, false);
      expect(stream.stats().live).toBe(2);
      void stream.close();
    });

    it('a marker that names no source is no marker of any source, and proves nothing about the session', async () => {
      const stream = await accepted(['a/app']);
      const before = stream.getSnapshot();
      event(stream, SOURCE_CAUGHT_UP, '');
      vi.advanceTimersByTime(100);
      expect(stream.getSnapshot()).toBe(before);
      expect(stream.stats().live).toBeUndefined();
      // Before the answer, a marker of nothing is not the backend's word that markers come: only one that names a source is.
      vi.useFakeTimers();
      const pending = open();
      event(pending.stream, SOURCE_CAUGHT_UP, '');
      vi.advanceTimersByTime(100);
      expect(pending.stream.getSnapshot().markers).toBe('pending');
      void stream.close();
      void pending.stream.close();
    });

    it('is not taken back by an answer that says otherwise: a marker is the backend\'s own word, and an answer that contradicts it changes nothing', async () => {
      vi.useFakeTimers();
      const { stream, created } = open();
      event(stream, SOURCE_ADDED, 'a/app');
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      await created([{ id: 'a/app', labels: {} }], false);
      vi.advanceTimersByTime(60);
      expect(stream.getSnapshot().markers).toBe('yes');
      lines(stream, 'a/app', 3, false);
      expect(stream.stats().live).toBe(3);
      void stream.close();
    });

    it('arriving twice changes nothing: the second tells nobody, the snapshot stays, and the count goes on', async () => {
      const stream = await accepted(['a/app']);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      // The first line of a source moves it from connecting to streaming, and the stream from starting to streaming: those are changes of their own, let them be told first.
      lines(stream, 'a/app', 3, false);
      vi.advanceTimersByTime(60);
      const woken = vi.fn();
      stream.subscribe(woken);
      const before = stream.getSnapshot();
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      lines(stream, 'a/app', 2, false);
      vi.advanceTimersByTime(100);
      expect(stream.getSnapshot()).toBe(before);
      expect(woken).not.toHaveBeenCalled();
      expect(stream.stats().live).toBe(5);
      void stream.close();
    });

    it('before the answer to the create call is the backend\'s word that markers are on: the answer then says the same', async () => {
      vi.useFakeTimers();
      const { stream, created } = open();
      event(stream, SOURCE_ADDED, 'a/app');
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      vi.advanceTimersByTime(60);
      expect(stream.getSnapshot().markers).toBe('yes');
      expect(replayOf(stream)).toEqual(['a/app:live']);
      await created([{ id: 'a/app', labels: {} }], true);
      vi.advanceTimersByTime(60);
      expect(stream.getSnapshot().markers).toBe('yes');
      expect(replayOf(stream)).toEqual(['a/app:live']);
      void stream.close();
    });

    it('is published once for a burst of sources: 500 caught up are one change', async () => {
      const stream = await accepted(Array.from({ length: 500 }, (_, index) => `pod-${String(index)}/app`));
      const woken = vi.fn();
      stream.subscribe(woken);
      for (let index = 0; index < 500; index++) {
        event(stream, SOURCE_CAUGHT_UP, `pod-${String(index)}/app`);
      }
      expect(woken).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(woken).toHaveBeenCalledTimes(1);
      expect(stream.getSnapshot().sources.every((source) => source.replay === 'live')).toBe(true);
      void stream.close();
    });
  });

  describe('a source that opens again', () => {
    it('is replaying again from the word that it reconnects, and live again at its next marker: the replay it delivers again is not counted, and the count goes on from where it was', async () => {
      const stream = await accepted(['a/app']);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      lines(stream, 'a/app', 20, false);
      expect(stream.stats().live).toBe(20);
      event(stream, RECONNECTING, 'a/app', 'Reconnecting (attempt 1/5)');
      vi.advanceTimersByTime(60);
      expect(replayOf(stream)).toEqual(['a/app:replaying']);
      // The only source is not live: there is no rate to tell, and no number to tell it from.
      expect(stream.stats().live).toBeUndefined();
      event(stream, RECONNECTED, 'a/app');
      lines(stream, 'a/app', 1000, true);
      lines(stream, 'a/app', 4, false);
      expect(stream.stats().live).toBeUndefined();
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      expect(stream.stats().live).toBe(20);
      lines(stream, 'a/app', 7, false);
      expect(stream.stats().live).toBe(27);
      expect(stream.stats().received).toBe(20 + 1000 + 4 + 7);
      void stream.close();
    });

    it('leaves the other sources live and counted while one of them reconnects', async () => {
      const stream = await accepted(['a/app', 'b/app']);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      event(stream, SOURCE_CAUGHT_UP, 'b/app');
      event(stream, RECONNECTING, 'a/app');
      lines(stream, 'a/app', 500, true);
      lines(stream, 'b/app', 5, false);
      expect(stream.stats().live).toBe(5);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      lines(stream, 'a/app', 2, false);
      expect(stream.stats().live).toBe(7);
      void stream.close();
    });

    it('is replaying again from the word that it reconnected alone: a burst of events can take the word that it was reconnecting', async () => {
      const stream = await accepted(['a/app']);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      expect(stream.stats().live).toBe(0);
      event(stream, RECONNECTED, 'a/app');
      vi.advanceTimersByTime(60);
      expect(replayOf(stream)).toEqual(['a/app:replaying']);
      expect(stream.stats().live).toBeUndefined();
      void stream.close();
    });

    it('is replaying again when it is removed and enabled again, and live at its next marker', async () => {
      const stream = await accepted(['a/app']);
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      event(stream, SOURCE_REMOVED, 'a/app');
      vi.advanceTimersByTime(60);
      expect(stream.stats().live).toBeUndefined();
      event(stream, SOURCE_ADDED, 'a/app');
      vi.advanceTimersByTime(60);
      expect(replayOf(stream)).toEqual(['a/app:replaying']);
      lines(stream, 'a/app', 100, true);
      expect(stream.stats().live).toBeUndefined();
      event(stream, SOURCE_CAUGHT_UP, 'a/app');
      expect(stream.stats().live).toBe(0);
      lines(stream, 'a/app', 3, false);
      expect(stream.stats().live).toBe(3);
      void stream.close();
    });
  });

  describe('a source that is never marked', () => {
    it('stays replaying for as long as it lasts, and is never turned live by the time that passes: the stream says nothing more than "no rate", no error and no cause', async () => {
      const stream = await accepted(['a/app']);
      // The interim of a plugin that cannot count a source's replay in time: every line of that opening is flagged, the live ones too, and no event comes.
      for (let minute = 0; minute < 10; minute++) {
        lines(stream, 'a/app', 600, true);
        vi.advanceTimersByTime(60_000);
      }
      expect(replayOf(stream)).toEqual(['a/app:replaying']);
      expect(stream.stats().live).toBeUndefined();
      expect(stream.getSnapshot()).toMatchObject({ state: 'streaming', cause: undefined, markers: 'yes' });
      void stream.close();
    });
  });

  describe('a line', () => {
    it('carries the flag the backend gave it, as the backend gave it: only `replay: true` is replay', async () => {
      const { stream, created } = open();
      await created([], true);
      emit(
        stream.id,
        'lines',
        JSON.stringify([wireLine(1), wireLine(2, { replay: true }), wireLine(3, { replay: false }), wireLine(4, { replay: 'true' }), wireLine(5, { replay: 1 })]),
      );
      expect(stream.read(10).lines.map((line) => line.replay)).toEqual([false, true, false, false, false]);
      void stream.close();
    });
  });
});

describe('close', () => {
  it('releases every listener it took, now, and closes the session once', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 10));
    const subscribed = vi.fn();
    const unsubscribe = stream.subscribe(subscribed);
    expect(listenerCount()).toBe(2);
    const closing = stream.close();
    expect(listenerCount()).toBe(0);
    expect(stream.close()).toBe(closing);
    await closing;
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(transport.call.mock.calls[0]?.[1]).toBe(stream.id);
    // The last status reached the subscriber, and it hears nothing after.
    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(stream.getSnapshot().state).toBe('ended');
    emit(stream.id, 'lines', batch(11, 10));
    event(stream, STREAM_ERROR, '', 'late');
    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(stream.getSnapshot().state).toBe('ended');
    unsubscribe();
  });

  it('is deaf, empty and still afterwards', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 10));
    await stream.close();
    expect(stream.read(10)).toEqual({ lines: [], dropped: 0, held: 0 });
    expect(stream.stats().held).toBe(0);
    stream.pause();
    stream.resume();
    expect(stream.getSnapshot().paused).toBe(false);
    const late = vi.fn();
    stream.subscribe(late)();
    stream.subscribe(late);
    expect(late).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it('cancels the call that is still out, waits for it, then closes the session', async () => {
    const { stream, creation } = open();
    const order: string[] = [];
    creation.oncancelled = () => {
      order.push('cancelled');
    };
    transport.call.mockImplementation(() => {
      order.push('closed');
      return Promise.resolve();
    });
    const closing = stream.close();
    expect(listenerCount()).toBe(0);
    await closing;
    expect(order).toEqual(['cancelled', 'closed']);
    expect(stream.getSnapshot().state).toBe('ended');
  });

  it('is ignored when the call settles after the close', async () => {
    const { stream, creation } = open();
    const closing = stream.close();
    creation.resolve({ id: stream.id, active_sources: [{ id: 'late', labels: {} }] });
    await closing;
    await settle();
    expect(stream.getSnapshot().sources).toEqual([]);
    expect(listenerCount()).toBe(0);
  });

  it('asks the backend for nothing when the session never opened', async () => {
    const { stream, creation } = open();
    creation.reject(new Error('refused'));
    await settle();
    await stream.close();
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('does not mind a session the backend no longer knows, and rejects for any other refusal', async () => {
    const gone = open();
    await gone.created();
    transport.call.mockRejectedValueOnce(new Error(JSON.stringify({ type: 'urn:omniview:not-found', title: 'Not found', status: 404, detail: 'log session not found' })));
    await expect(gone.stream.close()).resolves.toBeUndefined();

    const refused = open();
    await refused.created();
    const failure = new Error(JSON.stringify({ type: 'urn:omniview:internal', title: 'Internal', status: 500, detail: 'boom' }));
    transport.call.mockRejectedValueOnce(failure);
    await expect(refused.stream.close()).rejects.toBe(failure);
    // Closed all the same.
    expect(refused.stream.getSnapshot().state).toBe('ended');
    expect(listenerCount()).toBe(0);
  });

  it('leaves no listener behind when a stream is opened and closed a hundred times', async () => {
    for (let index = 0; index < 100; index++) {
      const { stream, created } = open();
      await created();
      emit(stream.id, 'lines', batch(1, 3));
      stream.subscribe(() => undefined);
      await stream.close();
    }
    expect(listenerCount()).toBe(0);
  });
});

// The guards docs/ui-next/optimisations.md names for the rows this entry carries (HLT-5, 6, 8, 20; HGO-32, 33).
describe('what the inventory asks of it', () => {
  it('HLT-6: 200,000 lines while paused hold 100,000, make no wake-up, and come out in slices without a RangeError', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 100));
    stream.read(100);
    const woken = vi.fn();
    stream.subscribe(woken);
    stream.pause();
    woken.mockClear();
    let peak = 0;
    for (let index = 0; index < 2000; index++) {
      emit(stream.id, 'lines', batch(101 + index * 100, 100));
      peak = Math.max(peak, stream.stats().held);
    }
    expect(peak).toBe(100_000);
    expect(woken).not.toHaveBeenCalled();
    expect(stream.stats()).toMatchObject({ received: 200_100, dropped: 100_100 - 100, held: 100_000 });
    stream.resume();
    let total = 0;
    let dropped = 0;
    let largest = 0;
    for (let read = stream.read(1000); read.lines.length > 0; read = stream.read(1000)) {
      total += read.lines.length;
      dropped += read.dropped;
      largest = Math.max(largest, read.lines.length);
    }
    expect(total).toBe(100_000);
    expect(largest).toBe(1000);
    expect(dropped).toBe(100_000);
    expect(stream.stats().held).toBe(0);
    void stream.close();
  });

  it('HGO-33: a pause is local; the backend is not told to pause, which would make it throw lines away', async () => {
    const { stream, created } = open();
    await created();
    stream.pause();
    stream.resume();
    expect(transport.call).not.toHaveBeenCalled();
    void stream.close();
  });

  it('HLT-5: decodes each batch once, and each event once', async () => {
    const { stream, created } = open();
    await created();
    const batches = Array.from({ length: 100 }, (_, index) => batch(1 + index * 100, 100));
    const parse = vi.spyOn(JSON, 'parse');
    for (const each of batches) {
      emit(stream.id, 'lines', each);
    }
    event(stream, SESSION_READY);
    expect(parse).toHaveBeenCalledTimes(101);
    expect(stream.stats().received).toBe(10_000);
  });

  it('HLT-8: stays ready, and knows every source, after more than 100 events', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    event(stream, SESSION_READY);
    for (let index = 0; index < 150; index++) {
      event(stream, SOURCE_ADDED, `pod-${String(index)}/app`);
    }
    for (let index = 0; index < 150; index++) {
      event(stream, RECONNECTING, `pod-${String(index)}/app`, 'again');
    }
    vi.advanceTimersByTime(60);
    expect(stream.getSnapshot().state).toBe('streaming');
    expect(stream.getSnapshot().sources).toHaveLength(150);
    expect(new Set(stream.getSnapshot().sources.map((source) => source.state))).toEqual(new Set(['reconnecting']));
    void stream.close();
  });

  it('HLT-20: starts from the latest 1,000 lines unless told otherwise', () => {
    const { stream } = open();
    const sent: { options: { tail_lines: number } } = JSON.parse(transport.create.mock.calls[0]![3]);
    expect(sent.options.tail_lines).toBe(1000);
    void stream.close();
  });

  it('HGO-32: names the session before the call leaves, and a second stream is a second session', () => {
    const first = open();
    const second = open();
    expect(first.stream.id).not.toBe(second.stream.id);
    const ids = transport.create.mock.calls.map((call) => {
      const sent: { session_id: string } = JSON.parse(call[3]);
      return sent.session_id;
    });
    expect(ids).toEqual([first.stream.id, second.stream.id]);
    void first.stream.close();
    void second.stream.close();
  });

  it('does not list a source for a line that names none', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', JSON.stringify([wireLine(1, { source_id: '', labels: undefined }), wireLine(2, { source_id: '' })]));
    vi.advanceTimersByTime(60);
    expect(stream.read(10).lines.map((line) => line.source)).toEqual(['', '']);
    expect(stream.getSnapshot().sources).toEqual([]);
    expect(stream.getSnapshot().state).toBe('streaming');
    void stream.close();
  });
});

// Found in the review of #543. Each of these was written first and seen to fail against the code it is about.
describe('what a source is, as the events, the lines and the answer to the create call name it', () => {
  const labels = { pod: 'web-0', container: 'app', namespace: 'default', node: 'node-1' };
  const sourcesOf = (stream: LogStream): string[] => stream.getSnapshot().sources.map((source) => `${source.id}:${source.state}`);

  it('learns the labels the create answer gives a source that an event named first', async () => {
    vi.useFakeTimers();
    const { stream, creation } = open();
    event(stream, SOURCE_ADDED, 'web-0/app');
    event(stream, RECONNECTING, 'web-0/app', 'Reconnecting (attempt 1/5)');
    creation.resolve({ id: stream.id, active_sources: [{ id: 'web-0/app', labels }] });
    await settle();
    vi.advanceTimersByTime(60);
    expect(stream.getSnapshot().sources).toEqual([{ id: 'web-0/app', labels, state: 'reconnecting', message: 'Reconnecting (attempt 1/5)', replay: 'unknown' }]);
    void stream.close();
  });

  it('learns the labels from the first line of a source that reconnected before it spoke', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    event(stream, SOURCE_ADDED, 'web-0/app');
    event(stream, RECONNECTING, 'web-0/app', 'Reconnecting (attempt 1/5)');
    event(stream, RECONNECTED, 'web-0/app');
    emit(stream.id, 'lines', batch(1, 3));
    vi.advanceTimersByTime(60);
    expect(stream.getSnapshot().sources).toEqual([{ id: 'web-0/app', labels, state: 'streaming', replay: 'unknown' }]);
    void stream.close();
  });

  it('takes the labels from the first line that has any, and not from the ones after it', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', JSON.stringify([wireLine(1, { labels: null }), wireLine(2, { labels: {} })]));
    expect(stream.getSnapshot().sources.map((source) => source.labels)).toEqual([{}]);
    emit(stream.id, 'lines', JSON.stringify([wireLine(3), wireLine(4, { labels: { pod: 'other' } })]));
    vi.advanceTimersByTime(60);
    expect(stream.getSnapshot().sources.map((source) => source.labels)).toEqual([labels]);
    void stream.close();
  });

  it('says nothing more about a source whose labels are known, or that never has any, however many lines it sends', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    // Two lines in a row that name no source: the source they belong to is one shared record, which no line may give labels.
    const lines = [wireLine(1), wireLine(2, { source_id: 'bare', labels: null }), wireLine(3, { source_id: '' }), wireLine(4, { source_id: '' })];
    emit(stream.id, 'lines', JSON.stringify(lines));
    vi.advanceTimersByTime(60);
    const before = stream.getSnapshot();
    for (let index = 0; index < 50; index++) {
      emit(stream.id, 'lines', JSON.stringify(lines));
    }
    vi.advanceTimersByTime(100);
    expect(stream.getSnapshot()).toBe(before);
    expect(before.sources.map((source) => source.id)).toEqual(['web-0/app', 'bare']);
    void stream.close();
  });

  it('ends every source that was still going when the session ends, and leaves a failed or a removed one as it was', async () => {
    vi.useFakeTimers();
    const { stream, created } = open();
    await created();
    for (const id of ['a/app', 'b/app', 'c/app', 'd/app', 'e/app']) {
      event(stream, SOURCE_ADDED, id);
    }
    emit(stream.id, 'lines', JSON.stringify([wireLine(1, { source_id: 'a/app' })]));
    event(stream, RECONNECTING, 'b/app', 'Reconnecting (attempt 1/5)');
    event(stream, STREAM_ERROR, 'c/app', 'Failed to reconnect after 5 attempts');
    event(stream, SOURCE_REMOVED, 'd/app');
    event(stream, STREAM_ENDED);
    expect(stream.getSnapshot().state).toBe('ended');
    expect(sourcesOf(stream)).toEqual(['a/app:ended', 'b/app:ended', 'c/app:failed', 'd/app:removed', 'e/app:ended']);
    expect(stream.getSnapshot().sources[1]?.message).toBeUndefined();
    expect(stream.getSnapshot().sources[2]?.message).toBe('Failed to reconnect after 5 attempts');
    // The host sends the end ahead of the last batch: its lines still come, and a source first heard of in it is over too.
    emit(stream.id, 'lines', JSON.stringify([wireLine(2, { source_id: 'a/app' }), wireLine(3, { source_id: 'f/app' })]));
    vi.advanceTimersByTime(60);
    expect(stream.read(10).lines.map((line) => line.source)).toEqual(['a/app', 'a/app', 'f/app']);
    expect(sourcesOf(stream)).toEqual(['a/app:ended', 'b/app:ended', 'c/app:failed', 'd/app:removed', 'e/app:ended', 'f/app:ended']);
    expect(stream.getSnapshot().state).toBe('ended');
    void stream.close();
  });

  it('lists the sources of a create answer that comes after the end of the session as ended', async () => {
    vi.useFakeTimers();
    const { stream, creation } = open();
    emit(stream.id, 'lines', batch(1, 2));
    event(stream, STREAM_ENDED);
    creation.resolve({ id: stream.id, active_sources: [{ id: 'web-0/app', labels }, { id: 'web-0/sidecar', labels: { ...labels, container: 'sidecar' } }] });
    await settle();
    vi.advanceTimersByTime(60);
    expect(sourcesOf(stream)).toEqual(['web-0/app:ended', 'web-0/sidecar:ended']);
    void stream.close();
  });

  it('ends the sources of a stream that is closed', async () => {
    const { stream, created } = open();
    await created();
    emit(stream.id, 'lines', batch(1, 2));
    expect(sourcesOf(stream)).toEqual(['web-0/app:streaming']);
    await stream.close();
    expect(stream.getSnapshot().state).toBe('ended');
    expect(sourcesOf(stream)).toEqual(['web-0/app:ended']);
  });
});

describe('a subscriber that closes the stream when it hears it end', () => {
  it('is given the answer already reserved: one more notification, and one close of the session', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { stream, created } = open();
    await created();
    let notified = 0;
    const answers: Array<Promise<void>> = [];
    stream.subscribe(() => {
      notified++;
      // On every notification, as a careless subscriber would; the bound only keeps a run against code that recurses short.
      if (notified < 50) {
        answers.push(stream.close());
      }
    });
    event(stream, STREAM_ENDED);
    await Promise.all(answers);
    expect(notified).toBe(2);
    expect(new Set(answers).size).toBe(1);
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it('is given the same answer when it closes the stream in reply to the close it hears, and the session is closed once', async () => {
    const { stream, created } = open();
    await created();
    let nested: Promise<void> | undefined;
    stream.subscribe(() => {
      nested ??= stream.close();
    });
    const outer = stream.close();
    expect(nested).toBe(outer);
    await outer;
    expect(transport.call).toHaveBeenCalledTimes(1);
  });
});
