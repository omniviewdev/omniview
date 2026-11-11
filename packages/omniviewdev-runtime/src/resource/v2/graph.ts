import type { AccessRoute, ResourceReference } from './domain';
import type { ResourceOperationError } from './ancillary';

/** Host graph identity keeps the access route separate from resource identity. */
export interface GraphNode {
  /** Opaque canonical key issued by the host; never construct this in the UI. */
  key: string;
  pluginId: string;
  reference: ResourceReference;
  route: AccessRoute;
}
export interface GraphEdge { source: GraphNode; target: GraphNode; type: string; label: string }
export interface DependencyNode { edge: GraphEdge; children: DependencyNode[] }
export interface DependencyTree { root: GraphNode; children: DependencyNode[] }
export interface SubgraphNode { node: GraphNode; depth: number }
export interface Subgraph { root: GraphNode; nodes: SubgraphNode[]; edges: GraphEdge[]; truncated: boolean }

export interface RelatedRequest {
  pluginID: string;
  reference: ResourceReference;
  route: AccessRoute;
  direction: 'outgoing' | 'incoming' | 'both';
  relationshipType?: string | null;
  /** Omitted or zero requests the whole result; 1–10,000 explicitly bounds it. */
  limit?: number;
}
export interface RelatedResult {
  edges: GraphEdge[];
  /** Only an explicitly bounded request may return a successful truncated result. */
  truncated: boolean;
}

/** A client token routes one mounted request; native window ownership grants access. */
export interface HostGraphObservationRequest {
  clientToken: string;
  pluginID: string;
  reference: ResourceReference;
  route: AccessRoute;
  kind: 'related' | 'chain' | 'tree' | 'subgraph';
  direction?: 'outgoing' | 'incoming' | 'both';
  relationshipType?: string | null;
  maxDepth?: number;
  upDepth?: number;
  downDepth?: number;
}

export interface HostGraphObservationOpened {
  observationId: string;
  topic: string;
}

/** Every ready frame replaces the complete projection, including omitted empty edges. */
export interface HostGraphObservationSnapshot {
  observationId: string;
  generation: string;
  sequence: string;
  state: 'pending' | 'ready' | 'failed';
  edges?: GraphEdge[];
  chain?: GraphEdge[][];
  tree?: DependencyTree | null;
  subgraph?: Subgraph | null;
  error?: ResourceOperationError | null;
}

/** Compare structured canonical identity without manufacturing host keys. */
export function sameGraphNode(a: Omit<GraphNode, 'key'>, b: Omit<GraphNode, 'key'>): boolean {
  const left = a.reference.address;
  const right = b.reference.address;
  return a.pluginId === b.pluginId
    && a.reference.incarnation === b.reference.incarnation
    && left.provider === right.provider
    && left.authority === right.authority
    && left.type === right.type
    && left.id === right.id
    && left.scope.length === right.scope.length
    && left.scope.every(entry => right.scope.some(other =>
      entry.dimension === other.dimension && entry.value === other.value));
}
