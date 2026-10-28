import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { AccessRoute, ResourceReference } from './domain';
import type { DependencyTree, GraphEdge, Subgraph } from './graph';

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.GraphService';

export function GetRelated(pluginID: string, reference: ResourceReference, route: AccessRoute, direction: string, relationshipType: string | null): CancellablePromise<GraphEdge[]> {
  return Call.ByName(`${service}.GetRelated`, pluginID, reference, route, direction, relationshipType);
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
