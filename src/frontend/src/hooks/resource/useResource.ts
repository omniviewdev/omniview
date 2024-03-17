import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "@/providers/SnackbarProvider";


// types
import { types } from "@api/models";

// underlying client
import { Get, Update, Delete } from "@api/resource/Client";

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
  getParams?: object;

  /**
   * Optional parameters to pass to the resource update
   * @example { dryRun: true }
   */
  updateParams?: object;

  /**
  * Optional parameters to pass to the resource delete
  * @example { cascade: true }
  * @example { force: true }
  */
  deleteParams?: object;
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
    mutationFn: (opts: Partial<types.UpdateInput>) => Update(pluginID, connectionID, resourceKey, types.UpdateInput.createFrom({
      params: Object.assign({}, updateParams, opts.params),
      input: Object.assign({}, updateParams, opts.input),
      id: resourceID,
      namespace,
    })),
    onSuccess: () => {
      showSnackbar(`Resource ${resourceID} updated`, 'success');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      showSnackbar(`Failed to update resource ${resourceID}: ${error}`, 'error');
    },
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: (opts: Partial<types.DeleteInput>) => Delete(pluginID, connectionID, resourceKey, types.DeleteInput.createFrom({
      params: Object.assign({}, deleteParams, opts.params),
      input: Object.assign({}, deleteParams, opts.input),
      id: resourceID,
      ...opts,
      namespace
    })),
    onSuccess: () => {
      showSnackbar(`Resource ${resourceID} deleted`, 'success');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      showSnackbar(`Failed to delete resource ${resourceID}: ${error}`, 'error');
    },
  });

  const resourceQuery = useQuery({
    queryKey,
    queryFn: () => Get(pluginID, connectionID, resourceKey, types.GetInput.createFrom({
      params: getParams,
      id: resourceID,
      namespace,
    }))
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
  }
}
