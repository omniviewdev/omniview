import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_DEADLINE_MS, PAGE_KEY_SLOT, loadPageKey, terminalKeyStorage, type KeyStorage } from './pageKey';

// The page key of the Terminal tool (docs/ui-next/status/T2-go.md 2.1 and 2.6): the secret a window makes once, gives to every terminal it starts and to the calls that find those terminals again after a reload. It
// is kept where the session keeps the window's own state, the host's window service (`shell/session`, `shell/notices`): a slot of its own, `terminal-page-key`, holding a JSON string, so that a reload of the same
// window reads the key it made and a terminal it started is found again. What is tested here is where it is kept, what is a usable key (16 to 128 visible ASCII characters, no spaces: the host refuses any other
// and starts nothing), how one is made, and that a window always gets a key whatever the place does: a place that cannot be read or written leaves a key that works for the life of the page, with a note that
// never carries the key.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What the host accepts of a page key: 16 to 128 visible ASCII characters. */
const USABLE = /^[\x21-\x7e]{16,128}$/;
const SAVED = '0f8fad5b-d9cb-469f-a165-70867728950e';

type Slots = Record<string, string | undefined>;

type Window = {
  readonly client: {
    readonly GetState: (name: string) => Promise<Readonly<Slots>>;
    readonly SaveState: (name: string, slot: string, json: string) => Promise<void>;
  };
  readonly slots: Map<string, Slots>;
  readonly calls: Array<readonly [string, ...string[]]>;
};

/** The host's window service as the generated binding has it: the slots of each window, by its name. */
function windowService(slots: Slots = {}): Window {
  const windows = new Map<string, Slots>([['main', { ...slots }]]);
  const calls: Array<readonly [string, ...string[]]> = [];
  return {
    slots: windows,
    calls,
    client: {
      GetState: async (name) => {
        calls.push(['GetState', name]);
        return Promise.resolve({ ...windows.get(name) });
      },
      SaveState: async (name, slot, json) => {
        calls.push(['SaveState', name, slot, json]);
        windows.set(name, { ...windows.get(name), [slot]: json });
        return Promise.resolve();
      },
    },
  };
}

const mainWindow = (service: Window) => terminalKeyStorage({ client: service.client, name: async () => Promise.resolve('main') });

type Fake = KeyStorage & { readonly saved: () => string | undefined; readonly writes: string[] };

/** A place to keep the key as text, with the failures a test asks for. */
function fakeStorage(initial?: string, fail: { readonly read?: Error; readonly write?: Error } = {}): Fake {
  let saved = initial;
  const writes: string[] = [];
  return {
    saved: () => saved,
    writes,
    read: async () => {
      if (fail.read !== undefined) {
        throw fail.read;
      }

      return Promise.resolve(saved);
    },
    write: async (text) => {
      writes.push(text);
      if (fail.write !== undefined) {
        throw fail.write;
      }

      saved = text;
      return Promise.resolve();
    },
  };
}

const keyOf = (stored: string | undefined): unknown => JSON.parse(stored ?? 'null');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('where the page key is kept (a slot of the window the page is in)', () => {
  it('is the slot `terminal-page-key`, a slot of its own: not the session\'s, not the notices\'', () => {
    expect(PAGE_KEY_SLOT).toBe('terminal-page-key');
  });

  it('reads the slot of the window it is given the name of, as the text the host holds, and says nothing when the slot is empty', async () => {
    const service = windowService({ 'terminal-page-key': '"abcdefghijklmnop"', session: '{"v":1}' });
    await expect(mainWindow(service).read()).resolves.toBe('"abcdefghijklmnop"');
    await expect(mainWindow(windowService()).read()).resolves.toBeUndefined();
  });

  it('writes the text into that slot of that window and into no other slot', async () => {
    const service = windowService({ session: '{"v":1}' });
    await mainWindow(service).write('"abcdefghijklmnop"');
    expect(service.calls).toEqual([['SaveState', 'main', 'terminal-page-key', '"abcdefghijklmnop"']]);
    expect(service.slots.get('main')).toEqual({ session: '{"v":1}', 'terminal-page-key': '"abcdefghijklmnop"' });
  });

  it('asks for the name of the window once, however many times it is used, and again after the question failed', async () => {
    const service = windowService();
    const name = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('no runtime yet')).mockResolvedValue('main');
    const storage = terminalKeyStorage({ client: service.client, name });
    await expect(storage.read()).rejects.toThrow('no runtime yet');
    await storage.read();
    await storage.write('"abcdefghijklmnop"');
    await storage.read();
    expect(name).toHaveBeenCalledTimes(2);
  });
});

describe('a key that is read', () => {
  it('is the one the page made before, given back as it is, and nothing is written: a reload of the same window finds the terminals it gave this key to', async () => {
    const storage = fakeStorage(JSON.stringify(SAVED));
    await expect(loadPageKey(storage)).resolves.toBe(SAVED);
    expect(storage.writes).toEqual([]);
  });

  it.each([
    { name: '16 characters, the fewest', key: 'abcdefghijklmnop' },
    { name: '128 characters, the most', key: 'k'.repeat(128) },
    { name: 'every visible ASCII character from `!` to `~`', key: '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' },
  ])('is kept when it is $name', async ({ key }) => {
    const storage = fakeStorage(JSON.stringify(key));
    await expect(loadPageKey(storage)).resolves.toBe(key);
    expect(storage.writes).toEqual([]);
  });

  it.each([
    { name: 'too short (15 characters)', text: JSON.stringify('a'.repeat(15)) },
    { name: 'too long (129 characters)', text: JSON.stringify('a'.repeat(129)) },
    { name: 'empty', text: JSON.stringify('') },
    { name: 'with a space', text: JSON.stringify('abcdefgh ijklmnopqr') },
    { name: 'with a tab', text: JSON.stringify('abcdefgh\tijklmnopqr') },
    { name: 'with a character that is not ASCII', text: JSON.stringify('abcdefghijklmnopé') },
    { name: 'with a control character (DEL)', text: JSON.stringify('abcdefghijklmnop\u007f') },
    { name: 'not a JSON text at all', text: 'abcdefghijklmnopqrstuvwxyz' },
    { name: 'a JSON text that is not a string: a number', text: '42' },
    { name: 'a JSON text that is not a string: an object', text: '{"key":"abcdefghijklmnopqrstuvwxyz"}' },
    { name: 'a JSON text that is not a string: null', text: 'null' },
    { name: 'an empty text', text: '' },
  ])('is replaced when it is $name: the host would refuse it and start nothing, so a new one is made and saved', async ({ text }) => {
    const storage = fakeStorage(text);
    const key = await loadPageKey(storage);
    expect(key).toMatch(USABLE);
    expect(storage.writes).toEqual([JSON.stringify(key)]);
    expect(storage.saved()).toBe(JSON.stringify(key));
  });

  it('says in a note that it replaced a key it could not use, and the note carries neither the key that was there nor the new one', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const key = await loadPageKey(fakeStorage(JSON.stringify('too short')), warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/page key/i);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('too short');
  });
});

describe('a key that is made', () => {
  it('is a random UUID when the platform has one, saved as a JSON string (the slots of the host hold JSON), and returned', async () => {
    const storage = fakeStorage();
    const key = await loadPageKey(storage);
    expect(key).toMatch(UUID);
    expect(storage.writes).toHaveLength(1);
    expect(keyOf(storage.saved())).toBe(key);
  });

  it('is found again by the next load of the same place: one key for the lifetime of the window, whatever the number of reloads', async () => {
    const storage = fakeStorage();
    const first = await loadPageKey(storage);
    const second = await loadPageKey(storage);
    const third = await loadPageKey(storage);
    expect([second, third]).toEqual([first, first]);
    expect(storage.writes).toHaveLength(1);
  });

  it('is different for every window that has none: twenty places, twenty keys', async () => {
    const keys = new Set<string>();
    for (let window = 0; window < 20; window += 1) {
      keys.add(await loadPageKey(fakeStorage()));
    }

    expect(keys.size).toBe(20);
  });

  it('is made from the platform\'s random numbers when it has no `randomUUID` (a page served over plain HTTP has `getRandomValues` and no `randomUUID`): 128 random bits in hexadecimal', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        bytes.forEach((_, index) => {
          bytes[index] = (index * 37 + 11) % 256;
        });
        return array;
      },
    });
    const storage = fakeStorage();
    const key = await loadPageKey(storage);
    expect(key).toBe('0b30557a9fc4e90e33587da2c7ec1136');
    expect(keyOf(storage.saved())).toBe(key);
  });

  it('is made all the same when the platform has no random numbers at all: still 16 to 128 visible characters, and not the same twice', async () => {
    vi.stubGlobal('crypto', undefined);
    const first = await loadPageKey(fakeStorage());
    const second = await loadPageKey(fakeStorage());
    expect(first).toMatch(USABLE);
    expect(second).toMatch(USABLE);
    expect(second).not.toBe(first);
  });
});

describe('a place that cannot be used: the window gets a key all the same, and it never rejects', () => {
  const NOTE = /page key/i;

  it('makes a key that works for the life of the page when the place cannot be read, tries to save it, and says so on the console without the key in the note', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const storage = fakeStorage(undefined, { read: new Error('the window service is not there') });
    const key = await loadPageKey(storage, warn);
    expect(key).toMatch(USABLE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(NOTE);
    expect(String(warn.mock.calls[0]?.[0])).toContain('the window service is not there');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    // The next reload finds this one, if the place has recovered by then: what this page starts is then found again.
    expect(storage.writes).toEqual([JSON.stringify(key)]);
  });

  it('keeps the key it made when the place cannot be written, says so, and does not carry the key in the note', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const storage = fakeStorage(undefined, { write: new Error('the disk is full') });
    const key = await loadPageKey(storage, warn);
    expect(key).toMatch(USABLE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(NOTE);
    expect(String(warn.mock.calls[0]?.[0])).toContain('the disk is full');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
  });

  it('is a note for each thing that failed, and still a key, when the place can be neither read nor written', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const storage = fakeStorage(undefined, { read: new Error('no read'), write: new Error('no write') });
    const key = await loadPageKey(storage, warn);
    expect(key).toMatch(USABLE);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
  });

  it('does not reject for a place that throws at once instead of answering later', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const throwing: KeyStorage = {
      read: () => {
        throw new Error('sync failure');
      },
      write: () => {
        throw new Error('sync failure too');
      },
    };
    await expect(loadPageKey(throwing, warn)).resolves.toMatch(USABLE);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('says nothing about a place that works', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    await loadPageKey(fakeStorage(), warn);
    await loadPageKey(fakeStorage(JSON.stringify(SAVED)), warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not wait for a place that never answers: past the deadline the window has its key, made for this page, and a note says that each call did not answer', async () => {
    const warn = vi.fn<(message: string, detail?: unknown) => void>();
    const hung: KeyStorage = { read: async () => new Promise<string | undefined>(() => undefined), write: async () => new Promise<void>(() => undefined) };
    let key: string | undefined;
    void loadPageKey(hung, warn).then((made) => {
      key = made;
    });
    await vi.advanceTimersByTimeAsync(KEY_DEADLINE_MS - 1);
    expect(key).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // The read gave up; the key is made and its save is tried, and has its own deadline.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(key).toBeUndefined();
    await vi.advanceTimersByTimeAsync(KEY_DEADLINE_MS);
    expect(key).toMatch(USABLE);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/did not answer/);
    expect(String(warn.mock.calls[1]?.[0])).toMatch(/did not answer/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('puts no timer behind it when the place answers: nothing is left to fire', async () => {
    await loadPageKey(fakeStorage());
    await loadPageKey(fakeStorage(JSON.stringify(SAVED)));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the key through the window service, end to end', () => {
  it('is made by the first load and read by the second from the same slots, with the other slots left alone', async () => {
    const service = windowService({ session: '{"v":1}', notices: '{"n":1}' });
    const first = await loadPageKey(mainWindow(service));
    const second = await loadPageKey(mainWindow(service));
    expect(second).toBe(first);
    expect(first).toMatch(UUID);
    expect(service.slots.get('main')).toEqual({ session: '{"v":1}', notices: '{"n":1}', 'terminal-page-key': JSON.stringify(first) });
    expect(service.calls.filter((call) => call[0] === 'SaveState')).toHaveLength(1);
  });

  it('makes a key for each window: a second window of the host has its own, and the first is not disturbed', async () => {
    const service = windowService();
    const first = await loadPageKey(mainWindow(service));
    const second = await loadPageKey(terminalKeyStorage({ client: service.client, name: async () => Promise.resolve('second') }));
    expect(second).not.toBe(first);
    expect(keyOf(service.slots.get('main')?.['terminal-page-key'])).toBe(first);
    expect(keyOf(service.slots.get('second')?.['terminal-page-key'])).toBe(second);
  });
});
