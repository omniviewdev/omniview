import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useGraphObservation } from './useGraphObservation';

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

  /** Whether to hold mounted graph demand. */
  enabled?: boolean;
};

/**
 * useResourceGraph returns the neighbourhood of one resource as a graph:
 * every node reached within upDepth/downDepth hops, with its signed distance
 * from the root (negative upstream, positive downstream), and every edge
 * between them. Unlike useDependencyTree, a resource reached by several
 * paths keeps all of its edges. The host publishes complete snapshots while
 * this request remains mounted.
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

  const observation = useGraphObservation({
    pluginID, reference, route, kind: 'subgraph', upDepth, downDepth,
  }, enabled);

  return {
    graph: observation.snapshot?.subgraph ?? null,
    isLoading: observation.isLoading,
    isFetching: observation.isFetching,
    error: observation.error,
    refetch: observation.refetch,
  };
};

export default useResourceGraph;
