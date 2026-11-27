import { createContext, useContext, useState, type ReactNode } from 'react';
import type { SessionId } from '../core/panel';

// Who is renaming which session tab: a person asks from the Terminal tool's toolbar (Rename session) or on the tab itself, and the strip of the tool draws the field in the tab. UI state of one window, never saved.

export type Renaming = {
  /** The session whose tab is being renamed, or `null`. */
  readonly current: () => SessionId | null;
  /** Starts the rename of a session's tab. */
  readonly request: (id: SessionId) => void;
  /** The rename is over. */
  readonly clear: () => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createRenaming(): Renaming {
  let current: SessionId | null = null;
  const listeners = new Set<() => void>();
  const set = (next: SessionId | null) => {
    if (next === current) {
      return;
    }

    current = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    current: () => current,
    request: (id) => {
      set(id);
    },
    clear: () => {
      set(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const RenamingContext = createContext<Renaming | null>(null);

/** Gives the strip and the tools of a window the one `Renaming` they share; the panel's provider makes one. */
export function RenamingProvider({ renaming, children }: { readonly renaming: Renaming | null; readonly children: ReactNode }) {
  return <RenamingContext value={renaming}>{children}</RenamingContext>;
}

/** The window's `Renaming`, or `null` where a window has no strip of tabs to draw the field in. */
export function useMaybeRenaming(): Renaming | null {
  return useContext(RenamingContext);
}

/** The window's `Renaming`, for the parts of the panel that are always inside its provider. */
export function useRenaming(): Renaming {
  const renaming = useContext(RenamingContext);
  if (renaming === null) {
    throw new Error('A component of the panel was rendered outside a Shell that has one.');
  }

  return renaming;
}

/** The panel's own provider: one `Renaming` for the life of the window's panel. */
export function PanelRenaming({ children }: { readonly children: ReactNode }) {
  const [renaming] = useState(createRenaming);
  return <RenamingProvider renaming={renaming}>{children}</RenamingProvider>;
}
