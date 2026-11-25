import { NetworkerClient } from '@omniviewdev/runtime/api';
import { Events, onEventsReconnect } from '@omniviewdev/runtime/runtime';
import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { STATE_CHANGE_EVENT, UNLOADED_EVENT, type EventSource } from '../../../plugins/host/lifecycle';
import { copyToClipboard } from '../logs/clipboard';

// What the Ports tool asks of the window and the host, as far as it asks it: the host's calls on port forwards and the events that say the list changed, what opens an address outside the app, what puts text on the clipboard, and
// the name the window knows for a connection. The store (`PortsStore.ts`) is written over this type and its tests over fakes; `productionPorts` is the one binding to the runtime and it adapts and decides nothing.

/** The host's two events on forwards (`backend/pkg/plugin/networker/controller.go`: `PortForwardSessionCreated`, `PortForwardSessionClosed`): the payload of each is the session. */
export const CREATED_EVENT = 'core/networker/portforward/created';
export const CLOSED_EVENT = 'core/networker/portforward/closed';
/** The host's event that the status of a connection changed (`backend/pkg/plugin/resource/controller.go`: `EventConnectionStatus`). A connection that is retired ends its forwards with no event of their own, so a change of status is a reason to read the list again. */
export const CONNECTION_EVENT = 'connection/status';
/** The plugin lifecycle events the window already hears (`plugins/host/lifecycle.ts`): a plugin that stopped, and one that runs again. */
export { STATE_CHANGE_EVENT, UNLOADED_EVENT };

/** What of the runtime's `NetworkerClient` the tool uses. A session is read from what the host answers (`readForward`), so the answer is `unknown`. */
export type PortsClient = {
  /** Every forward the host holds, whatever started it and in whichever window: the list is global (docs/ui-next/status/PF1.md, W-PF1). An entry may be null. */
  readonly ListAllPortForwardSessions: () => PromiseLike<readonly unknown[] | null | undefined>;
  /** Closes a forward: the host ends the tunnel, forgets the session and tells every window that it is closed. */
  readonly ClosePortForwardSession: (sessionId: string) => PromiseLike<unknown>;
};

/** The name a window knows for a connection of a plugin, and when one of them changes. */
export type PortNames = {
  readonly of: (plugin: string, connection: string) => string | undefined;
  readonly subscribe: (listener: () => void) => () => void;
};

/** Why a call of the host failed, in words a person reads: whether the host has no such forward (it is gone), and the host's own sentence for what went wrong (it may be empty). */
export type Explained = { readonly gone: boolean; readonly text: string };

export type PortsDeps = {
  readonly client: PortsClient;
  readonly events: EventSource;
  /**
   * Opens an address outside the app, in the system's browser. Required: the tool draws Open in browser only because there is a way to do it. A way that throws or rejects is one announcement ("Couldn't open ...") and a
   * warning on the console.
   */
  readonly openExternal: (url: string) => void | PromiseLike<void>;
  /** Puts text on the clipboard; whether it did. Never rejects. */
  readonly copy: (text: string) => PromiseLike<boolean> | boolean;
  /** The names of the connections. Absent: the window has no connection data, and a forward's connection is a dash. */
  readonly names?: PortNames | undefined;
  readonly explain: (error: unknown) => Explained;
  /** Runs `run` after `ms` milliseconds; answers the function that cancels it. The tool has one timer at most, started by a press of Copy and gone with its answer. */
  readonly schedule: (run: () => void, ms: number) => () => void;
  /**
   * Runs `run` at the window's next frame, never at once; answers the function that cancels it. The store asks for one at a time, and only when the host has said something: what the host says in a burst of tasks is one snapshot, shown in one
   * frame. A window that the host says nothing to asks for none.
   */
  readonly frame: (run: () => void) => () => void;
  /**
   * Calls `listener` when the page's events connection comes back after a gap, which only a page the host serves to a browser has (a native window's events come over the native bridge, and this never fires). What the host did while the
   * connection was down was not told, and nothing is replayed, so the list is read again. Answers the function that stops it.
   */
  readonly reconnect: (listener: () => void) => () => void;
  /**
   * Calls `listener` when the window comes back to a person: it gains the focus or the page becomes visible. The events cannot say everything (a tunnel that ended on its own, a plugin that died, are told by no event), so the list is read
   * again when somebody looks. Answers the function that stops it. The tool listens only while it is on screen.
   */
  readonly wake: (listener: () => void) => () => void;
};

/** The type of the error the host answers for a session it does not have (`apperror.SessionNotFound`, `ErrorTypes.SESSION_NOT_FOUND` in the runtime). */
const SESSION_NOT_FOUND = 'omniview:session/not-found';

const later = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** The window's next frame: one for each refresh of the display, and none while the window is hidden. */
const nextFrame = (run: () => void): (() => void) => {
  const frame = requestAnimationFrame(() => {
    run();
  });
  return () => {
    cancelAnimationFrame(frame);
  };
};

/** The window coming back to a person: it gains the focus, or the page becomes visible. */
const regained = (listener: () => void): (() => void) => {
  const visible = (): void => {
    if (document.visibilityState === 'visible') {
      listener();
    }
  };

  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', visible);
  };
};

/** The host's error as the runtime reads it: the type says whether the session is not there, and the detail is the public structured cause, which the host has already made safe to show. */
const explain = (error: unknown): Explained => {
  const read = parseAppError(error);
  return { gone: read.type === SESSION_NOT_FOUND, text: read.detail };
};

/**
 * What the tool is given by the runtime itself: the networker's calls, the events, the clipboard the Logs and the Terminal tools copy with (the asynchronous clipboard, and the document's command where it refuses) and the host's error reading. Not
 * the runtime's `Clipboard`, which copies on the machine that runs the host: a window in a browser asks for the browser's. Opening an address is the window's to give (`PortsOptions.openExternal`): the host's own call is in `plugins/host`.
 */
export const productionPorts: Omit<PortsDeps, 'openExternal'> = {
  client: NetworkerClient,
  events: Events,
  copy: copyToClipboard,
  explain,
  schedule: later,
  frame: nextFrame,
  reconnect: onEventsReconnect,
  wake: regained,
};
