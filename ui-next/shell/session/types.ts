import type { PersistedPanel } from '../core/panel';
import type { PersistedTabs } from '../core/tabs';

// What a window saves of itself, and the place it saves it in. The tab model and the panel model each have a document of their own (versioned, migratable, repaired rather than discarded); this
// one wraps the two with the choice the rail holds, which no model owns, and has a version of its own.

/** The version of the wrapper. A change to the tab model's or the panel model's part is migrated in that part, not here. */
export const SESSION_VERSION = 1;

export type PersistedSession = {
  readonly version: typeof SESSION_VERSION;
  /** The tab model's document: the tabs in strip order and the one on screen. */
  readonly tabs: PersistedTabs;
  /** The plugin whose sidebar the rail shows, as the user chose it; `null` when no entry was chosen. */
  readonly rail: string | null;
  /** The panel model's document: whether it is open, its height, its tool, the tool's session, and the identity of each session. */
  readonly panel: PersistedPanel;
};

/**
 * A place to keep the session as text: one for each window. `read` answers `undefined` when nothing was saved, and rejects when the place cannot be read (what it holds is then not known).
 * `write` replaces the session. `keep` puts text aside under a name that no later `write` replaces: what a session that cannot be used becomes, so it is never deleted.
 */
export type SessionStorage = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (text: string) => Promise<void>;
  readonly keep: (name: string, text: string) => Promise<void>;
};
