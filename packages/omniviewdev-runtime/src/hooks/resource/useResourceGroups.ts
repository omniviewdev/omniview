import { useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceGroups } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceGroupsOptions = {
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
 * Fetch the resource groups for a given plugin and connection.
 */
export const useResourceGroups = ({ pluginID: explicitPluginID, connectionID }: UseResourceGroupsOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryKey = [pluginID, 'resource_groups', 'list'];

  const groups = useQuery({
    queryKey,
    queryFn: async () => GetResourceGroups(pluginID, connectionID),
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
