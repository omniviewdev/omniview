import type { LogFeedBatch, LogFeedCause, LogFeedLine, LogFeedState, LogFeedStats } from '@omniviewdev/kit';
import type { LogFeedHandle, LogFeedHandleSnapshot, LogSourceName } from './feed';

// A feed for the tests of the Logs tool: it has the contract of a real one (consumer-paced `read`, a wake-up between two reads, a status that is the same object until it changes, a pause that is
// the reader's) and the counters a test asks for: how many listeners it has, how many times it was closed and read. Invented lines; nothing here is a plugin's.

export type FakeFeed = LogFeedHandle & {
  /** Listeners now: every `subscribe` not yet answered by its unsubscribe. */
  readonly listeners: () => number;
  /** How many times `close` was called. */
  readonly closed: () => number;
  /** How many times `read` was called. */
  readonly reads: () => number;
  /** How many times `pause` and `resume` were called. */
  readonly controls: () => number;
  /** A new status: only what is given changes, and every listener is told. */
  readonly set: (change: { readonly state?: LogFeedState; readonly paused?: boolean; readonly cause?: LogFeedCause | undefined; readonly sources?: readonly LogSourceName[] }) => void;
  /** Holds `count` lines for the reader and wakes the listeners once, until the next read. */
  readonly push: (count: number) => void;
  /** Tells the listeners without changing anything: what a feed does when held lines became readable. */
  readonly wake: () => void;
};

export type FakeFeedOptions = {
  readonly state?: LogFeedState | undefined;
  readonly sources?: readonly LogSourceName[] | undefined;
  /** What `close` does; default: nothing. */
  readonly close?: (() => Promise<void> | void) | undefined;
};

/** A feed that is `starting` (or in the state asked for), holds no line and lists no source. */
export function fakeFeed(options: FakeFeedOptions = {}): FakeFeed {
  const listeners = new Set<() => void>();
  let subscribed = 0;
  let closed = 0;
  let reads = 0;
  let controls = 0;
  let status: LogFeedHandleSnapshot = { state: options.state ?? 'starting', paused: false, cause: undefined, ...(options.sources === undefined ? {} : { sources: options.sources }) };
  let held: LogFeedLine[] = [];
  let seq = 0;
  let woken = false;
  let received = 0;

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      subscribed += 1;
      let live = true;
      return () => {
        if (live) {
          live = false;
          listeners.delete(listener);
          subscribed -= 1;
        }
      };
    },
    getSnapshot: () => status,
    read: (max): LogFeedBatch => {
      reads += 1;
      woken = false;
      if (closed > 0) {
        return { lines: [], dropped: 0, held: 0 };
      }

      if (status.paused) {
        return { lines: [], dropped: 0, held: held.length };
      }

      const lines = held.slice(0, Math.max(0, max));
      held = held.slice(lines.length);
      return { lines, dropped: 0, held: held.length };
    },
    stats: (): LogFeedStats => ({ received, dropped: 0, held: held.length }),
    pause: () => {
      controls += 1;
      status = { ...status, paused: true, state: status.state === 'streaming' ? 'paused' : status.state };
      tell();
    },
    resume: () => {
      controls += 1;
      status = { ...status, paused: false, state: status.state === 'paused' ? 'streaming' : status.state };
      tell();
    },
    close: (): Promise<void> | void => {
      closed += 1;
      held = [];
      return options.close?.();
    },
    listeners: () => subscribed,
    closed: () => closed,
    reads: () => reads,
    controls: () => controls,
    set: (change) => {
      status = {
        state: change.state ?? status.state,
        paused: change.paused ?? status.paused,
        cause: 'cause' in change ? change.cause : status.cause,
        ...((change.sources ?? status.sources) === undefined ? {} : { sources: change.sources ?? status.sources }),
      };
      tell();
    },
    push: (count) => {
      for (let index = 0; index < count; index += 1) {
        seq += 1;
        received += 1;
        held.push({ seq, source: 'source/main', timestamp: '', text: `line ${String(seq)}`, level: undefined });
      }

      if (!woken && held.length > 0) {
        woken = true;
        tell();
      }
    },
    wake: tell,
  };
}
