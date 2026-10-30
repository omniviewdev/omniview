import { skipToken, useQuery } from '@tanstack/react-query';
import { GetDependencyTree } from '../../resource/v2/graph-client';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useRefetchOnGraphChange } from './useRefetchOnGraphChange';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

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

  /** Whether to enable the query */
  enabled?: boolean;

  /**
   * Also refetch on this interval, in milliseconds. Not needed normally: the
   * query refetches when the host reports a graph change for the connection.
   */
  refetchInterval?: number | false;
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
  refetchInterval = false,
}: UseDependencyTreeOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const queryKey = ['RESOURCE_DEPENDENCY_TREE', pluginID, reference, route, maxDepth];
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: enabled && !!reference.address.id });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const queryEnabled = enabled && !!pluginID && !!route.connection && !!reference.address.id && readiness.phase === 'connected';

  useRefetchOnGraphChange(pluginID, route.connection, queryKey, queryEnabled);

  const query = useQuery({
    queryKey,
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetDependencyTree(pluginID, reference, route, maxDepth)) : skipToken,
    enabled: queryEnabled,
    refetchInterval,
  });

  return {
    tree: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
};

export default useDependencyTree;
