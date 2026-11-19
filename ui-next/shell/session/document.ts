import { serialise as serialisePanel, type PanelState } from '../core/panel';
import { migrate, serialise as serialiseTabs, type Migration, type TabsState } from '../core/tabs';
import { SESSION_VERSION, type PersistedSession } from './types';

// The session as a document: what is written, and how a text is read back into one. The version comes first, `migrate` brings an older one up to the current one step at a time (the tab model's
// own `migrate`, which reads the version and applies a step for each version), and a text that cannot be brought up is never half used. What each part holds is for its own model to read: this
// document only says whether it is a session at all.

export { SESSION_VERSION };

/** The steps from every older version of the wrapper, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export type SessionParts = {
  readonly tabs: TabsState;
  readonly panel: PanelState;
  readonly rail: string | null;
};

/** What the window saves: the two models' own snapshots and the rail's choice. Nothing that means "now" (the models leave out page state, flags and the output of a session). */
export function serialiseSession({ tabs, panel, rail }: SessionParts): PersistedSession {
  return { version: SESSION_VERSION, tabs: serialiseTabs(tabs), rail, panel: serialisePanel(panel) };
}

export type ReadOptions = {
  /** The version this build reads. Default: `SESSION_VERSION`. A test says another, to have something to migrate from. */
  readonly current?: number | undefined;
  readonly steps?: Readonly<Record<number, Migration>> | undefined;
};

export type ReadResult =
  /** Nothing was saved. */
  | { readonly kind: 'none' }
  /** A document of the current version. Its parts are as they were saved, for the models to read; one that was never written is `undefined`. */
  | { readonly kind: 'saved'; readonly tabs: unknown; readonly panel: unknown; readonly rail: string | undefined }
  /** A text that is not a session this build can use: not JSON, not a document, no whole-number version, a version it cannot reach, a part that is not a document. */
  | { readonly kind: 'unusable'; readonly reason: 'unreadable' | 'foreign-version'; readonly detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reads the text a place held. A value that is nothing (`undefined`, the JSON `null`) is `none`; every other way of not being a session is `unusable`, with why. */
export function readSession(text: string | undefined, options: ReadOptions = {}): ReadResult {
  if (text === undefined) {
    return { kind: 'none' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { kind: 'unusable', reason: 'unreadable', detail: `the saved text is not JSON (${messageOf(error)})` };
  }

  const migrated = migrate(parsed, { current: options.current ?? SESSION_VERSION, steps: options.steps ?? MIGRATIONS });
  if (!migrated.ok) {
    return migrated.reason === 'missing' ? { kind: 'none' } : { kind: 'unusable', reason: migrated.reason, detail: migrated.detail };
  }

  const { tabs, panel, rail } = migrated.value;
  for (const [name, part] of [['tabs', tabs], ['panel', panel]] as const) {
    if (part !== undefined && !isRecord(part)) {
      return { kind: 'unusable', reason: 'unreadable', detail: `the ${name} of the saved session is not an object` };
    }
  }

  return { kind: 'saved', tabs, panel, rail: typeof rail === 'string' && rail !== '' ? rail : undefined };
}
