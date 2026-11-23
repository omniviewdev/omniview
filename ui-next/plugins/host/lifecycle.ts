import { UNLOAD_CAUSES, readIncompatibility, type Incompatibility, type UnloadCause } from '../loader/failure';

// What the host tells the window of a plugin that stops and of one that runs again, and what the window does with it (docs/development-plugin-lifecycle.md, "What the window is told when a
// plugin stops"). A window draws a plugin's interface from files the host serves and reaches its process through the host, so it cannot see the process end, the plugin reload, be uninstalled or be
// turned off: the host says so with `plugin/unloaded` (the plugin's id and one of seven words, `UnloadCause`: it also says a load failed, `failed` or `timeout`, and that it refused the plugin, `incompatible`), and says the plugin runs again with `plugin/state_change` (its phase became
// Running), the event every consumer of a plugin's availability already reads. The window drops what it drew from the plugin at the first and loads it again from its files at the second.
//
// Everything is read here as the host's values and nothing else: an id, one of seven words, a phase name, and for `incompatible` the two protocol numbers the host decided on (`incompatibility`: a protocol and a range of
// protocols, numbers and nothing else). The rest of what the two events carry is never read (a state change's `reason` is the host's own text and holds the error of a failure), so no word of a plugin or of its
// process reaches a page by this way.

export const UNLOADED_EVENT = 'plugin/unloaded';
export const STATE_CHANGE_EVENT = 'plugin/state_change';

/** The runtime's `Events`, as far as this reads it: a handler for a name, and the way to remove it. */
export type EventSource = {
  readonly On: (name: string, callback: (event: { readonly data?: unknown }) => void) => () => void;
};

/** What the store does of it (`PluginStore`). `incompatibility` is given with the cause `incompatible` and with no other. */
export type Lifecycle = {
  readonly unload: (id: string, cause: UnloadCause, incompatibility?: Incompatibility) => void;
  readonly revive: (id: string) => Promise<void>;
};

const isCause = (value: unknown): value is UnloadCause => UNLOAD_CAUSES.some((cause) => cause === value);

/** The plugin and why it is not there: the cause `incompatible` always comes with the host's two numbers, and no other cause with anything. */
export type Unloaded =
  | { readonly id: string; readonly cause: Exclude<UnloadCause, 'incompatible'> }
  | { readonly id: string; readonly cause: 'incompatible'; readonly incompatibility: Incompatibility };

/**
 * The plugin and why it is not there, from the payload of `plugin/unloaded`; `undefined` for a payload that is not an id and one of the seven words, and for `incompatible` without the two numbers the host decided on
 * (read from `incompatibility`; a refusal with no numbers has nothing true to say, so it is not taken for one). A member beside the cause on any other event is not read.
 */
export function readUnloaded(data: unknown): Unloaded | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const id: unknown = Reflect.get(data, 'pluginID');
  const cause: unknown = Reflect.get(data, 'cause');
  if (typeof id !== 'string' || id === '' || !isCause(cause)) {
    return undefined;
  }

  if (cause !== 'incompatible') {
    return { id, cause };
  }

  const incompatibility = readIncompatibility(Reflect.get(data, 'incompatibility'));
  return incompatibility === undefined ? undefined : { id, cause, incompatibility };
}

/** The plugin that runs, from the payload of `plugin/state_change`: its id when the phase it entered is Running, else `undefined`. The reason is never read. */
export function readRunning(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const id: unknown = Reflect.get(data, 'pluginID');
  return typeof id === 'string' && id !== '' && Reflect.get(data, 'to') === 'Running' ? id : undefined;
}

/**
 * Hands the store what the host says: a plugin that stopped is unloaded with the cause, one that runs is revived (the store loads only a plugin that was gone). Two handlers, and the function that
 * removes them both: the window holds no more however often it mounts the host.
 */
export function listenForLifecycle(plugins: Lifecycle, events: EventSource): () => void {
  const stops = [
    events.On(UNLOADED_EVENT, ({ data }) => {
      const gone = readUnloaded(data);
      if (gone === undefined) {
        return;
      }

      if (gone.cause === 'incompatible') {
        plugins.unload(gone.id, gone.cause, gone.incompatibility);
      } else {
        plugins.unload(gone.id, gone.cause);
      }
    }),
    events.On(STATE_CHANGE_EVENT, ({ data }) => {
      const id = readRunning(data);
      if (id !== undefined) {
        void plugins.revive(id);
      }
    }),
  ];

  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}
