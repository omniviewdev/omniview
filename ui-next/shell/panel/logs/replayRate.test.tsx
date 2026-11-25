import { ThemeProvider } from '@omniviewdev/kit';
import { openLogStream, type LogStream } from '@omniviewdev/runtime/ui/v1';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import type * as WailsRuntime from '@wailsio/runtime';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../core/panel';
import { createLogStreams } from './LogStreams';
import { LogsBody } from './LogsBody';
import { LOGS_TOOL } from './tool';

// The two ends of the log path together (S1-host): the runtime's REAL stream (`openLogStream`, over a transport this test drives as the host's Go lane would: lines in batches, events at once, the caught-up
// event overtaking the lines before it) read by the host's REAL Logs body and the kit's real view, and the strip's text read every 250 ms. The unit tests of each end say what each does with a word of the
// backend; this says what the user reads when the words come in the orders a real host and a real plugin make: a replay of thousands of lines, a marker that overtakes the end of it, a second container
// whose replay comes after the first one's first live line, a marker that never comes, a source that reconnects, a view that is hidden. The end-state invariant of all of them is the same: the strip never reads
// above twice the rate the sources make, and says no rate, in the mock's words, whenever the backend has not said what the rate is.

type Listener = (event: { data: unknown }) => void;
const transport = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  create: vi.fn<(method: string, plugin: string, connection: string, encodedRequest: string) => unknown>(),
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    // The create call is the one the test settles by hand; the close of a session (the only other call the stream makes) is the library's own, which has nothing to reach here.
    Call: { ...actual.Call, ByName: transport.create },
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

const LIST = { height: 625, header: 25, row: 24 };
const isList = (element: Element) => element.getAttribute('role') === 'grid';
const isProbe = (element: Element) => element.getAttribute('aria-hidden') === 'true' && element.parentElement !== null && isList(element.parentElement);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: function get(this: HTMLElement) {
      return isList(this) ? LIST.height : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: function get(this: HTMLElement) {
      return this.getAttribute('aria-rowindex') === '1' ? LIST.header : 0;
    },
  });
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const height = isProbe(this) ? LIST.row : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  transport.listeners.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The SDK's event kinds the stream reads.
const SOURCE_ADDED = 0;
const RECONNECTING = 3;
const RECONNECTED = 4;
const SOURCE_CAUGHT_UP = 7;

const LABELS = { thing: 'orders', part: 'app' };

type Harness = {
  readonly stream: LogStream;
  /** The create call's answer: the sources it lists and whether markers will come. */
  readonly created: (sources: readonly string[], markers: boolean | undefined) => Promise<void>;
  readonly show: (visible: boolean) => void;
  /** Lines as the host's lane emits a batch: one JSON string. */
  readonly lines: (source: string, count: number, replay: boolean) => void;
  /** An event as the lane emits it: at once, as its own payload. */
  readonly event: (type: number, source: string) => void;
  /** The strip's text. */
  readonly strip: () => string;
  /** Moves the clocks `ms` forward in steps of 16 ms (one frame), so every timer and frame that falls due runs. */
  readonly advance: (ms: number) => void;
};

function open(): Harness {
  const creation = CancellablePromise.withResolvers<{ id: string; active_sources: Array<{ id: string; labels: Record<string, string> }>; replay_markers?: boolean } | null>();
  transport.create.mockReturnValue(creation.promise);
  const stream = openLogStream({ plugin: 'acme', connection: 'c1', resourceKey: 'item', resourceId: 'orders-api' });
  const store = createPanelStore();
  store.registerTool(LOGS_TOOL);
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  const streams = createLogStreams(store);
  streams.attach();
  const opened = streams.open({ plugin: 'acme', id: 'item/orders-api', title: 'orders-api', scope: '', open: () => stream });
  const id = opened === undefined ? '' : 'id' in opened ? opened.id : '';
  const session = store.getSnapshot().sessions[id];
  if (session === undefined) {
    throw new Error('the session did not open');
  }

  const body = (visible: boolean): ReactElement => (
    <ThemeProvider>
      <LogsBody streams={streams} session={store.getSnapshot().sessions[id] ?? session} visible={visible} />
    </ThemeProvider>
  );
  const view = render(body(true));
  const emit = (channel: 'lines' | 'event', data: unknown): void => {
    act(() => {
      for (const listener of [...(transport.listeners.get(`core/logs/${channel}/${stream.id}`) ?? [])]) {
        listener({ data });
      }
    });
  };

  return {
    stream,
    created: async (sources, markers) => {
      creation.resolve({ id: stream.id, active_sources: sources.map((source) => ({ id: source, labels: LABELS })), ...(markers === undefined ? {} : { replay_markers: markers }) });
      for (let turn = 0; turn < 8; turn++) {
        await Promise.resolve();
      }
    },
    show: (visible) => {
      act(() => {
        view.rerender(body(visible));
      });
    },
    lines: (source, count, replay) => {
      emit(
        'lines',
        JSON.stringify(
          Array.from({ length: count }, (_, index) => ({
            session_id: 's',
            source_id: source,
            labels: LABELS,
            timestamp: '2026-11-22T10:00:00.123456789Z',
            content: `line ${String(index)}`,
            origin: 0,
            level: 0,
            ...(replay ? { replay: true } : {}),
          })),
        ),
      );
    },
    event: (type, source) => {
      emit('event', JSON.stringify({ type, source_id: source, message: '', timestamp: '2026-11-22T10:00:00Z' }));
    },
    strip: () => screen.getByRole('group', { name: 'Session status' }).textContent,
    advance: (ms) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) {
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
    },
  };
}

/** The number of lines/s the strip says, or undefined when it says no rate. */
function rateOf(text: string): number | undefined {
  if (text.includes('No rate')) {
    return undefined;
  }

  const found = /([\d,.]+) lines\/s/.exec(text);
  if (found === null) {
    throw new Error(`the strip says neither a rate nor that there is none: ${JSON.stringify(text)}`);
  }

  return Number(found[1].replace(/,/g, ''));
}

/**
 * Runs `seconds` of the sources writing: for each `[source, perSecond]` a line every 1000 / perSecond ms, delivered as the lane does (a batch is one emit, the lines of a 50 ms flush together), and reads the
 * strip every 250 ms. `between` runs at each 50 ms step with the time since the start of this run, for what the scenario does to the wire in the meantime (a marker, a replay, a reconnect).
 */
function run(h: Harness, seconds: number, writing: ReadonlyArray<readonly [string, number]>, between: (ms: number) => void = () => undefined): Array<number | undefined> {
  const tells: Array<number | undefined> = [];
  const due = new Map(writing.map(([source, perSecond]) => [source, { every: 1000 / perSecond, next: 1000 / perSecond }]));
  for (let ms = 50; ms <= seconds * 1000; ms += 50) {
    for (const [source, timing] of due) {
      let count = 0;
      while (timing.next <= ms) {
        count += 1;
        timing.next += timing.every;
      }

      if (count > 0) {
        h.lines(source, count, false);
      }
    }

    between(ms);
    h.advance(50);
    if (ms % 250 === 0) {
      tells.push(rateOf(h.strip()));
    }
  }

  return tells;
}

const figures = (tells: ReadonlyArray<number | undefined>): number[] => tells.filter((tell): tell is number => tell !== undefined);

describe('the strip of a Logs session, from the wire to the words on it (S1)', () => {
  it('never reads above twice the true rate for a source with a replay of thousands of lines whose marker overtakes the end of it, and settles on the true rate', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.event(SOURCE_ADDED, 'orders/app');
    // The host batches lines (100, or 50 ms) and sends the event at once: the marker is in the window before the tail of the replay is.
    let replayed = 0;
    const tells = run(h, 15, [['orders/app', 5]], (ms) => {
      if (ms <= 1000) {
        for (let batch = 0; batch < 5; batch++) {
          h.lines('orders/app', 100, true);
          replayed += 100;
        }
      }

      if (ms === 600) {
        h.event(SOURCE_CAUGHT_UP, 'orders/app');
      }
    });
    expect(replayed).toBe(10_000);
    expect(Math.max(...figures(tells))).toBeLessThanOrEqual(10);
    expect(tells.at(-1)).toBeGreaterThanOrEqual(3.5);
    expect(tells.at(-1)).toBeLessThanOrEqual(6.5);
    expect(tells.slice(-20).every((tell) => tell !== undefined && tell >= 3.5 && tell <= 6.5)).toBe(true);
    // The lines are all there: the replay is not hidden, only left out of the rate.
    expect(h.strip()).toMatch(/^[\d,]+ lines? · /);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('says no rate before the backend says anything, then a rate from its word on, and never a rate made of the lines that came before it', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.lines('orders/app', 1000, true);
    h.advance(300);
    expect(rateOf(h.strip())).toBeUndefined();
    expect(h.strip()).toContain('No rate');
    // Live lines that come before the source's word are not the rate's either: the source is still replaying as far as the backend says.
    const waiting = run(h, 2, [['orders/app', 5]]);
    expect(waiting.every((tell) => tell === undefined)).toBe(true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    const after = run(h, 8, [['orders/app', 5]]);
    expect(Math.max(...figures(after))).toBeLessThanOrEqual(10);
    expect(after.at(-1)).toBeGreaterThanOrEqual(3.5);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('does not count the replay of a second container that arrives after the first one\'s first live line: no tell reads above twice the rate the two make', async () => {
    const h = open();
    await h.created(['orders/app', 'orders/sidecar'], true);
    h.lines('orders/app', 1000, true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    // Container a is live and writes 5 a second. At 3 s the replay of container b (a thousand lines, flagged) reaches the window, then b's marker, then b writes 5 a second too.
    const tells = run(h, 14, [['orders/app', 5]], (ms) => {
      if (ms === 3000) {
        for (let batch = 0; batch < 10; batch++) {
          h.lines('orders/sidecar', 100, true);
        }
      }

      if (ms === 3500) {
        h.event(SOURCE_CAUGHT_UP, 'orders/sidecar');
      }
    });
    // While b replays (3 s to 3.5 s) only a's lines are counted: at most twice a's 5; after b's word the two make 10, and the strip may read up to twice that.
    expect(Math.max(...tells.slice(0, 14).filter((tell): tell is number => tell !== undefined))).toBeLessThanOrEqual(10);
    expect(Math.max(...figures(tells))).toBeLessThanOrEqual(20);
    expect(tells.at(-1)).toBeGreaterThanOrEqual(3.5);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('says no rate for as long as a source is never marked: the interim of a plugin that could not count its replay, which flags every line of the opening and says nothing', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.event(SOURCE_ADDED, 'orders/app');
    h.lines('orders/app', 3000, true);
    const tells = run(h, 30, [['orders/app', 5]]);
    // Its live lines arrive unflagged here: still no word, so still no rate. (The plugin that cannot count flags them; either way nothing is counted.)
    expect(tells.every((tell) => tell === undefined)).toBe(true);
    expect(h.strip()).toMatch(/^[\d,]+ lines · No rate · Following$/);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('says no rate, and draws and follows as ever, for a plugin that sends no markers at all: only the rate is unknown', async () => {
    const h = open();
    await h.created(['orders/app'], undefined);
    h.lines('orders/app', 1000, false);
    const tells = run(h, 10, [['orders/app', 5]]);
    expect(tells.every((tell) => tell === undefined)).toBe(true);
    expect(h.strip()).toMatch(/^1,0\d\d lines · No rate · Following$/);
    expect(h.stream.getSnapshot().markers).toBe('no');
    expect(h.stream.getSnapshot().sources.map((source) => source.replay)).toEqual(['unknown']);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('goes from a rate to no rate to a rate again when the source reconnects, and its replay, delivered again, is no spike', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.lines('orders/app', 1000, true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    const before = run(h, 6, [['orders/app', 5]]);
    expect(before.at(-1)).toBeGreaterThanOrEqual(3.5);
    h.event(RECONNECTING, 'orders/app');
    h.event(RECONNECTED, 'orders/app');
    const during = run(h, 2, [], () => {
      h.lines('orders/app', 100, true);
    });
    expect(during.every((tell) => tell === undefined)).toBe(true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    const after = run(h, 10, [['orders/app', 5]]);
    expect(Math.max(...figures([...before, ...during, ...after]))).toBeLessThanOrEqual(10);
    expect(after.at(-1)).toBeGreaterThanOrEqual(3.5);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('is not moved by a marker said twice, or by a marker for a source nobody listed: the rate stays the source\'s own', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    const tells = run(h, 12, [['orders/app', 5]], (ms) => {
      if (ms % 1000 === 0) {
        h.event(SOURCE_CAUGHT_UP, 'orders/app');
      }

      if (ms === 4000) {
        h.event(SOURCE_CAUGHT_UP, 'ghost/app');
      }
    });
    expect(tells.slice(8).every((tell) => tell !== undefined && tell >= 3.5 && tell <= 6.5)).toBe(true);
    expect(Math.max(...figures(tells))).toBeLessThanOrEqual(10);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('reads no burst when the view is hidden while the replay and the marker come, and shown again with the whole backlog to read', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.show(false);
    // Ten seconds out of sight: the replay (5,000 lines), the marker overtaking its tail, and the source's own lines, 5 a second.
    h.lines('orders/app', 2500, true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    h.lines('orders/app', 2500, true);
    for (let second = 0; second < 10; second++) {
      h.lines('orders/app', 5, false);
      h.advance(1000);
    }

    h.show(true);
    const tells = run(h, 12, [['orders/app', 5]]);
    expect(Math.max(...figures(tells))).toBeLessThanOrEqual(10);
    expect(tells.at(-1)).toBeGreaterThanOrEqual(3.5);
    expect(tells.at(-1)).toBeLessThanOrEqual(6.5);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });

  it('reads the late tail of a replay after the marker, as a hidden view that returns to it does, and the strip reads 0.0, not a rate', async () => {
    const h = open();
    await h.created(['orders/app'], true);
    h.event(SOURCE_CAUGHT_UP, 'orders/app');
    run(h, 4, [['orders/app', 5]]);
    h.show(false);
    h.lines('orders/app', 8000, true);
    h.advance(5000);
    h.show(true);
    const tells: Array<number | undefined> = [];
    for (let tell = 0; tell < 12; tell++) {
      h.advance(250);
      tells.push(rateOf(h.strip()));
    }

    expect(figures(tells).length).toBe(12);
    expect(figures(tells).every((tell) => tell === 0)).toBe(true);
    act(() => {
      h.stream.close().catch(() => undefined);
    });
  });
});
