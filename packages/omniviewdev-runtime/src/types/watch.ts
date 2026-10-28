// Handwritten projection of plugin-sdk/pkg/resource/v2/updates.go.
import type { AccessRoute, Count, QueryScope, Record as ResourceRecord, ResourceReference } from '../resource/v2/domain';
import type { ResourceOperationError } from '../resource/v2/ancillary';

export enum WatchState {
  WatchStateIdle = 0,
  WatchStateSyncing = 1,
  WatchStateSynced = 2,
  WatchStateError = 3,
  WatchStateStopped = 4,
  WatchStateFailed = 5,
  WatchStateForbidden = 6,
  WatchStateSkipped = 7,
}
export enum SyncPolicy { SyncOnConnect = 0, SyncOnFirstQuery = 1, SyncNever = 2 }
export interface WatchStateEvent {
  route: AccessRoute;
  type: string;
  state: WatchState;
  count: Count;
  error?: ResourceOperationError;
  message?: string;
  guarantee: 'bestEffort';
}
export interface WatchConnectionSummary {
  route: AccessRoute;
  resources: Record<string, WatchState>;
  resourceCounts: Record<string, Count>;
  scope: QueryScope;
  guarantee: 'bestEffort';
}
export interface ResourceMetadata { labels?: Record<string, string>; createdAt?: string }
export interface WatchAddPayload { route: AccessRoute; record: ResourceRecord; metadata: ResourceMetadata; guarantee: 'bestEffort' }
export interface WatchUpdatePayload { route: AccessRoute; record: ResourceRecord; metadata: ResourceMetadata; guarantee: 'bestEffort' }
export interface WatchDeletePayload { route: AccessRoute; reference: ResourceReference; lastKnown?: ResourceRecord; guarantee: 'bestEffort' }
