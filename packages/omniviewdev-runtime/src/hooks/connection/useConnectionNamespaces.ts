import { skipToken, useQuery } from '@tanstack/react-query';
import { GetConnectionNamespaces } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from './useConnectionReadiness';
import { useConnectionQueryGuard } from '../resource/useConnectionQueryGuard';

type UseConnectionOptions = {
  /**
   * The name of the plugin we're interacting with
   */
  pluginID?: string;

  /**
   * The ID of the connection
   */
  connectionID: string;
  enabled?: boolean;
};

/**
 * Get and retreive connections from a plugin's connection manager..
 */
export const useConnectionNamespaces = ({ pluginID: explicitPluginID, connectionID, enabled = true }: UseConnectionOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryKey = [pluginID, 'connection', 'namespaces', connectionID];

  // === Queries === //

  const namespaces = useQuery({
    queryKey,
    queryFn: enabled && readiness.phase === 'connected' ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetConnectionNamespaces(pluginID, connectionID)) : skipToken,
    enabled: enabled && readiness.phase === 'connected',
  });

  return {
    /**
     * Get the connection
     */
    namespaces,
  };
};
