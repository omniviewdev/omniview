import { createSettingsSession, type SettingsSession } from './model/session';
import type { SettingsClient } from './model/types';
import { runtimeClient } from './runtime';

// The Settings sheet's lazy chunk: everything the sheet is, behind one dynamic import (`host.ts`, `load`). A window that never opens Settings never fetches it. The chunk holds the sheet's component, the adapter, the session, the
// form model it runs and the parts it draws (the bundle report says how many bytes, and the always-loaded part of Settings is the control, the chord and the context).

export { Surface } from './view/Surface';

/** The session of one opening: over the client the host passed (a fixture's, in a probe) or the runtime's. */
export function createSession(client: SettingsClient | undefined): SettingsSession {
  return createSettingsSession({ client: client ?? runtimeClient() });
}
