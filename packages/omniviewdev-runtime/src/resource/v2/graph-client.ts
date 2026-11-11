import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { AccessRoute, ResourceReference } from './domain';
import type { DependencyTree, GraphEdge, HostGraphObservationOpened, HostGraphObservationRequest, RelatedRequest, RelatedResult, Subgraph } from './graph';

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.GraphService';

export function GetRelated(request: RelatedRequest): CancellablePromise<RelatedResult> {
  return Call.ByName(`${service}.GetRelated`, request);
}
export function GetRelationshipChain(pluginID: string, reference: ResourceReference, route: AccessRoute, relationshipType: string, maxDepth: number): CancellablePromise<GraphEdge[][]> {
  return Call.ByName(`${service}.GetRelationshipChain`, pluginID, reference, route, relationshipType, maxDepth);
}
export function GetDependencyTree(pluginID: string, reference: ResourceReference, route: AccessRoute, maxDepth: number): CancellablePromise<DependencyTree | null> {
  return Call.ByName(`${service}.GetDependencyTree`, pluginID, reference, route, maxDepth);
}
export function GetSubgraph(pluginID: string, reference: ResourceReference, route: AccessRoute, upDepth: number, downDepth: number): CancellablePromise<Subgraph | null> {
  return Call.ByName(`${service}.GetSubgraph`, pluginID, reference, route, upDepth, downDepth);
}

/** Reserve only. Install the returned topic listener before Sync activates demand. */
export function OpenGraphObservation(request: HostGraphObservationRequest): CancellablePromise<HostGraphObservationOpened> {
  return Call.ByName(`${service}.OpenGraphObservation`, request);
}
export function SyncGraphObservation(observationID: string): CancellablePromise<void> {
  return Call.ByName(`${service}.SyncGraphObservation`, observationID);
}
export function CloseGraphObservation(observationID: string): CancellablePromise<void> {
  return Call.ByName(`${service}.CloseGraphObservation`, observationID);
}
