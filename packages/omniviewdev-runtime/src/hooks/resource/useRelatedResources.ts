import { skipToken, useQuery } from '@tanstack/react-query';
import { GetRelated } from '../../resource/v2/graph-client';
import { sameGraphNode, type GraphEdge, type GraphNode } from '../../resource/v2/graph';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { useRefetchOnGraphChange } from './useRefetchOnGraphChange';

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

  /** Whether to enable the query */
  enabled?: boolean;

  /**
   * Also refetch on this interval, in milliseconds. Not needed normally: the
   * query refetches when the host reports a graph change for the connection.
   */
  refetchInterval?: number | false;
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
 * Only resources the host is watching are indexed. Targets referenced by
 * name (a Secret a Pod mounts) are returned even if they do not exist.
 */
export const useRelatedResources = ({
  pluginID: explicitPluginID,
  reference,
  route,
  direction = 'both',
  relationshipType,
  enabled = true,
  refetchInterval = false,
}: UseRelatedResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const queryKey = ['RESOURCE_RELATED', pluginID, reference, route, direction, relationshipType ?? null];
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: enabled && !!reference.address.id });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const queryEnabled = enabled && !!pluginID && !!route.connection && !!reference.address.id && readiness.phase === 'connected';

  useRefetchOnGraphChange(pluginID, route.connection, queryKey, queryEnabled);

  const query = useQuery({
    queryKey,
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetRelated(pluginID, reference, route, direction, relationshipType ?? null)) : skipToken,
    enabled: queryEnabled,
    refetchInterval,
  });

  const self: Omit<GraphNode, 'key'> = {
    pluginId: pluginID,
    reference,
    route,
  };
  const edges = query.data ?? [];

  return {
    /** One entry per edge, from the viewed resource's side. */
    related: toRelatedResources(self, edges),
    /** The raw graph edges. */
    edges,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useRelatedResources;
