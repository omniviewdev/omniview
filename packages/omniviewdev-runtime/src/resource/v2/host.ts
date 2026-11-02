import type { AccessRoute, Count, EnumerateRequest, GetRequest, NativeQueryRequest, QueryScope, ReadTarget, Record as ResourceRecord, ResourceReference, ScopeEntry, SourcePage } from './domain';
import type { SourceContinuity, SourceCoverage, SourceMode, SourceSessionState } from '../../types/source';
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
  view?: { continuity: SourceContinuity; coverage?: SourceCoverage; count: Count; viewGeneration: string };
}
export interface HostSourceViewRequest { targetId: string; target: ReadTarget; updates: 'none' | 'ifSupported' }
export interface HostSourceViewOpened { viewId: string; topic: string; mode: SourceMode }
export interface HostSourceStatus {
  state: SourceSessionState;
  mode: SourceMode;
  continuity?: SourceContinuity;
  coverage?: SourceCoverage;
  count: Count;
  error?: { code: string; title: string; message: string; suggestions?: string[] };
}
export interface HostRecordRemoval { key: string; addressKey: string }
export interface HostSourceViewReset { reason: 'overflow' | 'sourceReset' | 'resync' | 'closed'; message: string }
export interface HostSourceViewEvent {
  viewId: string;
  viewGeneration: string;
  sequence: string;
  kind: 'snapshot' | 'snapshotEnd' | 'changes' | 'status' | 'reset';
  records?: HostRecord[];
  upserts?: HostRecord[];
  removes?: HostRecordRemoval[];
  status?: HostSourceStatus;
  reset?: HostSourceViewReset;
}
export interface HostSourceStates { route: AccessRoute; types: Record<string, HostSourceStatus> }
export interface HostSourceStateEvent { pluginID: string; route: AccessRoute; type: string; status: HostSourceStatus }
/** Native client readiness, not network health. UNKNOWN is not disconnected. */
export type NativeConnectionReadiness = 'UNKNOWN' | 'DISCONNECTED' | 'PENDING' | 'CONNECTED' | 'FAILED';
export interface HostConnectionState {
  connection: Connection;
  readiness: NativeConnectionReadiness;
  readinessError?: AppError;
  resources: { [type: string]: SourceSessionState };
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
/** Write-only credentials. Omission preserves only unchanged profile identity/configuration; empty string clears. */
export interface ConnectionProfileCredentials {
  username?: string;
  token?: string;
}
export interface HostGetRequest { targetId: string; request: GetRequest }
export interface HostEnumerateRequest { targetId: string; request: EnumerateRequest }
export interface HostNativeQueryRequest { targetId: string; request: NativeQueryRequest }
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
