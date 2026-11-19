import type { SessionStorage } from './types';

// The session kept in the slots of the window the host's Go side holds for it (`backend/window`: `GetState` returns a window's slots, `SaveState` stores one and persists them to `windows.json` in
// the instance's state root, atomically, and flushes at shutdown). One window, one set of slots, one state root for each channel: the isolation the feature channel already has. The old shell keeps
// its `pages` and `drawer` there; the session uses its own slots and reads no other. The runtime's binding and the window's name are handed in, so this knows no runtime.

/** The slot of a window that holds its session. */
export const SESSION_SLOT = 'session';

/** What the session needs of the host's window service: the two calls, as the generated binding has them. */
export type WindowState = {
  readonly GetState: (name: string) => Promise<Readonly<Record<string, string | undefined>>>;
  readonly SaveState: (name: string, slot: string, stateJSON: string) => Promise<void>;
};

export type WindowStorageOptions = {
  readonly client: WindowState;
  /** The name of the window this page is in (the runtime knows it). Asked for once, and again after a failure. */
  readonly name: () => Promise<string>;
};

export function windowStorage({ client, name }: WindowStorageOptions): SessionStorage {
  let named: Promise<string> | undefined;
  const windowName = async (): Promise<string> => {
    named ??= name().catch((error: unknown) => {
      named = undefined;
      throw error;
    });
    return named;
  };

  return {
    read: async () => (await client.GetState(await windowName()))[SESSION_SLOT],
    write: async (text) => {
      await client.SaveState(await windowName(), SESSION_SLOT, text);
    },
    // A slot is JSON in the host, and what is kept aside may not be (it is kept because it could not be read): it goes in as a JSON string, and comes out of it exactly as it was.
    keep: async (aside, text) => {
      await client.SaveState(await windowName(), aside, JSON.stringify(text));
    },
  };
}

/** The window the host's service keeps for a page served to a browser (and the only one a development instance has): `window.MainWindowName` in `backend/window`. */
const MAIN_WINDOW = 'main';

export type WindowNameOptions = {
  /** The name the runtime gives the window this page is in. */
  readonly name: () => Promise<string>;
  /** The windows the host's window service knows (`List`). */
  readonly list: () => Promise<ReadonlyArray<{ readonly name: string }>>;
};

/**
 * The window this page is in, as the host's window service knows it. The app's own windows are registered with the service, so the runtime's name is the service's. A page the host serves to a
 * browser (server mode: development, the seam check) is no native window: the host names it for the connection (`browser-4`), the service has no such window, and the page keeps its session in
 * the main window's slots (every such tab of one instance shares them, as they share the instance). Rejects when either call does.
 */
export async function resolveWindowName({ name, list }: WindowNameOptions): Promise<string> {
  const own = await name();
  const known = await list();
  return known.some((candidate) => candidate.name === own) ? own : MAIN_WINDOW;
}
