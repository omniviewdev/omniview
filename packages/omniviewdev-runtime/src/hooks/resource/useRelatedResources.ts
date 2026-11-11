import { sameGraphNode, type GraphEdge, type GraphNode } from '../../resource/v2/graph';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useGraphObservation } from './useGraphObservation';

/** Which side of the relationship the viewed resource is on. */
export type RelationshipDirection = 'outgoing' | 'incoming';

/** A resource linked to the viewed resource by one relationship edge. */
export type RelatedResource = {
  /** The resource at the other end of the edge. */
  resource: GraphNode;
  /** Relationship type, e.g. "owns", "runs_on", "uses", "selects". */
  type: string;
  /**
   * "outgoing" when the viewed resource is the edge source (a Pod that runs
   * on a Node), "incoming" when it is the target (the Node).
   */
  direction: RelationshipDirection;
  /**
   * The label the plugin declared. It is written from the declaring
   * resource's point of view, so it can read backwards here (an owner edge
   * declared by a Pod is labelled "owned by"). Use relationshipLabel() for
   * display.
   */
  label: string;
};

type UseRelatedResourcesOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

  reference: ResourceReference;
  route: AccessRoute;

  /** Which edges to return. Defaults to both directions. */
  direction?: RelationshipDirection | 'both';

  /** Only return edges of this relationship type */
  relationshipType?: string;

  /** Whether to hold mounted graph demand. */
  enabled?: boolean;
};

const relationshipLabels: Record<string, Record<RelationshipDirection, string>> = {
  owns: { outgoing: 'Owns', incoming: 'Owned by' },
  runs_on: { outgoing: 'Runs on', incoming: 'Running here' },
  uses: { outgoing: 'Uses', incoming: 'Used by' },
  exposes: { outgoing: 'Exposes', incoming: 'Exposed by' },
  manages: { outgoing: 'Manages', incoming: 'Managed by' },
  member_of: { outgoing: 'Member of', incoming: 'Members' },
  selects: { outgoing: 'Selects', incoming: 'Selected by' },
};

/**
 * relationshipLabel returns a display label for a relationship type, read
 * from the viewed resource's side: ("owns", "incoming") is "Owned by".
 * Unknown types fall back to the type name.
 */
export function relationshipLabel(type: string, direction: RelationshipDirection): string {
  const known = relationshipLabels[type];

  if (known) {
    return known[direction];
  }

  const words = type.replace(/_/g, ' ');

  return direction === 'outgoing' ? words : `${words} (incoming)`;
}


/**
 * toRelatedResources converts graph edges around `self` into one entry per
 * edge, keyed by the resource at the other end.
 */
export function toRelatedResources(self: Omit<GraphNode, 'key'>, edges: GraphEdge[]): RelatedResource[] {
  return edges.map((edge) => {
    const outgoing = sameGraphNode(edge.source, self);
    return {
      resource: outgoing ? edge.target : edge.source,
      type: edge.type,
      direction: outgoing ? 'outgoing' : 'incoming',
      label: edge.label,
    };
  });
}

/**
 * useRelatedResources returns the resources linked to one resource in the
 * relationship graph the host builds from the plugin's relationship
 * declarations (owner references, node assignment, volumes, selectors, ...).
 *
 * The host holds only populations needed by this mounted request. Targets
 * referenced by name may be returned without claiming they exist.
 */
export const useRelatedResources = ({
  pluginID: explicitPluginID,
  reference,
  route,
  direction = 'both',
  relationshipType,
  enabled = true,
}: UseRelatedResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const observation = useGraphObservation({
    pluginID, reference, route, kind: 'related', direction, relationshipType,
  }, enabled);

  const self: Omit<GraphNode, 'key'> = {
    pluginId: pluginID,
    reference,
    route,
  };
  const edges = observation.snapshot?.edges ?? [];

  return {
    /** One entry per edge, from the viewed resource's side. */
    related: toRelatedResources(self, edges),
    /** The raw graph edges. */
    edges,
    isLoading: observation.isLoading,
    isFetching: observation.isFetching,
    error: observation.error,
    refetch: observation.refetch,
  };
};

export default useRelatedResources;
