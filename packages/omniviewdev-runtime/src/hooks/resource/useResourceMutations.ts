import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { types } from '../../wailsjs/go/models';
import { Create, Update, Delete } from '../../wailsjs/go/resource/Client';

type ResourceMutationOptions = {
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
   * Optional parameters to pass to the call
   * @example { labelSelector: "app=nginx" }
   */
  params?: Record<string, unknown>;
}

type UseResourceMutationsOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID: string;

};

/**
 * The useResource hook returns a hook, scoped to the desired resource and connection, that allows for interacting
 * with, and fetching, the resource data.
 *
 * It should be noted that this hook does not perform any logic to ensure that either the resource exists,
 * @throws If the resourceID is invalid
 */
export const useResourceMutations = ({ pluginID }: UseResourceMutationsOptions) => {
  const { showSnackbar } = useSnackbar();

  const createMutation = useMutation({
    mutationFn: async ({ opts, input }: { opts: ResourceMutationOptions; input: Partial<types.CreateInput> }) =>
      Create(
        pluginID,
        opts.connectionID,
        opts.resourceKey,
        types.CreateInput.createFrom({
          params: { ...opts.params, ...input.params },
          input: { ...opts.params, ...input.input },
          id: opts.resourceID,
          namespace: opts.namespace,
        })
      ),
    onSuccess: (_, { opts }) => {
      showSnackbar(`Resource ${opts.resourceID} created`, 'success');
    },
    onError(error: Error, { opts }) {
      showSnackbar(`Failed to create resource ${opts.resourceID}: ${error.message}`, 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ opts, input }: { opts: ResourceMutationOptions; input: Partial<types.UpdateInput> }) =>
      Update(
        pluginID,
        opts.connectionID,
        opts.resourceKey,
        types.UpdateInput.createFrom({
          params: { ...opts.params, ...input.params },
          input: { ...opts.params, ...input.input },
          id: opts.resourceID,
          namespace: opts.namespace,
        })
      ),
    onSuccess: (_, { opts }) => {
      showSnackbar(`Resource ${opts.resourceID} updated`, 'success');
    },
    onError(error, { opts }) {
      showSnackbar(`Failed to update resource ${opts.resourceID}: ${error.message}`, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ opts, input }: { opts: ResourceMutationOptions; input: Partial<types.DeleteInput> }) =>
      Delete(
        pluginID,
        opts.connectionID,
        opts.resourceKey,
        types.DeleteInput.createFrom({
          ...input,
          params: { ...opts.params, ...input.params },
          input: { ...opts.params, ...input.input },
          id: opts.resourceID,
          namespace: opts.namespace,
        })
      ),
    onSuccess: (_, { opts }) => {
      showSnackbar(`Resource ${opts.resourceID} deleted`, 'success');
    },
    onError(error, { opts }) {
      showSnackbar(`Failed to delete resource ${opts.resourceID}: ${error.message}`, 'error');
    },
  });

  return {
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
  };
};

export default useResourceMutations;
