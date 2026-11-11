import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useGraphObservation } from './useGraphObservation';

type UseDependencyTreeOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

  reference: ResourceReference;
  route: AccessRoute;

  /** How many edges deep to follow. The host caps this at 5. */
  maxDepth?: number;

  /** Whether to hold mounted graph demand. */
  enabled?: boolean;
};

/**
 * useDependencyTree returns the tree of resources reachable from one resource
 * by following outgoing relationship edges (for example Deployment →
 * ReplicaSet → Pods → Node, ConfigMaps, PVCs). A resource reachable by more
 * than one path appears once.
 */
export const useDependencyTree = ({
  pluginID: explicitPluginID,
  reference,
  route,
  maxDepth = 3,
  enabled = true,
}: UseDependencyTreeOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const observation = useGraphObservation({
    pluginID, reference, route, kind: 'tree', maxDepth,
  }, enabled);

  return {
    tree: observation.snapshot?.tree ?? null,
    isLoading: observation.isLoading,
    isFetching: observation.isFetching,
    error: observation.error,
    refetch: observation.refetch,
  };
};

export default useDependencyTree;
