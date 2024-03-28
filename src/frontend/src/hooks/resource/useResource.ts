import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@/providers/SnackbarProvider';

// Types
import { types } from '@api/models';

// Underlying client
import { Get, Update, Delete } from '@api/resource/Client';

type UseResourceOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID: string;

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

  /**
   * Optional parameters to pass to the resource fetch
   * @example { labelSelector: "app=nginx" }
   */
  getParams?: Record<string, unknown>;

  /**
   * Optional parameters to pass to the resource update
   * @example { dryRun: true }
   */
  updateParams?: Record<string, unknown>;

  /**
  * Optional parameters to pass to the resource delete
  * @example { cascade: true }
  * @example { force: true }
  */
  deleteParams?: Record<string, unknown>;
};

/**
 * The useResource hook returns a hook, scoped to the desired resource and connection, that allows for interacting
 * with, and fetching, the resource data.
 *
 * It should be noted that this hook does not perform any logic to ensure that either the resource exists,
 * @throws If the resourceID is invalid
 */
export const useResource = ({
  pluginID,
  connectionID,
  resourceKey,
  resourceID,
  namespace = '',
  getParams = {},
  updateParams = {},
  deleteParams = {},
}: UseResourceOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = ['RESOURCE', pluginID, connectionID, resourceKey, resourceID, namespace];

  // === Mutations === //

  const { mutateAsync: update } = useMutation({
    mutationFn: async (opts: Partial<types.UpdateInput>) => Update(pluginID, connectionID, resourceKey, types.UpdateInput.createFrom({
      params: { ...updateParams, ...opts.params },
      input: { ...updateParams, ...opts.input },
      id: resourceID,
      namespace,
    })),
    onSuccess: async () => {
      showSnackbar(`Resource ${resourceID} updated`, 'success');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to update resource ${resourceID}: ${error.message}`, 'error');
    },
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (opts: Partial<types.DeleteInput>) => Delete(pluginID, connectionID, resourceKey, types.DeleteInput.createFrom({
      params: { ...deleteParams, ...opts.params },
      input: { ...deleteParams, ...opts.input },
      id: resourceID,
      ...opts,
      namespace,
    })),
    onSuccess: async () => {
      showSnackbar(`Resource ${resourceID} deleted`, 'success');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError(error) {
      showSnackbar(`Failed to delete resource ${resourceID}: ${error.message}`, 'error');
    },
  });

  const resourceQuery = useQuery({
    queryKey,
    queryFn: async () => Get(pluginID, connectionID, resourceKey, types.GetInput.createFrom({
      params: getParams,
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
