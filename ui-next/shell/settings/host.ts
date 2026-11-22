import type { ComponentType } from 'react';
import { rememberFocus, restoreFocus, type Remembered } from '../palette/focus';
import type { SettingsSession } from './model/session';
import type { SettingsClient } from './model/types';

// The part of Settings that is always loaded: whether the sheet is open, the page it was last on, and the loading of everything else. The sheet itself (the adapter, the session, the parts it draws) is a chunk of the build that the
// window fetches when somebody first asks for Settings (`surface.tsx`), so a window that never opens it never pays for it. A closed sheet is this store and nothing else: no node, no listener, no timer.

/** The page of Settings that was last on screen: kept for the life of the window, so that Settings opens where it was left (the old window kept its location too). Not saved: a new window starts on the first page. */
export type PageMemory = { readonly get: () => string | undefined; readonly set: (id: string) => void };

export type SurfaceProps = {
  readonly session: SettingsSession;
  readonly page: PageMemory;
  readonly onClose: () => void;
};

/** What the lazy chunk gives: the sheet's component and the way to make its session (so that the session, which holds the adapter and the form model, is part of the chunk too). */
export type SurfaceModule = {
  readonly Surface: ComponentType<SurfaceProps>;
  readonly createSession: (client: SettingsClient | undefined) => SettingsSession;
};

export type SettingsSheetState =
  | { readonly open: false }
  | { readonly open: true; readonly module: SurfaceModule; readonly session: SettingsSession };

export type SettingsControl = {
  readonly getSnapshot: () => SettingsSheetState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Asks for the sheet. It opens when its code has arrived; asked again while it loads or is open, it does nothing. */
  readonly open: () => void;
  /** Closes the sheet, whether it is open or still loading, and gives the focus back to what had it when it was asked for. */
  readonly close: () => void;
  readonly page: PageMemory;
};

export type SettingsControlOptions = {
  /** Fetches the sheet's code: `() => import('./surface')`. Called at most once while it succeeds. */
  readonly load: () => Promise<SurfaceModule>;
  /** The host's settings service. Absent: the sheet reads the runtime's. */
  readonly client?: SettingsClient | undefined;
  /** Hears why the code could not be loaded. The sheet stays closed and can be asked for again. Default: the console. */
  readonly onError?: ((error: unknown) => void) | undefined;
};

const CLOSED: SettingsSheetState = Object.freeze({ open: false });

export function createSettingsControl({ load, client, onError }: SettingsControlOptions): SettingsControl {
  let state: SettingsSheetState = CLOSED;
  let loading: Promise<SurfaceModule> | undefined;
  // Somebody asked and has not closed it again: the sheet is opening or open.
  let wanted = false;
  let opener: Remembered | undefined;
  let page: string | undefined;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const open = (): void => {
    if (wanted) {
      return;
    }

    wanted = true;
    // The element that has the focus now is where it goes back to: asked from the page, the Settings control or the palette's command (which gives its own focus back first).
    opener = rememberFocus();
    loading ??= load();
    loading.then(
      (loaded) => {
        if (wanted && !state.open) {
          state = { open: true, module: loaded, session: loaded.createSession(client) };
          emit();
        }
      },
      (error: unknown) => {
        loading = undefined;
        if (wanted) {
          wanted = false;
          opener = undefined;
        }

        (onError ?? ((cause) => {
          console.error('[settings] the sheet could not be loaded', cause);
        }))(error);
      },
    );
  };

  const close = (): void => {
    if (!wanted) {
      return;
    }

    wanted = false;
    const back = opener;
    opener = undefined;
    const closing = state;
    if (closing.open) {
      state = CLOSED;
      closing.session.dispose();
      emit();
      // Once the sheet is gone from the page (the browser's modal would keep the rest inert, and a focus given back under it goes nowhere): to what had it, or to the page when that is gone.
      queueMicrotask(() => {
        if (back !== undefined) {
          restoreFocus(back);
        }
      });
    }
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    close,
    page: {
      get: () => page,
      set: (id) => {
        page = id;
      },
    },
  };
}
