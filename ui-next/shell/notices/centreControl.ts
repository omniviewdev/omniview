// The notification centre's controller (ch16 S80; the mock's `Shell.feedback.openCenter` and `Shell.state.feedback.center`, shell-feedback.js): whether the centre is open, and the source its list is narrowed to. It is
// framework-free and outside the view for one reason: the model's seam calls it (the summary toast's Show asks the host to open the centre, `NoticesSeam.openCenter`), and so can a command. The view reads it with
// `useSyncExternalStore` and draws; it never decides anything the controller does not say.
//
// The narrowing outlives a close, as the mock's does (`centerClosed` keeps `source`): a person who looked at one source's notices finds the list as they left it, with the note that says so and the button that clears it.

export type CentreState = {
  readonly open: boolean;
  /** The source whose records the list shows; empty is every source. */
  readonly source: string;
};

export type Centre = {
  readonly getSnapshot: () => CentreState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Opens the centre. Open already: nothing. */
  readonly open: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
  /** Narrows the list to one source; empty shows them all. */
  readonly filter: (source: string) => void;
};

export function createCentre(): Centre {
  let state: CentreState = Object.freeze({ open: false, source: '' });
  const listeners = new Set<() => void>();

  const change = (next: Partial<CentreState>): void => {
    const open = next.open ?? state.open;
    const source = next.source ?? state.source;
    if (open === state.open && source === state.source) {
      return;
    }

    state = Object.freeze({ open, source });
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const open = (): void => {
    change({ open: true });
  };

  const close = (): void => {
    change({ open: false });
  };

  const toggle = (): void => {
    change({ open: !state.open });
  };

  const filter = (source: string): void => {
    change({ source });
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
    toggle,
    filter,
  };
}
