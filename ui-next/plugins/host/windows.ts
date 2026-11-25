import type { PanelStore } from '../../shell/core/panel';
import { newUuid, STATE_VERSION, type Guard, type PersistedTab, type TabId, type TabsStore, type TabWindows } from '../../shell/core/tabs';
import { SESSION_VERSION } from '../../shell/session';
import { MAIN_WINDOW } from '../../shell/session/window';

// A window of the app opening another (ch16 S64, S30), over the host's window service. Only where the app has native windows: a browser serves one window, so there the request is refused with a reason.

type Listed = ReadonlyArray<{ readonly name: string; readonly kind: string }>;

/** What the host's window service gives a window (`WindowClient`), as far as this reads it. */
export type WindowService = {
  /** The name of this window, as the service knows it. */
  readonly name: () => Promise<string>;
  /** Opens a workspace window that starts with this session document; resolves when the window exists. */
  readonly open: (session: string) => Promise<unknown>;
  readonly close: (name: string) => Promise<unknown>;
  /** The windows that are open, in creation order. */
  readonly list: () => Promise<Listed>;
  readonly focus: (name: string) => Promise<unknown>;
  /** The host's events (`Events`): one sent reaches every window, so each reads the target it is addressed to. `on` answers the function that stops it. */
  readonly emit: (event: string, data: unknown) => Promise<unknown>;
  readonly on: (event: string, listener: (data: unknown) => void) => () => void;
};

const WINDOWS_CHANGED = 'windows/changed';
const DELIVER = 'windows/tab/deliver';
const DELIVERED = 'windows/tab/delivered';
const DELIVERY_MS = 2000;

type Delivery = { readonly deliveryId: string; readonly targetWindow: string; readonly payloadJson: string };

const warn = (what: string) => (error: unknown): void => {
  console.warn(`[window] ${what}`, error);
};

/**
 * The tab model with windows, made once where the window's store is made. The model hands `how: 'window'` back because it has no windows (`open.ts`): here a destination opens in a new window that starts with
 * that one tab, and an open singleton moves there (after the window exists, so a failure loses nothing). A tab can also move to a new window or to another open one (`windows`): the other window is handed the
 * tab as saved (`windows/tab/deliver`, answered by `windows/tab/delivered` within two seconds) and adopts it, and only then does the tab leave this one. A last tab that leaves a window other than the main one
 * closes it (S30), unless a panel session is still running in it: closing would strand it. Whether such a window should close anyway is an open question for the owner. A window is named "Window N" by its place in
 * the order of creation, since the service keeps no name for it.
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
  const own = async () => (named ??= service.name());
  const launch = async (tab: Pick<PersistedTab, 'id' | 'route'>) => service.open(JSON.stringify({ version: SESSION_VERSION, tabs: { version: STATE_VERSION, active: tab.id, tabs: [tab] } }));

  // The tab leaves only once `send` has put it in the other window: whatever goes wrong leaves it here.
  const leave = (id: TabId, guard: Guard | undefined, send: (tab: PersistedTab) => Promise<unknown>): ReturnType<TabWindows['moveToNew']> => {
    const tab = tabs.serialise().tabs.find((saved) => saved.id === id);
    if (tab === undefined) {
      return { status: 'noop' };
    }

    if (tabs.getSnapshot().tabs[id]?.flags.unsaved && guard?.confirmed !== true) {
      return { status: 'confirm', action: 'close', tabs: [id] };
    }

    send(tab).then(() => tabs.detach(id, { confirmed: true })).catch(warn('the tab could not be moved'));
    return { status: 'done' };
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
  service.on(WINDOWS_CHANGED, (data) => {
    listed((data as { readonly windows: Listed }).windows).catch(warn('the windows could not be listed'));
  });

  // A tab delivered to this window is adopted and shown, and the sender is told whether it was. Every window hears every delivery: only the one it is addressed to acts.
  service.on(DELIVER, (data) => {
    const { deliveryId, targetWindow, payloadJson } = data as Delivery;
    own().then((self) => {
      if (targetWindow === self) {
        void service.emit(DELIVERED, { deliveryId, accepted: tabs.adopt(JSON.parse(payloadJson)).status === 'done' });
      }
    }).catch(warn('a delivered tab could not be taken'));
  });

  const windows: TabWindows = {
    others: () => others,
    moveToNew: (id, guard) => leave(id, guard, launch),
    moveTo: (target, id, guard) => leave(id, guard, async (tab) => {
      await deliver(target, tab);
      return service.focus(target);
    }),
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
      void own().then(async (name) => name === MAIN_WINDOW ? undefined : service.close(name)).catch(warn('the window could not be closed'));
    }
  });

  return { ...tabs, open, windows };
}
