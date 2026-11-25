import type { PanelStore } from '../../shell/core/panel';
import { newUuid, STATE_VERSION, type TabsStore } from '../../shell/core/tabs';
import { SESSION_VERSION } from '../../shell/session';
import { MAIN_WINDOW } from '../../shell/session/window';

// A window of the app opening another (ch16 S64, S30), over the host's window service. Only where the app has native windows: a browser serves one window, so there the request is refused with a reason.

/** What the host's window service gives a window (`WindowClient`), as far as this reads it. */
export type WindowService = {
  /** The name of this window, as the service knows it. */
  readonly name: () => Promise<string>;
  /** Opens a workspace window that starts with this session document; resolves when the window exists. */
  readonly open: (session: string) => Promise<unknown>;
  readonly close: (name: string) => Promise<unknown>;
};

const warn = (what: string) => (error: unknown): void => {
  console.warn(`[window] ${what}`, error);
};

/**
 * The tab model with windows, made once where the window's store is made. The model hands `how: 'window'` back because it has no windows (`open.ts`): here a destination opens in a new window that starts with
 * that one tab, and an open singleton moves there (after the window exists, so a failure loses nothing). A last tab that leaves a window other than the main one closes it (S30), unless a panel session is still
 * running in it: closing would strand it. Whether such a window should close anyway is an open question for the owner.
 */
export function withWindows(tabs: TabsStore, panel: PanelStore, service: WindowService | undefined): TabsStore {
  const open: TabsStore['open'] = (destination, options) => {
    const result = tabs.open(destination, options);
    if (result.status !== 'window') {
      return result;
    }

    if (service === undefined) {
      return { status: 'refused', reason: 'unavailable', message: 'A new window opens in the desktop app.' };
    }

    const { existing } = result;
    if (existing !== undefined && tabs.getSnapshot().tabs[existing]?.flags.unsaved && options?.confirmed !== true) {
      return { status: 'confirm', action: 'close', tabs: [existing] };
    }

    const tab = tabs.serialise().tabs.find((saved) => saved.id === existing) ?? { id: newUuid(), route: result.route };
    const session = { version: SESSION_VERSION, tabs: { version: STATE_VERSION, active: tab.id, tabs: [tab] } };
    service.open(JSON.stringify(session)).then(() => existing === undefined ? undefined : tabs.detach(existing, { confirmed: true })).catch(warn('the window could not be opened'));
    return result;
  };

  if (service !== undefined) {
    tabs.subscribeTo((state) => state.order.length === 0, (empty) => {
      const live = Object.values(panel.getSnapshot().sessions).some((session) => session.state === 'starting' || session.state === 'running');
      if (empty && !live) {
        void service.name().then(async (name) => name === MAIN_WINDOW ? undefined : service.close(name)).catch(warn('the window could not be closed'));
      }
    });
  }

  return { ...tabs, open };
}
