import type { OpenPalette, PaletteStore } from '../core/palette';

// What the shell asks of its host to draw the command palette. The model (../core/palette) is the host's: it makes the store with the seam it needs (the tab model, the plugins, the commands), and
// hands the shell this. The shell knows no provider and no plugin; it draws the store's snapshot and calls its operations. Plain data and functions.

/** What the live region says, and how many things it was told: the serial changes with every announcement, so the same sentence told twice is two announcements. */
export type Announcement = { readonly text: string; readonly serial: number };

/** The live region's source: `PaletteSeam.announce` writes it, the surface reads it (`useSyncExternalStore`). */
export type Announcer = {
  readonly announce: (text: string) => void;
  /** The same object until something is announced. */
  readonly getSnapshot: () => Announcement;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createAnnouncer(): Announcer {
  let current: Announcement = Object.freeze({ text: '', serial: 0 });
  const listeners = new Set<() => void>();
  return {
    announce: (text) => {
      if (text === '') {
        return;
      }

      current = Object.freeze({ text, serial: current.serial + 1 });
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          listener();
        }
      }
    },
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type PaletteBindings = {
  readonly store: PaletteStore;
  readonly announcer: Announcer;
  /**
   * What the palette opens with, asked each time it opens: the route on screen, which the recent list leaves out (S73), and the chips that narrow the search to the place the user is in (S69).
   * The shell does not know either: the host reads them from the tab on screen.
   */
  readonly opening: () => OpenPalette;
};
