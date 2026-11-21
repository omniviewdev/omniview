import { createNoticesSaver, restoreNotices, type NoticesStore, type Restored } from '../core/notices';
import { browserLifecycle, type Lifecycle, type WindowState } from '../session';

// Where the history is kept, how it is read before the window draws, and how it is saved (ch16 S74: records persist and the model's `serialise` and `restoreNotices` are the document and its reading,
// core/notices/persist.ts). The place is the host's window service, the one the session uses (`shell/session`, `backend/window`): a slot of its own, `notices`, in the slots of the window the page is in, persisted
// to `windows.json` in the instance's state root, so it survives a packaged restart and is isolated for each channel. The promises are the session's: the window always starts (a history that cannot be read, or
// used, is a window that starts with none, and says so on the console); what cannot be used is put aside and never deleted; and nothing is written over a text that is neither understood nor kept, or over one that
// could not even be read.

/** The slot of a window that holds its history. */
export const NOTICES_SLOT = 'notices';

/** The name a text that cannot be used is kept under, with the time after it: two texts kept at different times never replace each other. */
export const QUARANTINE_PREFIX = 'notices.invalid.';

/** How long the place may take to answer before the window starts with no history. The place is the host's own process, so an answer is milliseconds; this is the bound on a host that has hung. */
export const READ_DEADLINE_MS = 2000;

/**
 * A place to keep the history as text. `read` answers `undefined` when nothing was saved, and rejects when the place cannot be read (what it holds is then not known). `write` replaces the history. `keep` puts text aside
 * under a name that no later `write` replaces.
 */
export type NoticesStorage = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (text: string) => Promise<void>;
  readonly keep: (name: string, text: string) => Promise<void>;
};

export type NoticesStorageOptions = {
  /** The two calls of the host's window service, as the generated binding has them. */
  readonly client: WindowState;
  /** The name of the window this page is in (the runtime knows it). Asked for once, and again after a failure. */
  readonly name: () => Promise<string>;
};

export function noticesStorage({ client, name }: NoticesStorageOptions): NoticesStorage {
  let named: Promise<string> | undefined;
  const windowName = async (): Promise<string> => {
    named ??= name().catch((error: unknown) => {
      named = undefined;
      throw error;
    });
    return named;
  };

  return {
    read: async () => (await client.GetState(await windowName()))[NOTICES_SLOT],
    write: async (text) => {
      await client.SaveState(await windowName(), NOTICES_SLOT, text);
    },
    // A slot is JSON in the host, and what is kept aside may not be (it is kept because it could not be read): it goes in as a JSON string, and comes out of it exactly as it was.
    keep: async (aside, text) => {
      await client.SaveState(await windowName(), aside, JSON.stringify(text));
    },
  };
}

type Log = (message: string, detail?: unknown) => void;

const defaultLog: Log = (message, detail) => {
  console.warn(`[notices] ${message}`, detail);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type LoadOptions = {
  /** The time in milliseconds. Default: the clock. */
  readonly now?: (() => number) | undefined;
  /** Hears every note. Default: the console, as a warning. */
  readonly log?: Log | undefined;
  /** Default: `READ_DEADLINE_MS`. */
  readonly deadline?: number | undefined;
};

/** What `attach` saves: the model's own `serialise()` and the subscription that says it may have changed. */
export type SavedStore = Pick<NoticesStore, 'serialise' | 'subscribe'>;

export type AttachOptions = {
  /** Quiet time after the last change before the write. Default: the saver's, 400 ms. */
  readonly delay?: number | undefined;
  /** When the page is hidden or going away, what is owed is written at once. Default: the browser's. */
  readonly lifecycle?: Lifecycle | undefined;
};

export type LoadedNotices = {
  /** What the model starts from. `undefined`: no history (nothing was saved, or what was saved could not be used). */
  readonly initial: Restored | undefined;
  /** Starts saving the history. Returns the function that stops it, after writing what is owed. A window whose history could not be read, or whose unusable text could not be kept, saves none. */
  readonly attach: (store: SavedStore, options?: AttachOptions) => () => void;
};

type Read = { readonly ok: true; readonly text: string | undefined } | { readonly ok: false; readonly why: string };

/** The place's answer, or why there is none within the deadline. A place that throws, rejects or never answers is the same to the window: it starts with no history. */
async function readWithin(storage: NoticesStorage, deadline: number): Promise<Read> {
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

/** The writes, one at a time and in order: a write starts after the one before it has answered, and a failed one is said and left behind (the next change writes the then-current history). */
function createWriter(storage: NoticesStorage, log: Log, ready: Promise<boolean>): { readonly write: (text: string) => void } {
  let chain: Promise<void> = Promise.resolve();
  return {
    write: (text) => {
      chain = chain.then(async () => {
        if (!(await ready)) {
          return;
        }

        try {
          await storage.write(text);
        } catch (error) {
          log(`The notifications could not be saved (${messageOf(error)}).`, error);
        }
      });
    },
  };
}

/** A window that starts with no history and saves none: the place could not be read, so what it holds is not known. */
const unsaved: LoadedNotices = { initial: undefined, attach: () => () => undefined };

/**
 * Reads the history before the window draws. It never rejects: whatever the place does, the answer is a window to start. See `LoadedNotices`.
 */
export async function loadNotices(storage: NoticesStorage, options: LoadOptions = {}): Promise<LoadedNotices> {
  const log = options.log ?? defaultLog;
  const read = await readWithin(storage, options.deadline ?? READ_DEADLINE_MS);
  if (!read.ok) {
    log(`The saved notifications could not be read (${read.why}), so this window starts with none and does not save any: a write would replace what is there.`, read.why);
    return unsaved;
  }

  return openNotices(storage, read.text, { now: options.now ?? (() => Date.now()), log });
}

type Open = { readonly now: () => number; readonly log: Log };

/** The text of a history that cannot be used, put aside once: the record holds it exactly as it was, with when it was kept and why. `true` when it is safe to write now. */
async function putAside(storage: NoticesStorage, text: string, reason: 'unreadable' | 'foreign-version', detail: string, { now, log }: Open): Promise<boolean> {
  const at = now();
  const name = `${QUARANTINE_PREFIX}${String(at)}`;
  try {
    await storage.keep(name, JSON.stringify({ version: 1, at, reason, detail, text }));
    log(`The saved notifications could not be used (${detail}). They were kept aside as "${name}" and this window starts with none.`, { name, reason });
    return true;
  } catch (error) {
    log(`The saved notifications could not be used (${detail}) and could not be kept aside (${messageOf(error)}), so this window does not save any: a write would replace them.`, error);
    return false;
  }
}

/** The history a place held, as the text it answered (`undefined`: nothing was saved). `loadNotices` is this after the read. */
function openNotices(storage: NoticesStorage, text: string | undefined, context: Open): LoadedNotices {
  const { now, log } = context;
  let initial: Restored | undefined;
  /** A text was put aside, or tried to be: nothing is written until that is known, and none if it could not be kept. */
  let kept: Promise<boolean> | undefined;
  if (text !== undefined) {
    let parsed: unknown;
    let broken: string | undefined;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      broken = messageOf(error);
    }

    const result = broken === undefined ? restoreNotices(parsed, { now: now() }) : ({ ok: false, reason: 'unreadable', detail: broken } as const);
    if (result.ok) {
      initial = { records: result.records, muted: result.muted };
      if (result.problems.length > 0) {
        log(`The saved notifications were repaired: ${result.problems.join('; ')}.`, result.problems);
      }
    } else if (result.reason !== 'missing') {
      kept = putAside(storage, text, result.reason, result.detail, context);
    }
  }

  return {
    initial,
    attach: (store, { delay, lifecycle = browserLifecycle() } = {}) => {
      const writer = createWriter(storage, log, kept ?? Promise.resolve(true));
      const saver = createNoticesSaver({
        store,
        write: (written) => {
          writer.write(JSON.stringify(written));
        },
        delay,
      });
      if (kept !== undefined) {
        // What the place holds is the text that was put aside: replace it with the history as it starts, so the next run does not find it again.
        writer.write(JSON.stringify(store.serialise()));
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
