// The page's events connection, in server mode (a page the host serves to a browser). The host's events reach the page on one WebSocket, /wails/events, which the script the Wails runtime loads (/wails/custom.js, a constant of Wails' own
// server) opens and, when it drops, opens again after a second. Nothing is replayed to the new socket: an event that was told while it was down is lost to the page for good, and nothing in the runtime says when the socket is back.
//
// WHERE THE FACT IS STATED, AND WHERE IT STOPS. The host cannot say it: Wails accepts the socket inside its own route (`WebSocketBroadcaster.ServeHTTP` and `register`, pkg/application/websocket_server.go), ahead of the asset
// server and every middleware the host has, and it fires no callback, emits no event and writes no first frame; the host only looks a page's socket up (`application.GetBrowserWindow`). So the page notices its own socket: the
// constructor is wrapped in a Proxy while somebody listens, and an `open` listener is added to the sockets whose URL path is exactly the events path. If Wails ever states the fact (a callback or an event from `register`), this
// module becomes a subscription to that event and the wrapper is deleted.
//
// WHAT THE WRAPPER DOES NOT DO. `construct` returns the REAL instance, made by the native constructor for whoever asked (`newTarget` is passed through, so a subclass makes an instance of itself): the instance, its prototype
// (`WebSocket.prototype` is the native one), the statics, `instanceof` and subclassing are the native ones, and a socket that is not the events socket gets nothing added. It is installed at most once, only while a listener is
// subscribed, and the native constructor is put back when the last one goes (unless something else has replaced it meanwhile: that is left alone). A native window has no such socket (its events come over the native bridge): there
// the signal never fires. A listener that subscribes before the page's first connection hears that connection too.

const EVENTS_PATH = '/wails/events';

/** The parts of the page this needs: a scope is the page's global object, or a stand-in for one. */
export type EventsScope = {
  WebSocket?: typeof WebSocket | undefined;
  readonly location?: { readonly href: string } | undefined;
};

export type EventsReconnect = {
  /** Calls `listener` each time an events socket opens. Answers the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
};

function isEventsSocket(url: unknown, base: string | undefined): boolean {
  try {
    return new URL(String(url), base).pathname === EVENTS_PATH;
  } catch {
    return false;
  }
}

/** The signal over a scope. */
export function createEventsReconnect(scope: EventsScope): EventsReconnect {
  // The sockets that already carry this signal's listener: a constructor that this signal has wrapped twice (something replaced ours, and the next subscriber wrapped again) adds one listener to a socket and tells once. Another signal on
  // the same scope keeps a set of its own, and hears the socket too.
  const listened = new WeakSet<object>();
  const listeners = new Set<() => void>();
  let native: typeof WebSocket | undefined;
  let wrapper: typeof WebSocket | undefined;

  const tell = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const install = (): void => {
    const current = scope.WebSocket;
    if (wrapper !== undefined || current === undefined) {
      return;
    }

    const observed: typeof WebSocket = new Proxy(current, {
      construct: (target, args: unknown[], newTarget) => {
        // The real instance, made as the native constructor makes it for whoever asked; the socket that is returned is never one of ours.
        const socket = Reflect.construct(target, args, newTarget === observed ? target : newTarget) as WebSocket;
        if (!listened.has(socket) && isEventsSocket(args[0], scope.location?.href)) {
          listened.add(socket);
          socket.addEventListener('open', tell, { once: true });
        }

        return socket;
      },
    });
    native = current;
    wrapper = observed;
    scope.WebSocket = observed;
  };

  const uninstall = (): void => {
    // The native constructor goes back only over our own wrapper: a constructor that something else has put in its place is left alone. Either way this wrapper is no longer ours to rely on, so the next subscriber installs again (and a
    // socket that two wrappers see is listened to once).
    if (wrapper !== undefined && native !== undefined && scope.WebSocket === wrapper) {
      scope.WebSocket = native;
    }

    wrapper = undefined;
    native = undefined;
  };

  return {
    subscribe: (listener) => {
      install();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          uninstall();
        }
      };
    },
  };
}

const page = createEventsReconnect(globalThis);

/** Calls `listener` each time an events socket of the page opens, which after the first is when the connection came back. Answers the function that stops it. */
export function onEventsReconnect(listener: () => void): () => void {
  return page.subscribe(listener);
}
