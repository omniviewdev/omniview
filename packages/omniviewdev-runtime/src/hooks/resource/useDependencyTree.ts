import { skipToken, useQuery } from '@tanstack/react-query';
import { GetDependencyTree } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graphservice';
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

  /** The connection ID the resource belongs to */
  connectionID: string;

  /**
   * The resource key of the root resource
   * @example "apps::v1::Deployment"
   */
  resourceKey: string;

  /** The ID of the root resource */
  resourceID: string;

  /** Namespace of the root resource, if the backend has namespaces */
  namespace?: string;

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
  connectionID,
  resourceKey,
  resourceID,
  namespace = '',
  maxDepth = 3,
  enabled = true,
  refetchInterval = false,
}: UseDependencyTreeOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);

  const queryKey = ['RESOURCE_DEPENDENCY_TREE', pluginID, connectionID, resourceKey, namespace, resourceID, maxDepth];
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: enabled && !!resourceKey && !!resourceID });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryEnabled = enabled && !!pluginID && !!connectionID && !!resourceKey && !!resourceID && readiness.phase === 'connected';

  useRefetchOnGraphChange(pluginID, connectionID, queryKey, queryEnabled);

  const query = useQuery({
    queryKey,
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetDependencyTree(pluginID, connectionID, resourceKey, namespace, resourceID, maxDepth)) : skipToken,
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
