import { useQuery } from '@tanstack/react-query';

// Underlying client
import { GetResourceType } from '../../wailsjs/go/resource/Client';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceTypesOptions = {
  /**
   * The ID of the category responsible for this resource
   * @example "appearance"
   */
  pluginID?: string;

  /**
  * The key of the resource to fetch
  */
  resourceKey: string;
};

/**
 * Interact with a category of settings from the global settings provider. Intended for use in the settings UI - if
 * you need to read or write settings from a specific plugin, use the `@hooks/settings/useSettings` hook instead.
 */
export const useResourceType = ({ pluginID: explicitPluginID, resourceKey }: UseResourceTypesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryKey = [pluginID, 'resources', resourceKey];

  const resourceType = useQuery({
    queryKey,
    queryFn: async () => GetResourceType(pluginID, resourceKey),
    retry: false,
  });

  return {
    /**
     * The current settings from the provider.
     */
    resourceType,
  };
};

export default useResourceType;
