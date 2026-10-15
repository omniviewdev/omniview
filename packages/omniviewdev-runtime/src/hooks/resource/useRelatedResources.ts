import { useQuery } from '@tanstack/react-query';
import { GetRelated } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graphservice';
import type { GraphEdge, GraphNode } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph/models';
import { useResolvedPluginId } from '../useResolvedPluginId';

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

  /** The connection ID the resource belongs to */
  connectionID: string;

  /**
   * The resource key of the viewed resource
   * @example "core::v1::Pod"
   */
  resourceKey: string;

  /** The ID of the viewed resource */
  resourceID: string;

  /** Namespace of the viewed resource, if the backend has namespaces */
  namespace?: string;

  /** Which edges to return. Defaults to both directions. */
  direction?: RelationshipDirection | 'both';

  /** Only return edges of this relationship type */
  relationshipType?: string;

  /** Whether to enable the query */
  enabled?: boolean;

  /**
   * How often to refetch, in milliseconds. The graph is rebuilt in the
   * background from watch events and does not notify the frontend, so it is
   * polled. Pass false to disable.
   */
  refetchInterval?: number | false;
};

const DEFAULT_REFETCH_INTERVAL = 10_000;

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

function sameNode(a: GraphNode, b: GraphNode): boolean {
  return a.pluginId === b.pluginId
    && a.connectionId === b.connectionId
    && a.resourceKey === b.resourceKey
    && a.id === b.id
    && (a.namespace ?? '') === (b.namespace ?? '');
}

/**
 * toRelatedResources converts graph edges around `self` into one entry per
 * edge, keyed by the resource at the other end.
 */
export function toRelatedResources(self: GraphNode, edges: GraphEdge[]): RelatedResource[] {
  return edges.map((edge) => {
    const outgoing = sameNode(edge.source, self);
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
  connectionID,
  resourceKey,
  resourceID,
  namespace = '',
  direction = 'both',
  relationshipType,
  enabled = true,
  refetchInterval = DEFAULT_REFETCH_INTERVAL,
}: UseRelatedResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const query = useQuery({
    queryKey: ['RESOURCE_RELATED', pluginID, connectionID, resourceKey, namespace, resourceID, direction, relationshipType ?? null],
    queryFn: async () => GetRelated(pluginID, connectionID, resourceKey, namespace, resourceID, direction, relationshipType ?? null),
    enabled: enabled && !!pluginID && !!connectionID && !!resourceKey && !!resourceID,
    refetchInterval,
  });

  const self: GraphNode = {
    pluginId: pluginID,
    connectionId: connectionID,
    resourceKey,
    id: resourceID,
    namespace,
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
