import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { UpdateInput, DeleteInput, GetInput } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';
import { Get, Update, Delete } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseResourceOptions = {
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
   * The GVR (Group, Version, Resource) identifier to fetch
   * @example "core::v1::pods"
   */
  resourceKey: string;

  /**
   * The ID of the resource to fetch
   * @example "nginx-1452"
   */
  resourceID: string;

  /**
   * Optional namespace to scope the resource to, if the backend
   * supports the concept of namespaces of resources.
   * @example "default"
   */
  namespace?: string;

};

/**
 * The useResource hook returns a hook, scoped to the desired resource and connection, that allows for interacting
 * with, and fetching, the resource data.
 *
 * It should be noted that this hook does not perform any logic to ensure that either the resource exists,
 * @throws If the resourceID is invalid
 */
export const useResource = ({
  pluginID: explicitPluginID,
  connectionID,
  resourceKey,
  resourceID,
  namespace = '',
}: UseResourceOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['RESOURCE', pluginID, connectionID, resourceKey, resourceID, namespace];

  // === Mutations === //

  const { mutateAsync: update } = useMutation({
    mutationFn: async (opts: { input?: any }) => Update(pluginID, connectionID, resourceKey, UpdateInput.createFrom({
      input: opts.input,
      id: resourceID,
      namespace,
    })),
    onSuccess: async () => {
      showSnackbar(`Resource ${resourceID} updated`, 'success');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: createErrorHandler(showSnackbar, `Failed to update resource ${resourceID}`),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (opts: { gracePeriodSeconds?: number } = {}) => Delete(pluginID, connectionID, resourceKey, DeleteInput.createFrom({
      id: resourceID,
      namespace,
      gracePeriodSeconds: opts.gracePeriodSeconds,
    })),
    onSuccess: async () => {
      showSnackbar(`Resource ${resourceID} deleted`, 'success');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: createErrorHandler(showSnackbar, `Failed to delete resource ${resourceID}`),
  });

  const resourceQuery = useQuery({
    queryKey,
    queryFn: async () => Get(pluginID, connectionID, resourceKey, GetInput.createFrom({
      id: resourceID,
      namespace,
    })),
    retry: false,
  });

  return {
    /**
     * Fetch result for the resource. The client will automatically cache the result, and update the cache
     * when the resource is updated or deleted via the returned update and remove mutation functions.
     */
    resource: resourceQuery,

    /**
     * Update an existing resource. A set of optional parameters can be passed to customize the update behavior,
     * which if specified, will add additional default behavior set via the hook options.
     *
     * @params opts Optional parameters to pass to the resource update
     */
    update,

    /**
     * Delete an existing resource. A set of optional parameters can be passed to customize the delete behavior,
     * which if specified, will add additional default behavior set via the hook options.
     *
     * @params {object} opts Optional parameters to pass to the resource delete
     */
    remove,
  };
};

export default useResource;
