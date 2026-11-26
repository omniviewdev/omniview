import type { ConnectionActions } from './actions';
import type { RecentsStore } from './recents';
import type { ConnectionsStore } from './store';

export { createConnectionActions } from './actions';
export type { ActionResult, ConnectionActions } from './actions';
export { productionApi } from './api';
export type { ConnectionsApi } from './api';
export { ConnectionQuestion } from './ConnectionQuestion';
export { pickerOf } from './picker';
export { reachOf } from './reach';
export { createRecents, RECENTS_MAX, usesOf } from './recents';
export type { RecentConnection, RecentsStore } from './recents';
export { createConnectionsStore } from './store';
export type { ConnectionsState, ConnectionsStore } from './store';
export type { ConnectOutcome, ConnectionBusy, ConnectionState, HostConnection, StateFace } from './types';
export { createConnectionVerbs } from './verbs';
export type { ConnectionVerbs } from './verbs';
export { faceOf } from './words';

/** What the window has to know and do about the connections of its plugins: the store (what they are and where they stand), the recents (which of them were used last) and the actions (what choosing one does). Absent from a window with no connection API (a test of another part). */
export type HostConnections = {
  readonly store: ConnectionsStore;
  readonly recents: RecentsStore;
  readonly actions: ConnectionActions;
};
