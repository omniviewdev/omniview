/**
 * InformerSyncPolicy controls when an informer starts for a resource type.
 */
export enum InformerSyncPolicy {
  /** Start when connection opens (default) */
  OnConnect = 0,
  /** Start on first Get/List/Find for this resource */
  OnFirstQuery = 1,
  /** Never start an informer (always use direct queries) */
  Never = 2,
}

/**
 * InformerResourceState represents the sync state of a single resource type's informer.
 */
export enum InformerResourceState {
  Pending = 0,
  Syncing = 1,
  Synced = 2,
  Error = 3,
  Cancelled = 4,
}

/**
 * InformerStateEvent is emitted when a resource's informer state changes.
 */
export interface InformerStateEvent {
  pluginId: string;
  connection: string;
  resourceKey: string;
  state: InformerResourceState;
  resourceCount: number;
  totalCount: number; // -1 if unknown
  error?: {
    code: string;
    title: string;
    message: string;
    suggestions?: string[];
  };
}

/**
 * InformerConnectionSummary provides an aggregate view of all informer states for a connection.
 */
export interface InformerConnectionSummary {
  connection: string;
  resources: Record<string, InformerResourceState>;
  resourceCounts: Record<string, number>;
  totalResources: number;
  syncedCount: number;
  errorCount: number;
}
