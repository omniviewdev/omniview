import { skipToken, useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceGroups } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

type UseResourceGroupsOptions = {
  /**
   * The ID of the plugin
   */
  pluginID?: string;
  /**
   * The ID of the connection
   */
  connectionID: string;
  enabled?: boolean;
};

/**
 * Fetch the resource groups for a given plugin and connection.
 */
export const useResourceGroups = ({ pluginID: explicitPluginID, connectionID, enabled = true }: UseResourceGroupsOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryKey = [pluginID, 'resource_groups', 'list', connectionID];

  const groups = useQuery({
    queryKey,
    queryFn: enabled && readiness.phase === 'connected' ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetResourceGroups(pluginID, connectionID)) : skipToken,
    enabled: enabled && readiness.phase === 'connected',
    retry: false,
  });

  return {
    /**
     * The resource groups for the given plugin and connection.
     */
    groups,
  };
};

export default useResourceGroups;
