import { describe, expect, it, vi } from 'vitest';
import { resolveWindowName, SESSION_SLOT, windowStorage, type WindowState } from './window';

// The session kept in the slots of the window the host's Go side holds for it (`backend/window`: `GetState` and `SaveState`, persisted to `windows.json` in the instance's state root). The
// client and the window's name are injected, so what is under test is the mapping: which slot, what is written, what is asked, and when.

type Calls = { readonly get: string[]; readonly save: Array<readonly [name: string, slot: string, text: string]> };

function world(slots: Readonly<Record<string, string | undefined>> = {}) {
  const calls: Calls = { get: [], save: [] };
  const client: WindowState = {
    GetState: async (name) => {
      calls.get.push(name);
      return slots;
    },
    SaveState: async (name, slot, text) => {
      calls.save.push([name, slot, text]);
    },
  };
  const named = vi.fn(async () => 'main');
  return { calls, client, named, storage: windowStorage({ client, name: named }) };
}

describe('the session in a window\'s slots', () => {
  it('reads the session slot of the window the runtime names', async () => {
    const { storage, calls, named } = world({ session: '{"version":1}' });
    expect(await storage.read()).toBe('{"version":1}');
    expect(calls.get).toEqual(['main']);
    expect(named).toHaveBeenCalledTimes(1);
  });

  it('answers nothing when the window has no session yet, and never reads another slot: the old shell\'s `pages` and `drawer` are not the session', async () => {
    const { storage } = world({ pages: '{"version":1}', drawer: '{}' });
    expect(await storage.read()).toBeUndefined();
  });

  it('writes the text to the session slot of the window', async () => {
    const { storage, calls } = world();
    await storage.write('{"version":1}');
    expect(calls.save).toEqual([['main', SESSION_SLOT, '{"version":1}']]);
  });

  it('keeps text aside in a slot of the name it is given, as a JSON string: the host holds a slot as JSON, and what is kept may not be', async () => {
    const { storage, calls } = world();
    await storage.keep('session.invalid.1700000000000', '{"version":');
    expect(calls.save).toEqual([['main', 'session.invalid.1700000000000', JSON.stringify('{"version":')]]);
    const [, , written] = calls.save[0] ?? [];
    expect(JSON.parse(written ?? '')).toBe('{"version":');
  });

  it('asks the runtime for the window\'s name once, however many calls it makes', async () => {
    const { storage, named } = world();
    await storage.read();
    await storage.write('{}');
    await storage.keep('a', 'b');
    expect(named).toHaveBeenCalledTimes(1);
  });

  it('rejects, for the session to word, when the window cannot be named or its slots cannot be read', async () => {
    const unnamed = windowStorage({ client: world().client, name: async () => Promise.reject(new Error('no runtime')) });
    await expect(unnamed.read()).rejects.toThrow('no runtime');
    const broken = windowStorage({
      client: { GetState: async () => Promise.reject(new Error('unknown window "main"')), SaveState: async () => undefined },
      name: async () => 'main',
    });
    await expect(broken.read()).rejects.toThrow('unknown window');
  });

  it('asks again for the name after a failure to give it: a runtime that was not ready yet may be', async () => {
    let answers = 0;
    const storage = windowStorage({
      client: world({ session: '{}' }).client,
      name: async () => {
        answers += 1;
        if (answers === 1) {
          throw new Error('not ready');
        }

        return 'main';
      },
    });
    await expect(storage.read()).rejects.toThrow('not ready');
    expect(await storage.read()).toBe('{}');
  });
});

// A page the host serves to a browser (server mode: development, the seam check) is no native window: the host names it for the connection (`browser-4`), and the window service knows only the
// windows it created, `main` among them. Such a page keeps its session in the main window's slots.
describe('the name of the window a page is in', () => {
  const windows = (...names: string[]) => async () => names.map((name) => ({ name }));

  it('is the name the runtime gives when the window service knows it: the app\'s own window', async () => {
    expect(await resolveWindowName({ name: async () => 'main', list: windows('main') })).toBe('main');
    expect(await resolveWindowName({ name: async () => 'w-1a2b', list: windows('main', 'w-1a2b') })).toBe('w-1a2b');
  });

  it('is `main` when the window service does not know it: a browser tab the host serves', async () => {
    expect(await resolveWindowName({ name: async () => 'browser-4', list: windows('main') })).toBe('main');
  });

  it('rejects when the runtime cannot name the window or the service cannot list its windows: the session then starts empty and saves nothing', async () => {
    await expect(resolveWindowName({ name: async () => Promise.reject(new Error('no runtime')), list: windows('main') })).rejects.toThrow('no runtime');
    await expect(resolveWindowName({ name: async () => 'main', list: async () => Promise.reject(new Error('the service is down')) })).rejects.toThrow('the service is down');
  });
});
