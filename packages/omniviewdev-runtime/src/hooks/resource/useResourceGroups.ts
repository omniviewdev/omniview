import { useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceGroups } from '../../wailsjs/go/resource/Client';

type UseResourceGroupsOptions = {
  /**
   * The ID of the category responsible for this resource
   * @example "appearance"
   */
  pluginID: string;
  /**
   * The ID of the connection
   */
  connectionID: string;
};

/**
 * Interact with a category of settings from the global settings provider. Intended for use in the settings UI - if
 * you need to read or write settings from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useResourceGroups = ({ pluginID, connectionID }: UseResourceGroupsOptions) => {
  const queryKey = [pluginID, 'resource_groups', 'list'];

  const groups = useQuery({
    queryKey,
    queryFn: async () => GetResourceGroups(pluginID, connectionID),
    retry: false,
  });

  return {
    /**
     * The current settings from the provider.
     */
    groups,
  };
};

export default useResourceGroups;
