import { useQuery } from '@tanstack/react-query';
import { GetConnectionNamespaces } from '../../wailsjs/go/resource/Client';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseConnectionOptions = {
  /**
   * The name of the plugin we're interacting with
   */
  pluginID?: string;

  /**
   * The ID of the connection
   */
  connectionID: string;
};

/**
 * Get and retreive connections from a plugin's connection manager..
 */
export const useConnectionNamespaces = ({ pluginID: explicitPluginID, connectionID }: UseConnectionOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryKey = [pluginID, 'connection', 'namespaces', connectionID];

  // === Queries === //

  const namespaces = useQuery({
    queryKey,
    queryFn: async () => GetConnectionNamespaces(pluginID, connectionID),
  });

  return {
    /**
     * Get the connection
     */
    namespaces,
  };
};
