import type { LogFeedCause, LogFeedSource } from '@omniviewdev/kit';
import type { LogFeedV1, LogTargetV1, PanelHostV1 } from '../../contract/v1';
// eslint-disable-next-line no-restricted-imports -- the lines come from the kit's synthetic feed, which no entry of the kit exports (it is development and documentation only); build.mjs lets this one file into the bundle (docs/ui-next/status/P1b-3a.md, "Fixture plugin")
import { SyntheticFeed } from '../../../../packages/kit/src/components/LogView/syntheticFeed';

// The fixture's Logs sessions: the proof of `ctx.panel.logs.open` from outside the host's bundle. Six targets of one item, each over a synthetic feed (neutral lines, the same run every time), one for
// every state of a log the host draws: one that streams and goes on, one that ends, one that fails with a cause, one at 10,000 lines a second (what a hidden session must cost nothing for), one that follows
// TWO sources (the log's Source column, L2: its lines take the two in turn, odd lines the first), and one that follows ONE until a check says its second source speaks (`speak()`: the column appears while
// the session is open). The item's detail page lists them as commands in its menu, so opening one is what a plugin's resource view does and no header moves.

/**
 * What a check reads on `window.__fixtureLogs`: how many feeds the host opened, how many it closed, and how many listeners are on the feeds it opened right now (a listener the host or its view did
 * not let go of is a leak the feed itself can see, as a real stream's backend session is).
 */
export type FixtureLogCounters = { opened: number; closed: number; listeners: number };

/**
 * The lines of the fixture's sources, since the page loaded: `emitted` is every line a source made (the feeds that were closed included, the lines past a feed's bound included), `held` the lines the feeds that are
 * open now hold because nobody has read them, `dropped` the lines they dropped past their bound. A source's line is read, held or dropped, so `emitted` is what was read plus `held` plus `dropped`. Nothing is read
 * from a feed to tell it: a log that is hidden reads nothing, and shows as `held` and `dropped` rising by what was `emitted`.
 */
export type FixtureLogStats = { readonly emitted: number; readonly held: number; readonly dropped: number };

/**
 * What the counters offer besides the three numbers, as members that are NOT enumerable (`{ ...window.__fixtureLogs }` stays the three numbers a check compares): `stats()`, above, `stopSources()`, which makes
 * every source of a feed that is open go quiet: the feed stays open and listened to and emits nothing more (the negative control of the logs probe: a feed that is simply inactive), and `speak()`, which makes
 * the second source of every open feed that has one to give (the `late` session) list itself and write its first line, once: what the runtime's stream does when a container it had not heard of starts to write.
 */
export type FixtureLogHooks = { readonly stats: () => FixtureLogStats; readonly stopSources: () => void; readonly speak: () => void };

const KEY = '__fixtureLogs';

/** What the counters keep to tell `stats()`, on the object itself because every copy of this file on a page shares one set: the sources of the feeds that are open, and the totals of the ones that were closed. */
type Shared = FixtureLogCounters & FixtureLogHooks & { readonly sources: Set<SyntheticFeed>; readonly speakers: Set<() => void>; readonly retired: { emitted: number; dropped: number } };

/** The counters, made on first use: the plugin and its copy share one window, and so one set. */
function counters(): Shared {
  const found: unknown = Reflect.get(window, KEY);
  if (typeof found === 'object' && found !== null) {
    return found as Shared;
  }

  const sources = new Set<SyntheticFeed>();
  const speakers = new Set<() => void>();
  const retired = { emitted: 0, dropped: 0 };
  const made: FixtureLogCounters = { opened: 0, closed: 0, listeners: 0 };
  Object.defineProperties(made, {
    sources: { value: sources },
    speakers: { value: speakers },
    retired: { value: retired },
    stats: {
      value: (): FixtureLogStats => {
        let { emitted, dropped } = retired;
        let held = 0;
        for (const feed of sources) {
          const stats = feed.stats();
          emitted += stats.received;
          dropped += stats.dropped;
          held += stats.held;
        }

        return { emitted, held, dropped };
      },
    },
    stopSources: {
      value: (): void => {
        for (const feed of sources) {
          feed.stop();
        }
      },
    },
    speak: {
      value: (): void => {
        for (const speak of [...speakers]) {
          speak();
        }
      },
    },
  });
  Reflect.set(window, KEY, made);
  return made as Shared;
}

type Spec = {
  readonly source: string;
  /** The label of the command that opens it. */
  readonly command: string;
  /** Lines a second. */
  readonly rate: number;
  /** Makes the same lines every run. */
  readonly seed: number;
  /** What it does after a moment of lines: ends, or fails. Absent: it goes on. */
  readonly then?: { readonly after: number; readonly state: 'ended' | 'failed' } | undefined;
  /** The sources the lines come from, in turn, listed by the stream with the labels a view shows. Absent: one source, `source/main`. */
  readonly sources?: readonly LogFeedSource[] | undefined;
  /** A source the stream has not heard of at the start: `speak()` lists it with the others and writes its first line (once). The lines the feed makes are still the first sources'. */
  readonly later?: LogFeedSource | undefined;
};

const CAUSE: LogFeedCause = { stage: 'source', message: 'The source did not answer' };

const SPECS: readonly Spec[] = [
  { source: 'app', command: 'Logs: app', rate: 20, seed: 11 },
  { source: 'migrate', command: 'Logs: migrate (ends)', rate: 20, seed: 12, then: { after: 1_500, state: 'ended' } },
  { source: 'sync', command: 'Logs: sync (fails)', rate: 20, seed: 13, then: { after: 1_500, state: 'failed' } },
  { source: 'audit', command: 'Logs: audit (10,000 lines a second)', rate: 10_000, seed: 14 },
  // The command labels of the sessions after `app` must not CONTAIN `Logs: app`: the seam check clicks the menu item named `Logs: app`, and a name matches as a substring (two matches are an error).
  { source: 'pair', command: 'Logs: two sources (app and worker)', rate: 20, seed: 15, sources: [{ id: 'pair/app', label: 'app' }, { id: 'pair/worker', label: 'worker' }] },
  // The second source's name is a container's, as a real stream has them: 13 characters or more, so the view draws it in two halves and cuts it from its start (the full name is its tip).
  { source: 'late', command: 'Logs: a second source speaks later (init-migrations)', rate: 200, seed: 16, sources: [{ id: 'late/app' }], later: { id: 'late/orders-7d8c6f49b-f8q4m/init-migrations' } },
];

/** A stream over a synthetic feed: what the host reads (`subscribe`, `read` and the rest are the feed's own) and what it closes. */
function feedOf(spec: Spec): LogFeedV1 {
  const synthetic = new SyntheticFeed({ rate: spec.rate, seed: spec.seed, ...(spec.sources === undefined ? {} : { sources: spec.sources }) });
  const live = counters();
  live.opened += 1;
  live.sources.add(synthetic);
  // What stops the moment the stream ends or fails on its own, while it has not happened yet.
  let cancel: (() => void) | undefined;
  let closed = false;
  let speaker: (() => void) | undefined;
  if (spec.later !== undefined) {
    const { later } = spec;
    let spoke = false;
    speaker = () => {
      if (!spoke) {
        spoke = true;
        synthetic.setSources([...(spec.sources ?? []), later]);
        synthetic.push([synthetic.line(`${later.id} started`, 'info', later.id)]);
      }
    };

    live.speakers.add(speaker);
  }

  synthetic.start();
  if (spec.then !== undefined) {
    const { after, state } = spec.then;
    const timer = setTimeout(() => {
      cancel = undefined;
      synthetic.stop();
      synthetic.setState(state, state === 'failed' ? CAUSE : undefined);
    }, after);
    cancel = () => {
      clearTimeout(timer);
    };
  }

  return {
    subscribe: (listener) => {
      const stop = synthetic.subscribe(listener);
      live.listeners += 1;
      let counted = true;
      return () => {
        if (counted) {
          counted = false;
          live.listeners -= 1;
          stop();
        }
      };
    },
    getSnapshot: synthetic.getSnapshot,
    read: synthetic.read,
    stats: synthetic.stats,
    pause: synthetic.pause,
    resume: synthetic.resume,
    close: () => {
      if (closed) {
        return;
      }

      closed = true;
      if (speaker !== undefined) {
        live.speakers.delete(speaker);
      }

      cancel?.();
      synthetic.stop();
      // A real stream that is closed is over, and says so; one that had ended or failed keeps what happened to it.
      const { state } = synthetic.getSnapshot();
      if (state === 'starting' || state === 'streaming' || state === 'paused') {
        synthetic.setState('ended');
      }

      // The lines it made and dropped stay in the totals; what it still held goes with it.
      const { received, dropped } = synthetic.stats();
      live.retired.emitted += received;
      live.retired.dropped += dropped;
      live.sources.delete(synthetic);
      live.closed += 1;
    },
  };
}

/** The item a session is about: its name and its group, which are the route of its page. */
export type LogItem = { readonly name: string; readonly group: string };

/** The sessions of an item, as the targets the host opens: the tab says `<item>/<source>`, the card links to the item. */
export function logTargetsOf(item: LogItem): readonly LogTargetV1[] {
  return SPECS.map((spec) => ({
    id: `item/${item.name}/${spec.source}`,
    title: `${item.name}/${spec.source}`,
    scope: item.group,
    resource: { label: `Item ${item.name}`, kind: 'Item', route: { page: 'item', params: { name: item.name, group: item.group } } },
    open: () => feedOf(spec),
  }));
}

/**
 * The commands of an item's menu that open its four sessions. A host that has no panel handle (one that predates `ctx.panel`) cannot show them: the commands say so, as a plugin's must (P1b-3b's spec).
 */
export function logCommandsOf(item: LogItem, panel: PanelHostV1 | undefined): ReadonlyArray<{ readonly id: string; readonly label: string; readonly onSelect: () => void; readonly disabledReason: string | undefined }> {
  const targets = logTargetsOf(item);
  return SPECS.map((spec, index) => ({
    id: `logs-${spec.source}`,
    label: spec.command,
    onSelect: () => {
      const target = targets[index];
      if (target !== undefined) {
        panel?.logs.open(target);
      }
    },
    disabledReason: panel === undefined ? 'This version of Omniview cannot show logs here.' : undefined,
  }));
}
