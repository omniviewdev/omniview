import type { PanelStore } from '../../shell/core/panel';
import { newUuid, STATE_VERSION, type Guard, type PersistedTab, type TabId, type TabPlace, type TabReceiver, type TabsStore, type TabWindows, type WindowPoint } from '../../shell/core/tabs';
import { SESSION_VERSION } from '../../shell/session';
import { MAIN_WINDOW } from '../../shell/session/window';

// A window of the app opening another (ch16 S64, S30), over the host's window service. Only where the app has native windows: a browser serves one window, so there the request is refused with a reason.

type Listed = ReadonlyArray<{ readonly name: string; readonly kind: string }>;

/** What the host's window service gives a window (`WindowClient`), as far as this reads it. */
export type WindowService = {
  readonly name: () => Promise<string>;
  /** Opens a workspace window that starts with this session document; resolves when the window exists. Given a point in the pixels of the window it names, the window opens under it. */
  readonly open: (session: string, at?: WindowPoint & { readonly window: string }) => Promise<unknown>;
  readonly close: (name: string) => Promise<unknown>;
  /** The windows that are open, in creation order. */
  readonly list: () => Promise<Listed>;
  readonly focus: (name: string) => Promise<unknown>;
  /** Places a window as a window torn off a strip is: under a point of its own pixels. */
  readonly place: (name: string, x: number, y: number) => Promise<unknown>;
  /** The size of a window's viewport: by it the service finds a window's content on the screen, to place a window by a point of it. */
  readonly viewport: (name: string, width: number, height: number) => Promise<unknown>;
  /**
   * The service's drag session of a tab dragged out of a strip over the other windows (`backend/window/drag.go`). `beginDrag` starts it with the tab as saved, `moveDrag` follows the pointer in this window's pixels, `endDrag` drops the tab on the window under the
   * pointer and answers whether that window took it and which window was under the pointer (empty when none was), and `cancelDrag` ends it with no drop. The window dropped on answers with `respondDrop`: whether it took the tab, and the id the tab has there.
   */
  readonly beginDrag: (drag: { readonly sessionId: string; readonly sourceWindow: string; readonly dragType: string; readonly payload: string }) => Promise<unknown>;
  readonly moveDrag: (sessionId: string, x: number, y: number) => Promise<unknown>;
  readonly endDrag: (sessionId: string, x: number, y: number) => Promise<{ readonly accepted: boolean; readonly targetWindow: string }>;
  readonly cancelDrag: (sessionId: string) => Promise<unknown>;
  readonly respondDrop: (sessionId: string, accepted: boolean, tab: string) => Promise<unknown>;
  /** The host's events (`Events`): one sent reaches every window, so each reads the target it is addressed to. `on` answers the function that stops it. */
  readonly emit: (event: string, data: unknown) => Promise<unknown>;
  readonly on: (event: string, listener: (data: unknown) => void) => () => void;
};

const DELIVER = 'windows/tab/deliver';
const DELIVERED = 'windows/tab/delivered';
const DELIVERY_MS = 2000;

type Delivery = { readonly deliveryId: string; readonly targetWindow: string; readonly payloadJson: string };
/** What the service says of a drag to the window it is over (hover) or dropped on (drop), with the pointer in that window's pixels; a leave carries the first two only. */
type Pointed = { readonly sessionId: string; readonly targetWindow: string; readonly payload: string; readonly clientX: number; readonly clientY: number };

const warn = (what: string) => (error: unknown): void => {
  console.warn(`[window] ${what}`, error);
};

/**
 * The tab model with windows, made once where the window's store is made. The model hands `how: 'window'` back because it has no windows (`open.ts`): here a destination opens in a new window that starts with
 * that one tab, and an open singleton moves there (after the window exists, so a failure loses nothing). A tab leaves for another window only once that window has adopted it (`windows`). A last tab that leaves
 * a window other than the main one closes it (S30), unless a panel session is still running in it: closing would strand it. Whether such a window should close anyway is an open question for the owner.
 */
export function withWindows(tabs: TabsStore, panel: PanelStore, service: WindowService | undefined): TabsStore {
  if (service === undefined) {
    return {
      ...tabs,
      open: (destination, options) => {
        const result = tabs.open(destination, options);
        return result.status === 'window' ? { status: 'refused', reason: 'unavailable', message: 'A new window opens in the desktop app.' } : result;
      },
    };
  }

  let named: Promise<string> | undefined;
  const own = async () => (named ??= service.name().catch((error: unknown) => {
    named = undefined;
    throw error;
  }));
  const launch = async (tab: Pick<PersistedTab, 'id' | 'route'>, at?: WindowPoint) => service.open(JSON.stringify({ version: SESSION_VERSION, tabs: { version: STATE_VERSION, active: tab.id, tabs: [tab] } }), at === undefined ? undefined : { window: await own(), ...at });

  // Told when the window starts, when its size changes and when a drag begins (every window reports then, so the service can find the one under the pointer), and not again for a size it has.
  let told = '';
  const report = () => {
    const size = `${String(window.innerWidth)}x${String(window.innerHeight)}`;
    if (size !== told) {
      told = size;
      own().then(async (self) => service.viewport(self, window.innerWidth, window.innerHeight)).catch(warn('the viewport could not be told'));
    }
  };

  window.addEventListener('resize', report);
  service.on('windows/drag/begin', () => {
    told = '';
    report();
  });
  report();

  // The tab leaves only once `send` has put it in the other window: whatever goes wrong leaves it here. A `send` that answers `false` sent nothing, and the tab stays.
  const leave = (id: TabId, guard: Guard | undefined, send: (tab: PersistedTab) => Promise<unknown>): ReturnType<TabWindows['moveToNew']> => {
    const tab = tabs.serialise().tabs.find((saved) => saved.id === id);
    if (tab === undefined) {
      return { status: 'noop' };
    }

    if (tabs.getSnapshot().tabs[id]?.flags.unsaved && guard?.confirmed !== true) {
      return { status: 'confirm', action: 'close', tabs: [id] };
    }

    send(tab).then((sent) => (sent === false ? undefined : tabs.detach(id, { confirmed: true }))).catch(warn('the tab could not be moved'));
    return { status: 'done' };
  };

  // A window of its own for the tab, under the point of this window where the pointer released it (S58). The only tab of a window other than the main one moves that window instead, and stays in it.
  const tearOff = async (tab: PersistedTab, at: WindowPoint) => {
    const self = await own();
    return self !== MAIN_WINDOW && tabs.getSnapshot().order.length === 1 ? service.place(self, at.x, at.y).then(() => false) : launch(tab, at);
  };

  // The service finds the window under the pointer, which marks where the tab would land (`receive`) and answers a drop; the tab leaves this window once that window has taken it. The calls run in order: a move waits for the one before it and is replaced by a newer
  // point, so a drag has one in flight and one waiting at most (HSH-27), and begin, drop and cancel are never skipped. A drop that no window took because none was under the pointer opens a window of its own (S58); one that a window under it refused leaves the tab where it is.
  const dragOut: TabWindows['dragOut'] = (id) => {
    const sessionId = newUuid();
    const payload = JSON.stringify(tabs.serialise().tabs.find((tab) => tab.id === id));
    let latest: WindowPoint = { x: 0, y: 0 };
    let queued = false;
    let tail: Promise<unknown> = Promise.resolve();
    const run = async <T>(call: () => Promise<T>): Promise<T> => {
      const result = tail.then(call);
      tail = result.catch(warn('a drag could not be told to the service'));
      return result;
    };

    const cancel = () => {
      void run(async () => service.cancelDrag(sessionId));
    };

    void run(async () => service.beginDrag({ sessionId, sourceWindow: await own(), dragType: 'tab', payload }));
    return {
      move: (x, y) => {
        latest = { x, y };
        if (!queued) {
          queued = true;
          void run(async () => {
            queued = false;
            return service.moveDrag(sessionId, latest.x, latest.y);
          });
        }
      },
      drop: (x, y) => {
        const moved = leave(id, undefined, async (tab) => {
          const { accepted, targetWindow } = await run(async () => service.endDrag(sessionId, x, y));
          if (accepted) {
            return service.focus(targetWindow);
          }

          return targetWindow === '' ? tearOff(tab, { x, y }) : false;
        });
        if (moved.status !== 'done') {
          cancel();
        }
      },
      cancel,
    };
  };

  const deliver = async (target: string, tab: PersistedTab) => new Promise<void>((resolve, reject) => {
    const deliveryId = newUuid();
    const stop = () => {
      clearTimeout(timer);
      off();
    };

    const fail = (error: unknown) => {
      stop();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(fail, DELIVERY_MS, new Error(`window "${target}" did not take the tab within ${String(DELIVERY_MS)} ms`));
    const off = service.on(DELIVERED, (data) => {
      const reply = data as { readonly deliveryId: string; readonly accepted: boolean };
      if (reply.deliveryId === deliveryId) {
        if (reply.accepted) {
          stop();
          resolve();
        } else {
          fail(new Error(`window "${target}" refused the tab`));
        }
      }
    });
    service.emit(DELIVER, { deliveryId, targetWindow: target, payloadJson: JSON.stringify(tab) } satisfies Delivery).catch(fail);
  });

  // The windows other than this one, as "Window N" by the order they were made. The menu reads them when it opens, so they are kept up to date as the service says they change.
  let others: ReturnType<TabWindows['others']> = [];
  const listed = async (windows: Listed) => {
    const self = await own();
    others = windows.filter((window) => window.kind === 'workspace').map((window, at) => ({ name: window.name, label: `Window ${String(at + 1)}` })).filter((window) => window.name !== self);
  };

  service.list().then(listed).catch(warn('the windows could not be listed'));
  service.on('windows/changed', (data) => {
    listed((data as { readonly windows: Listed }).windows).catch(warn('the windows could not be listed'));
  });

  // A tab handed to this window is shown here with its id, route, history and pin (`adopt`), and where it was dropped on the strip, in the place the strip says.
  const take = (json: string, place?: TabPlace) => {
    const taken = tabs.adopt(JSON.parse(json));
    if (taken.status === 'done' && place !== undefined) {
      tabs.reorder(taken.id, place.to, { pinned: place.pinned });
    }

    return taken;
  };

  // Every window hears every event of the service: each acts only on one addressed to it (HSH-32), and a window that is not the one addressed changes nothing and asks the service nothing.
  const addressed = <T extends { readonly targetWindow: string }>(data: unknown, act: (event: T) => void) => {
    own().then((self) => {
      if ((data as T).targetWindow === self) {
        act(data as T);
      }
    }).catch(warn('an event for this window could not be taken'));
  };

  // A tab delivered to this window is taken, and the sender is told whether it was.
  service.on(DELIVER, (data) => {
    addressed<Delivery>(data, ({ deliveryId, payloadJson }) => {
      void service.emit(DELIVERED, { deliveryId, accepted: take(payloadJson).status === 'done' });
    });
  });

  // The strip that takes a tab another window drags over this one (`receive`): the service says where the pointer is in this window while it is over it, and that it is gone; a drop asks whether the strip takes the tab where it is dropped, and the end of any
  // drag takes the marker away.
  let strip: TabReceiver | undefined;
  service.on('windows/drag/hover', (data) => {
    addressed<Pointed>(data, ({ clientX, clientY }) => {
      strip?.({ x: clientX, y: clientY });
    });
  });

  service.on('windows/drag/leave', (data) => {
    addressed<Pointed>(data, () => {
      strip?.(undefined);
    });
  });

  service.on('windows/drag/drop', (data) => {
    addressed<Pointed>(data, ({ sessionId, payload, clientX, clientY }) => {
      const place = strip?.({ x: clientX, y: clientY });
      strip?.(undefined);
      const taken = place === undefined ? undefined : take(payload, place);
      const accepted = taken?.status === 'done';
      void service.respondDrop(sessionId, accepted, accepted ? taken.id : '');
    });
  });

  service.on('windows/drag/end', () => {
    strip?.(undefined);
  });

  const windows: TabWindows = {
    others: () => others,
    moveToNew: (id, guard) => leave(id, guard, launch),
    moveTo: (target, id, guard) => leave(id, guard, async (tab) => {
      await deliver(target, tab);
      return service.focus(target);
    }),
    dragOut,
    receive: (next) => {
      strip = next;
      return () => {
        strip = undefined;
      };
    },
  };

  const open: TabsStore['open'] = (destination, options) => {
    const result = tabs.open(destination, options);
    if (result.status !== 'window') {
      return result;
    }

    if (result.existing === undefined) {
      launch({ id: newUuid(), route: result.route }).catch(warn('the window could not be opened'));
      return result;
    }

    const moved = leave(result.existing, options, launch);
    return moved.status === 'confirm' ? moved : result;
  };

  tabs.subscribeTo((state) => state.order.length === 0, (empty) => {
    const live = Object.values(panel.getSnapshot().sessions).some((session) => session.state === 'starting' || session.state === 'running');
    if (empty && !live) {
      void own().then(async (name) => (name !== MAIN_WINDOW && tabs.getSnapshot().order.length === 0 ? service.close(name) : undefined)).catch(warn('the window could not be closed'));
    }
  });

  return { ...tabs, open, windows };
}
