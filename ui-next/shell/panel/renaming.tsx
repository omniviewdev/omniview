import { createContext, type ReactNode } from 'react';
import type { SessionId } from '../core/panel';

// Who is renaming which session tab: a person asks from the Terminal tool's toolbar (Rename session) and the strip of the tool draws the field in the tab. UI state of one window, never saved. No behavior yet.

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
  return { current: () => null, request: () => undefined, clear: () => undefined, subscribe: () => () => undefined };
}

export const RenamingContext = createContext<Renaming | null>(null);

export function RenamingProvider({ renaming, children }: { readonly renaming: Renaming; readonly children: ReactNode }) {
  return <RenamingContext value={renaming}>{children}</RenamingContext>;
}
