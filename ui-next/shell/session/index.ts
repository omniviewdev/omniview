// The session: a window's tabs, rail choice and panel, saved one burst at a time and restored before the window draws. README.md in this directory is the guide; types.ts is the contract.
export { loadSession, openSession, QUARANTINE_PREFIX, READ_DEADLINE_MS } from './session';
export type { AttachOptions, LoadedSession, RestoreOptions, Restored, SessionOptions } from './session';
export { MIGRATIONS, readSession, serialiseSession } from './document';
export type { ReadOptions, ReadResult, SessionParts } from './document';
export { createRailChoice } from './rail';
export type { RailChoice, RailSource } from './rail';
export { browserLifecycle } from './lifecycle';
export type { Lifecycle } from './lifecycle';
export { resolveWindowName, SESSION_SLOT, windowStorage } from './window';
export type { WindowNameOptions, WindowState, WindowStorageOptions } from './window';
export { SESSION_VERSION } from './types';
export type { PersistedSession, SessionStorage } from './types';
