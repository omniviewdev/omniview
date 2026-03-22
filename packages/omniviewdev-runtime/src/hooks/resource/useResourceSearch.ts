import { useQueries } from '@tanstack/react-query';

// Types
import { ListInput } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import { List } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceSearchOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID?: string;

  /**
   * The connection ID to scope the resource to
   * @example "integration"
   */
  connectionID: string;

  /**
   * Entry for the resource search
   */
  searches: ResourceSearchEntry[];
};

type ResourceSearchEntry = {
  /**
  * The key of the resource
  */
  key: string;

  /**
   * The namespaces to search for the resource
   */
  namespaces: string[];

  /**
   * Post-retrieve function filter to apply after the resources are found
   */
  postFilter?: (resource: unknown) => boolean;
};

/**
 * The useResourceSearch is a utility hook to search across multiple resources and/or namespaces. This hook is currently
 * limited searching within a single plugin, and a single connection.
 */
export const useResourceSearch = ({
  pluginID: explicitPluginID,
  connectionID,
  searches,
}: UseResourceSearchOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  /**
   * Use the list query key for now since we're kinda only using that for the time being
   */
  const getQueryKey = (search: ResourceSearchEntry) => [pluginID, connectionID, search.key, search.namespaces, 'list'];

  /**
   * The search function that will be called by the hook consumer
   */
  const results = useQueries({
    queries: searches.map(search => ({
      queryKey: getQueryKey(search),
      queryFn: async () => List(pluginID, connectionID, search.key, ListInput.createFrom({
        order: [{ field: 'name', descending: false }],
        pagination: { page: 1, pageSize: 200 },
        namespaces: search.namespaces,
      })).then((data) => {
        if (!data) return [];
        console.log(data.result);
        if (data.result && search.postFilter) {
          return Object.values(data.result).filter(search.postFilter);
        }

        return Object.values(data.result || {});
      }),
      retry: false,
    })),
  });

  return results;
};

export default useResourceSearch;
