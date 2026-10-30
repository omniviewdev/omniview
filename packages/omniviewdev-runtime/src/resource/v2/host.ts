import type { AccessRoute, Count, EnumerateRequest, GetRequest, NativeQueryRequest, QueryScope, ReadTarget, Record as ResourceRecord, ResourceReference, ScopeEntry, SourcePage } from './domain';
import type { ResourceMetadata, WatchState, WatchStateEvent } from '../../types/watch';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { AppError } from '../../errors/types';

/** Keys come from the host. Neither routes nor display fields mint identity. */
export interface HostRecord {
  key: string;
  addressKey: string;
  targetId: string;
  record: ResourceRecord;
  route: AccessRoute;
}
export interface HostSourcePage { records: readonly HostRecord[]; sourcePage: Omit<SourcePage, 'records'> }
/** Client cache overlay; sourcePage remains immutable native acquisition metadata. */
export interface ResourceView extends HostSourcePage {
  view?: { guarantee: 'bestEffort'; count: Count; sourceRevision?: string; membershipStale: boolean };
}
export interface HostWatchStateEvent extends WatchStateEvent { pluginID: string }
/** Native client readiness, not network health. UNKNOWN is not disconnected. */
export type NativeConnectionReadiness = 'UNKNOWN' | 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED';
export interface HostConnectionState {
  connection: Connection;
  readiness: NativeConnectionReadiness;
  readinessError?: AppError;
  resources: { [type: string]: WatchState };
  resourceCounts: { [type: string]: Count };
  totalResources: number;
  syncedCount: number;
  errorCount: number;
  lastSyncTime?: string;
}

export interface ConnectionProfile {
  id: string;
  /** absent is returned only after removing a manual profile without native fallback. */
  source: 'native' | 'manual' | 'override' | 'disabled' | 'review' | 'absent';
  connection?: Connection;
  /** Membership in effective discovery, not whether a native client is connected. */
  active: boolean;
}
export interface ConnectionProfileResult { applied: boolean; profile: ConnectionProfile }
export interface HostGetRequest { targetId: string; request: GetRequest }
export interface HostEnumerateRequest { targetId: string; request: EnumerateRequest }
export interface HostNativeQueryRequest { targetId: string; request: NativeQueryRequest }
export interface HostSubscriptionRequest { targetId: string; target: ReadTarget }
export interface HostWatchAddPayload { route: AccessRoute; record: HostRecord; metadata: ResourceMetadata; guarantee: 'bestEffort' }
export interface HostWatchUpdatePayload { route: AccessRoute; record: HostRecord; metadata: ResourceMetadata; guarantee: 'bestEffort' }
export interface HostWatchDeletePayload { route: AccessRoute; reference: ResourceReference; key: string; addressKey: string; targetId: string; lastKnown?: HostRecord; guarantee: 'bestEffort' }
export interface AuthorityDisclosure { continuity: string; limitations: readonly string[] }
export interface ResolveTargetRequest {
  route: AccessRoute;
  type: string;
  /** Omission requests only the provider's explicit catalog default. */
  representation?: string;
  /** Missing declared dimensions become explicit any within this admitted route. */
  scope?: QueryScope;
}
export interface ResolvedResourceTarget {
  targetId: string;
  target: ReadTarget;
  authority: AuthorityDisclosure;
  catalogRevision: string;
}
export interface ResolveReferenceRequest {
  route: AccessRoute;
  type: string;
  scope: readonly ScopeEntry[];
  id: string;
  incarnation?: string;
  representation?: string;
}
export interface ResolvedResourceReference {
  reference: ResourceReference;
  route: AccessRoute;
  key: string;
  addressKey: string;
  targetId: string;
  representation: string;
  authority: AuthorityDisclosure;
}
