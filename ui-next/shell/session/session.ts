import { restorePanel, type PanelState, type PanelStore } from '../core/panel';
import { createSaver } from '../core/saver';
import { restoreTabs, type Contributions, type ErrorHook, type KeepAlive, type TabsState, type TabsStore } from '../core/tabs';
import { readSession, serialiseSession, type ReadOptions } from './document';
import { browserLifecycle, type Lifecycle } from './lifecycle';
import type { RailSource } from './rail';
import type { SessionStorage } from './types';

// Loading, restoring and saving the session. Three promises, in the order they matter: the window always starts (a session that cannot be read, or used, is a window that starts empty, with a note on
// the console; the old app exits on a bad `activities.json`, and this does not repeat it); what cannot be used is kept aside and never deleted; and nothing is written over a text that is neither
// understood nor kept, or over one that could not even be read.

/** The name a text kept aside is given, with the time after it: two texts kept at different times never replace each other. */
export const QUARANTINE_PREFIX = 'session.invalid.';

/** How long the place may take to answer before the window starts without a session. The place is the host's own process, so an answer is milliseconds; this is the bound on a host that has hung. */
export const READ_DEADLINE_MS = 2000;

export type SessionOptions = {
  /** The time in milliseconds. Default: the clock. */
  readonly now?: (() => number) | undefined;
  /** Hears every note. Default: the console, as a warning. */
  readonly log?: ((message: string, detail?: unknown) => void) | undefined;
  /** Default: `READ_DEADLINE_MS`. */
  readonly deadline?: number | undefined;
} & ReadOptions;

export type RestoreOptions = {
  /** What the plugins say: the tab model describes each restored tab again from it. */
  readonly contributions: Contributions;
  readonly keepAlive?: Partial<KeepAlive> | undefined;
  readonly onError?: ErrorHook | undefined;
};

/** What the window starts from. A part that is `undefined` has nothing to restore: the model starts as it does with no session. */
export type Restored = {
  readonly tabs: TabsState | undefined;
  readonly panel: PanelState | undefined;
  readonly rail: string | undefined;
};

export type AttachOptions = {
  readonly tabs: Pick<TabsStore, 'getSnapshot' | 'subscribe'>;
  readonly panel: Pick<PanelStore, 'getSnapshot' | 'subscribe'>;
  readonly rail: RailSource;
  /** Quiet time after the last change before the write. Default: the saver's, 400 ms. */
  readonly delay?: number | undefined;
  /** When the page is hidden or going away, what is pending is written at once. Default: the browser's. */
  readonly lifecycle?: Lifecycle | undefined;
};

export type LoadedSession = {
  /** The window's two models' states and the rail's choice, from what was saved. Said and kept aside once, however often it is asked. */
  readonly restore: (options: RestoreOptions) => Restored;
  /** Starts saving the three. Returns the function that stops it, after writing what is pending. A window whose session could not be read saves none. */
  readonly attach: (options: AttachOptions) => () => void;
};

type Log = (message: string, detail?: unknown) => void;

const defaultLog: Log = (message, detail) => {
  console.warn(`[session] ${message}`, detail);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const NOTHING: Restored = Object.freeze({ tabs: undefined, panel: undefined, rail: undefined });

type Read = { readonly ok: true; readonly text: string | undefined } | { readonly ok: false; readonly why: string };

/** The place's answer, or why there is none within the deadline. A place that throws, rejects or never answers is the same to the window: it starts without a session. */
async function readWithin(storage: SessionStorage, deadline: number): Promise<Read> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Read>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, why: `it did not answer in ${String(deadline)} ms` });
    }, deadline);
  });
  try {
    return await Promise.race([Promise.resolve().then(storage.read).then((text): Read => ({ ok: true, text })), late]);
  } catch (error) {
    return { ok: false, why: messageOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The text of a session that cannot be used, put aside once. `keep` answers whether it is safe now: a window whose text could not be kept saves nothing, because a save would replace the only
 * copy. The record holds the text exactly as it was, with when it was kept and why, so a person (or a later version) can read it.
 */
function createKeeper(storage: SessionStorage, text: string, now: () => number, log: Log) {
  let outcome: Promise<boolean> | undefined;
  return {
    keep: async (reason: 'unreadable' | 'foreign-version', detail: string, what: string): Promise<boolean> => {
      outcome ??= (async () => {
        const at = now();
        const name = `${QUARANTINE_PREFIX}${String(at)}`;
        try {
          await storage.keep(name, JSON.stringify({ version: 1, at, reason, detail, text }));
          log(`The saved session could not be used (${what}: ${detail}). It was kept aside as "${name}" and the window starts empty.`, { name, reason });
          return true;
        } catch (error) {
          log(`The saved session could not be used (${what}: ${detail}) and could not be kept aside (${messageOf(error)}), so this window does not save one: a write would replace it.`, error);
          return false;
        }
      })();
      return outcome;
    },
    /** Whether a text was put aside, or tried to be. */
    outcome: (): Promise<boolean> | undefined => outcome,
  };
}

/** The writes, one at a time and in order: a write starts after the one before it has answered, and a failed one is said and left behind (the next change writes the then-current document). */
function createWriter(storage: SessionStorage, log: Log, ready: Promise<boolean>) {
  let chain: Promise<void> = Promise.resolve();
  return {
    write: (text: string): void => {
      chain = chain.then(async () => {
        if (!(await ready)) {
          return;
        }

        try {
          await storage.write(text);
        } catch (error) {
          log(`The session could not be saved (${messageOf(error)}).`, error);
        }
      });
    },
  };
}

/** A window that starts without a session and saves none: the place could not be read, so what it holds is not known. */
const unsaved: LoadedSession = { restore: () => NOTHING, attach: () => () => undefined };

/**
 * Reads the session before the window draws. It never rejects: whatever the place does, the answer is a window to start. See `LoadedSession`.
 */
export async function loadSession(storage: SessionStorage, options: SessionOptions = {}): Promise<LoadedSession> {
  const read = await readWithin(storage, options.deadline ?? READ_DEADLINE_MS);
  if (!read.ok) {
    (options.log ?? defaultLog)(`The saved session could not be read (${read.why}), so this window starts empty and does not save one: a write would replace what is there.`, read.why);
    return unsaved;
  }

  return openSession(storage, read.text, options);
}

/**
 * The session a place held, as the text it answered (`undefined`: nothing was saved). `loadSession` is this after the read; a host that already has the text, and a test, call it directly. A text
 * that cannot be used is put aside from here on, once, and the window starts empty. See `LoadedSession`.
 */
export function openSession(storage: SessionStorage, text: string | undefined, options: SessionOptions = {}): LoadedSession {
  const log = options.log ?? defaultLog;
  const now = options.now ?? (() => Date.now());
  const saved = readSession(text, options);
  const keeper = createKeeper(storage, text ?? '', now, log);
  if (saved.kind === 'unusable') {
    void keeper.keep(saved.reason, saved.detail, 'the saved text');
  }

  let reported = false;
  return {
    restore: ({ contributions, keepAlive, onError }) => {
      if (saved.kind !== 'saved') {
        return NOTHING;
      }

      const problems: string[] = [];
      const unusable: Array<{ readonly reason: 'unreadable' | 'foreign-version'; readonly detail: string }> = [];
      let tabs: TabsState | undefined;
      let panel: PanelState | undefined;

      if (saved.tabs !== undefined) {
        const result = restoreTabs(saved.tabs, { contributions, keepAlive, onError });
        if (result.ok) {
          tabs = result.state;
          problems.push(...result.problems.map((problem) => `tabs: ${problem}`));
        } else if (result.reason === 'empty' && isEmptyList(saved.tabs)) {
          // A window whose last tab was closed: it comes back as it was, empty.
        } else if (result.reason !== 'missing') {
          unusable.push({ reason: result.reason === 'foreign-version' ? 'foreign-version' : 'unreadable', detail: `tabs: ${result.detail}` });
        }
      }

      if (saved.panel !== undefined) {
        const result = restorePanel(saved.panel, { now: now() });
        if (result.ok) {
          panel = result.state;
          problems.push(...result.problems.map((problem) => `panel: ${problem}`));
        } else if (result.reason !== 'missing') {
          unusable.push({ reason: result.reason, detail: `panel: ${result.detail}` });
        }
      }

      if (!reported) {
        reported = true;
        if (unusable.length > 0) {
          void keeper.keep(unusable.some((part) => part.reason === 'foreign-version') ? 'foreign-version' : 'unreadable', unusable.map((part) => part.detail).join('; '), 'the parts of the session');
        }

        if (problems.length > 0) {
          log(`The saved session was repaired: ${problems.join('; ')}.`, problems);
        }
      }

      return { tabs, panel, rail: saved.rail };
    },
    attach: ({ tabs, panel, rail, delay, lifecycle = browserLifecycle() }) => {
      // A text that was put aside, or tried to be: nothing is written until it is safe, and none if it could not be.
      const ready = keeper.outcome() ?? Promise.resolve(true);
      const writer = createWriter(storage, log, ready);
      const store = {
        getSnapshot: () => ({ tabs: tabs.getSnapshot(), panel: panel.getSnapshot(), rail: rail.getSnapshot() }),
        subscribe: (listener: () => void) => {
          const stops = [tabs.subscribe(listener), panel.subscribe(listener), rail.subscribe(listener)];
          return () => {
            for (const stop of stops) {
              stop();
            }
          };
        },
      };
      const saver = createSaver({
        store,
        serialise: serialiseSession,
        write: (written) => {
          writer.write(JSON.stringify(written));
        },
        delay,
      });
      if (keeper.outcome() !== undefined) {
        // What the place holds is the text that was put aside: replace it with the window as it starts, so the next run does not find it again.
        writer.write(JSON.stringify(serialiseSession(store.getSnapshot())));
      }

      const stopHide = lifecycle.onHide(() => {
        saver.flush();
      });
      return () => {
        stopHide();
        saver.flush();
        saver.dispose();
      };
    },
  };
}

/** A saved tab model that lists no tab: the window was empty when it was saved. */
function isEmptyList(part: unknown): boolean {
  return typeof part === 'object' && part !== null && 'tabs' in part && Array.isArray(part.tabs) && part.tabs.length === 0;
}
