// The Logs session body (`LogSession`, the host's own) over a feed that is told by its producer, as the runtime's stream is told by a backend that marks replays (S1-host), for the probe (logs-open-probe.mjs). The producer
// replays the last lines of a source that has been writing for a while (REPLAY lines, flagged as replay, delivered in batches in the first second) and says the replay is over BEFORE the tail of it was delivered (the host
// batches lines and sends events at once, so a marker overtakes the lines before it): the lines flagged replay that come after the marker are the last 1,500. Then the source writes RATE lines a second. The feed counts what
// the producer says is live (`LogFeedStats.live`: lines that are not flagged replay, from a source that has said its replay is over) when it accepts a line, and says nothing before the marker. Nothing else is invented:
// the view, its model and the strip are the product's. A line carries a time, which the view must not read.
//
//   ?rate=5              lines a second after the replay (default 5)
//   ?replay=5000         lines replayed at open (default 5000)
//   ?marker=ahead        the default: the marker comes after 70% of the replay, with the rest of it still to come
//   ?marker=never        the source is never marked (a plugin that could not count its replay in time): no word comes, at all, and the strip must say no rate for as long as the page lives
//   ?control=...         the probe's perturbations, each the fault one of its assertions is there to see:
//                          counted-replay   the feed counts the lines flagged replay as live (a consumer that ignores the flag): the strip reads the burst
//                          no-wait          the feed has a count from the start and does not wait for the producer's word (a consumer that takes a source for live before it is told): the strip reads 0.0 where it should say no rate
//                          timeout-live     with ?marker=never, the feed turns live after 3 s with no word (an invented timeout): the strip reads a figure where it should say no rate, for good
//
// What the page exposes: `window.__series` (a sample of the strip's text every 250 ms from the moment the producer starts: `[ms since then, text]`) and `window.__feed` (what the feed made so far, and when its producer spoke).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { MenuHost, ThemeProvider, type LogFeed, type LogFeedBatch, type LogFeedLine, type LogFeedSnapshot, type LogFeedStats } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { LogSession } from '../panel/logs/LogSession';

const params = new URLSearchParams(window.location.search);
const RATE = Number(params.get('rate') ?? 5);
const REPLAY = Number(params.get('replay') ?? 5000);
const MARKER = params.get('marker') ?? 'ahead';
const CONTROL = params.get('control') ?? '';
const BATCH = 250;
const BATCH_EVERY_MS = 50;
/** The marker comes after this share of the replay's batches: the rest of the replay is delivered after it. */
const MARKER_AFTER_SHARE = 0.7;
const SILENT_TIMEOUT_MS = 3000;
/** The producer starts this long after the page mounted the view, so that the strip is on screen before anything is said and the series has samples that come before the marker. */
const START_AFTER_MS = 600;

/** What the producer made so far: `markerAt` and `liveFrom` are on the clock of the series (ms since the producer started). */
type Made = { replayed: number; live: number; afterMarker: number; markerAt: number | undefined; liveFrom: number | undefined };

/** The feed: what the runtime's stream is to the view (a consumer-paced `read`, one wake-up between two reads, a count of live lines), over the replay and the live lines of this page. */
function makeFeed(): LogFeed & { readonly made: Made; readonly start: (startedAt: number) => void } {
  const held: LogFeedLine[] = [];
  const listeners = new Set<() => void>();
  const made: Made = { replayed: 0, live: 0, afterMarker: 0, markerAt: undefined, liveFrom: undefined };
  let seq = 0;
  let received = 0;
  let liveLines = 0;
  /** Whether the producer has said a source's replay is over. With `no-wait` the feed behaves as if it had from the start. */
  let marked = CONTROL === 'no-wait';
  let status: LogFeedSnapshot = { state: 'streaming', paused: false, cause: undefined };
  const wake = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const accept = (lines: LogFeedLine[], replay: boolean): void => {
    held.push(...lines);
    received += lines.length;
    // Counted when the feed accepts a line, whoever reads it: a line flagged replay is not live (unless the feed is the control that ignores the flag), and no line is before the producer's word.
    if (marked && (!replay || CONTROL === 'counted-replay')) {
      liveLines += lines.length;
    }

    wake();
  };

  const line = (text: string, written: number): LogFeedLine => {
    seq += 1;
    return { seq, source: 'worker/app', timestamp: new Date(written).toISOString(), text, level: undefined };
  };

  const start = (startedAt: number): void => {
    const opened = Date.now();
    const say = (): void => {
      marked = true;
      made.markerAt = Math.round(performance.now() - startedAt);
      wake();
    };

    const batches = Math.ceil(REPLAY / BATCH);
    const markerBatch = Math.floor(batches * MARKER_AFTER_SHARE);
    let delivered = 0;
    let batch = 0;
    const replay = setInterval(() => {
      const lines: LogFeedLine[] = [];
      for (let index = 0; index < BATCH && delivered < REPLAY; index += 1, delivered += 1) {
        lines.push(line(`replayed line ${delivered + 1}`, opened - 1000 - (REPLAY - 1 - delivered) * 200));
      }

      made.replayed += lines.length;
      if (made.markerAt !== undefined) {
        made.afterMarker += lines.length;
      }

      accept(lines, true);
      batch += 1;
      if (MARKER !== 'never' && batch === markerBatch) {
        say();
      }

      if (delivered >= REPLAY) {
        clearInterval(replay);
        made.liveFrom = Math.round(performance.now() - startedAt);
        setInterval(() => {
          made.live += 1;
          // A source that is never marked flags what it writes as replay too (the interim of a plugin that could not count): nothing it sends is live, whatever its own flag says.
          accept([line(`live line ${made.live}`, Date.now())], MARKER === 'never');
        }, 1000 / RATE);
      }
    }, BATCH_EVERY_MS);
    if (MARKER === 'never' && CONTROL === 'timeout-live') {
      setTimeout(() => {
        marked = true;
        wake();
      }, SILENT_TIMEOUT_MS);
    }
  };

  return {
    made,
    start,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => status,
    read: (max): LogFeedBatch => {
      const lines = held.splice(0, max);
      return { lines, dropped: 0, held: held.length };
    },
    stats: (): LogFeedStats => ({ received, dropped: 0, held: held.length, live: marked ? liveLines : undefined }),
    pause: () => {
      status = { ...status, state: 'paused', paused: true };
    },
    resume: () => {
      status = { ...status, state: 'streaming', paused: false };
    },
  };
}

const feed = makeFeed();
Reflect.set(window, '__feed', feed);

const series: Array<[number, string]> = [];
Reflect.set(window, '__series', series);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <div data-fixture="body">
      <MenuHost>
        <LogSession label="source · app" feed={feed} session="open" />
      </MenuHost>
    </div>
  </ThemeProvider>,
);

setTimeout(() => {
  const opened = performance.now();
  feed.start(opened);
  setInterval(() => {
    const text = document.querySelector('[role="group"][aria-label="Session status"] > span[aria-live]')?.textContent ?? '';
    series.push([Math.round(performance.now() - opened), text]);
  }, 250);
}, START_AFTER_MS);
