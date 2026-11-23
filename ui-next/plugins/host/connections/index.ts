import type { ConnectionActions } from './actions';
import type { ConnectionsStore } from './store';

export { createConnectionActions } from './actions';
export type { ActionResult, ConnectionActions } from './actions';
export { productionApi } from './api';
export type { ConnectionsApi } from './api';
export { pickerOf } from './picker';
export { createConnectionsStore } from './store';
export type { ConnectionsState, ConnectionsStore } from './store';
export type { ConnectOutcome, ConnectionState, HostConnection, StateFace } from './types';
export { faceOf } from './words';

/** What the window has to know and do about the connections of its plugins: the store (what they are and where they stand) and the actions (what choosing one does). Absent from a window with no connection API (a test of another part). */
export type HostConnections = {
  readonly store: ConnectionsStore;
  readonly actions: ConnectionActions;
};
