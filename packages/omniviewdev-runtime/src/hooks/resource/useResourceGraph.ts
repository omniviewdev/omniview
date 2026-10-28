import { useQuery } from '@tanstack/react-query';
import { GetSubgraph } from '../../resource/v2/graph-client';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useRefetchOnGraphChange } from './useRefetchOnGraphChange';

type UseResourceGraphOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

  reference: ResourceReference;
  route: AccessRoute;

  /**
   * How many hops to follow against edge direction: owners, selectors and
   * other resources pointing at the root. The host caps this at 5.
   */
  upDepth?: number;

  /**
   * How many hops to follow along edge direction: resources the root
   * depends on. The host caps this at 5.
   */
  downDepth?: number;

  /** Whether to enable the query */
  enabled?: boolean;
};

/**
 * useResourceGraph returns the neighbourhood of one resource as a graph:
 * every node reached within upDepth/downDepth hops, with its signed distance
 * from the root (negative upstream, positive downstream), and every edge
 * between them. Unlike useDependencyTree, a resource reached by several
 * paths keeps all of its edges. Refetches when the host reports a graph
 * change for the connection.
 */
export const useResourceGraph = ({
  pluginID: explicitPluginID,
  reference,
  route,
  upDepth = 2,
  downDepth = 3,
  enabled = true,
}: UseResourceGraphOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const queryKey = ['RESOURCE_GRAPH', pluginID, reference, route, upDepth, downDepth];
  const queryEnabled = enabled && !!pluginID && !!route.connection && !!reference.address.id;

  useRefetchOnGraphChange(pluginID, route.connection, queryKey, queryEnabled);

  const query = useQuery({
    queryKey,
    queryFn: async () => GetSubgraph(pluginID, reference, route, upDepth, downDepth),
    enabled: queryEnabled,
  });

  return {
    graph: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useResourceGraph;
