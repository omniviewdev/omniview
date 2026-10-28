import type { AccessRoute, ResourceReference } from './domain';

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
