import { useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceTypes } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceTypesOptions = {
  /**
   * The ID of the plugin
   */
  pluginID?: string;
  /**
  * The ID of the connection
  */
  connectionID: string;
};

/**
 * Fetch the resource types for a given plugin and connection.
 */
export const useResourceTypes = ({ pluginID: explicitPluginID, connectionID }: UseResourceTypesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryKey = [pluginID, 'resources', 'list', connectionID];

  const types = useQuery({
    queryKey,
    queryFn: async () => GetResourceTypes(pluginID, connectionID),
    retry: false,
  });

  return {
    /**
     * The resource types for the given plugin and connection.
     */
    types,
  };
};
