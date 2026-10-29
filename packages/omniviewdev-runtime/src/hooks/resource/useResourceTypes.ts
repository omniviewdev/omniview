import { skipToken, useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceTypes } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

type UseResourceTypesOptions = {
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
 * Fetch the resource types for a given plugin and connection.
 */
export const useResourceTypes = ({ pluginID: explicitPluginID, connectionID, enabled = true }: UseResourceTypesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryKey = [pluginID, 'resources', 'list', connectionID];

  const types = useQuery({
    queryKey,
    queryFn: enabled && readiness.phase === 'connected' ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetResourceTypes(pluginID, connectionID)) : skipToken,
    enabled: enabled && readiness.phase === 'connected',
    retry: false,
  });

  return {
    /**
     * The resource types for the given plugin and connection.
     */
    types,
  };
};
