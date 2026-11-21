// The Logs session body (`LogSession`, the host's own) over a feed that does what a real stream does at open, for the probe (logs-open-probe.mjs): it replays the last lines of a source that has been writing for a
// while (REPLAY lines, each stamped with the time it was written, the newest 1 s before the page opened, delivered in batches in the first half second, with nothing to say they are a replay) and then writes
// RATE lines a second, each stamped with the time it is written. Nothing else is invented: the view, its model, the strip are the product's.
//
//   ?rate=5            lines a second after the replay (default 5)
//   ?replay=5000       lines replayed at open (default 5000)
//   ?control=fresh     the probe's perturbation: the replay is stamped with the instant it is delivered, as lines that were written just now: a feed that gives
//                      the view no way to tell a replay from live lines, which the strip must then read as the live rate it is (a burst). The probe's rate assertion must see it.
//
// What the page exposes: `window.__series` (a sample of the strip's text every 250 ms from the first frame: `[ms since the page opened, text]`) and `window.__feed` (what the feed made so far).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, type LogFeed, type LogFeedBatch, type LogFeedLine, type LogFeedSnapshot, type LogFeedStats } from '@omniviewdev/kit';
import { createRoot } from 'react-dom/client';
import { LogSession } from '../panel/logs/LogSession';

const params = new URLSearchParams(window.location.search);
const RATE = Number(params.get('rate') ?? 5);
const REPLAY = Number(params.get('replay') ?? 5000);
const CONTROL = params.get('control') ?? '';
const BATCH = 250;
const BATCH_EVERY_MS = 25;

/** The feed: what the runtime's stream is to the view (a consumer-paced `read`, one wake-up between two reads), over the replay and the live lines of this page. */
function makeFeed(): LogFeed & { readonly made: { replayed: number; live: number } } {
  const held: LogFeedLine[] = [];
  const listeners = new Set<() => void>();
  const made = { replayed: 0, live: 0 };
  let seq = 0;
  let received = 0;
  let status: LogFeedSnapshot = { state: 'streaming', paused: false, cause: undefined };
  const accept = (lines: LogFeedLine[]): void => {
    held.push(...lines);
    received += lines.length;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const line = (text: string, written: number): LogFeedLine => {
    seq += 1;
    return { seq, source: 'worker/app', timestamp: new Date(written).toISOString(), text, level: undefined };
  };

  const opened = Date.now();
  let delivered = 0;
  const replay = setInterval(() => {
    const lines: LogFeedLine[] = [];
    for (let index = 0; index < BATCH && delivered < REPLAY; index += 1, delivered += 1) {
      const written = CONTROL === 'fresh' ? Date.now() : opened - 1000 - (REPLAY - 1 - delivered) * 200;
      lines.push(line(`replayed line ${delivered + 1}`, written));
    }

    made.replayed += lines.length;
    accept(lines);
    if (delivered >= REPLAY) {
      clearInterval(replay);
      setInterval(() => {
        made.live += 1;
        accept([line(`live line ${made.live}`, Date.now())]);
      }, 1000 / RATE);
    }
  }, BATCH_EVERY_MS);

  return {
    made,
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
    stats: (): LogFeedStats => ({ received, dropped: 0, held: held.length }),
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
const opened = performance.now();
setInterval(() => {
  const text = document.querySelector('[role="group"][aria-label="Session status"] > span[aria-live]')?.textContent ?? '';
  series.push([Math.round(performance.now() - opened), text]);
}, 250);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <div data-fixture="body">
      <LogSession label="source · app" feed={feed} session="open" />
    </div>
  </ThemeProvider>,
);
