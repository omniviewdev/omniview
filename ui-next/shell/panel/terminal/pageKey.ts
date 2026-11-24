import type { WindowState } from '../../session';

// The page key of the Terminal tool (docs/ui-next/status/T2-go.md 2.1 and 2.6). A terminal started with a key outlives the page that started it, for a lease, and the page that comes back finds it by the same key
// (`ListTerminals`, `AttachTerminal`): the key is how a reloaded page, which the host takes for a new window in server mode, is told from any other. It is the page's secret: whoever has it may attach, so it is
// kept only where the window's own state is kept, never in the address and never in a log. That place is the host's window service, the one the session and the notifications use (`shell/session`,
// `shell/notices`): a slot of its own in the slots of the window the page is in, which the host persists. The window always starts: a place that cannot be read or written leaves a key that works for the life of
// the page, in memory, and a note that does not carry it.

/** The slot of a window that holds its page key, as a JSON string (a slot of the host is JSON). */
export const PAGE_KEY_SLOT = 'terminal-page-key';

/** How long the place may take to answer a call before the window goes on with a key of its own. The place is the host's own process, so an answer is milliseconds; this is the bound on a host that has hung. */
export const KEY_DEADLINE_MS = 2_000;

/** What the host accepts of a page key: 16 to 128 visible ASCII characters, no space. Anything else is refused, and no terminal starts. */
const USABLE = /^[\x21-\x7e]{16,128}$/;

/** A place to keep the key as the text of its slot. `read` answers `undefined` when nothing was saved. */
export type KeyStorage = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (text: string) => Promise<void>;
};

export type KeyStorageOptions = {
  /** The two calls of the host's window service, as the generated binding has them. */
  readonly client: WindowState;
  /** The name of the window this page is in (the runtime knows it). Asked for once, and again after a failure. */
  readonly name: () => Promise<string>;
};

export function terminalKeyStorage({ client, name }: KeyStorageOptions): KeyStorage {
  let named: Promise<string> | undefined;
  const windowName = async (): Promise<string> => {
    named ??= name().catch((error: unknown) => {
      named = undefined;
      throw error;
    });
    return named;
  };

  return {
    read: async () => (await client.GetState(await windowName()))[PAGE_KEY_SLOT],
    write: async (text) => {
      await client.SaveState(await windowName(), PAGE_KEY_SLOT, text);
    },
  };
}

/** The platform's `crypto`, which every engine the app runs in has, and a test environment may not. */
const platform: { readonly crypto?: Crypto | undefined } = globalThis;

/**
 * A new key: a random UUID where the platform has one. A page served over plain HTTP has `getRandomValues` and no `randomUUID` (it is for secure contexts only), and then the key is 128 random bits in hexadecimal.
 * With no random numbers at all (a test environment) it is made of `Math.random`, which is no secret but is unique for the life of the page.
 */
function newKey(): string {
  const random = platform.crypto;
  if (typeof random?.randomUUID === 'function') {
    return random.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof random?.getRandomValues === 'function') {
    random.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The key a slot's text holds: a JSON string of 16 to 128 visible ASCII characters. Anything else is no key. */
function usableKey(text: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  return typeof value === 'string' && USABLE.test(value) ? value : undefined;
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a call of the place answers, or why there is none within the deadline. A place that throws, rejects or never answers is the same to the window: it goes on with a key of its own. */
async function within<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The app's TypeScript library (ES2023) has no `Promise.withResolvers`, so the deadline is made with the executor.
  const late = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, why: `it did not answer in ${String(KEY_DEADLINE_MS)} ms` });
    }, KEY_DEADLINE_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(call).then((value): Outcome<T> => ({ ok: true, value })), late]);
  } catch (error) {
    return { ok: false, why: messageOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

const consoleWarn = (message: string): void => {
  console.warn(message);
};

/**
 * The key of this window's page: the one it made before, read from its slot, or a new one, saved. It never rejects: a key that cannot be read or saved is made all the same and lives as long as the page, and the
 * console is told (a note never carries the key, nor a text that was read where a key should be, and the words of a failed save are cleaned of the key in case the place echoes what it was given). A key that was read
 * and is not one the host would take is replaced.
 */
export async function loadPageKey(storage: KeyStorage, warn: (message: string) => void = consoleWarn): Promise<string> {
  const read = await within(storage.read);
  if (read.ok) {
    const saved = read.value === undefined ? undefined : usableKey(read.value);
    if (saved !== undefined) {
      return saved;
    }

    if (read.value !== undefined) {
      warn('The saved terminal page key could not be used, so this window has a new one.');
    }
  } else {
    warn(`The terminal page key could not be read (${read.why}), so this window has a new one for as long as this page lives.`);
  }

  // The new key is saved even when nothing could be read: a place that has recovered by the next reload then holds the key of the terminals this page starts.
  const key = newKey();
  const written = await within(async () => storage.write(JSON.stringify(key)));
  if (!written.ok) {
    warn(`The terminal page key could not be saved (${written.why.split(key).join('the key')}), so the terminals this page starts cannot be found again after a reload.`);
  }

  return key;
}
