import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { types } from '../../wailsjs/go/models';
import { GetActions, ExecuteAction } from '../../wailsjs/go/resource/Client';

type UseResourceActionsOptions = {
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
   * The resource type key
   * @example "helm::v1::Release"
   */
  resourceKey: string;

  /**
   * Whether to enable the actions query
   * @default true
   */
  enabled?: boolean;
};

/**
 * useResourceActions discovers available actions for a resource type.
 * Returns the list of ActionDescriptors that the backend reports for the given resource key.
 */
export const useResourceActions = ({
  pluginID,
  connectionID,
  resourceKey,
  enabled = true,
}: UseResourceActionsOptions) => {
  const query = useQuery({
    queryKey: ['RESOURCE_ACTIONS', pluginID, connectionID, resourceKey],
    queryFn: () => GetActions(pluginID, connectionID, resourceKey),
    enabled: enabled && !!pluginID && !!connectionID && !!resourceKey,
    staleTime: 5 * 60 * 1000, // actions don't change often
  });

  return {
    actions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
};

type UseExecuteActionOptions = {
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
   * The resource type key
   * @example "helm::v1::Release"
   */
  resourceKey: string;
};

type ExecuteActionParams = {
  /** The action ID to execute */
  actionID: string;
  /** The resource ID (for instance-scoped actions) */
  id?: string;
  /** The resource namespace */
  namespace?: string;
  /** Action-specific parameters */
  params?: Record<string, unknown>;
};

/**
 * useExecuteAction provides a mutation for executing a resource action.
 * Returns a mutate function that can be called with action details.
 */
export const useExecuteAction = ({
  pluginID,
  connectionID,
  resourceKey,
}: UseExecuteActionOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const mutation = useMutation({
    mutationFn: async ({ actionID, id = '', namespace = '', params = {} }: ExecuteActionParams) =>
      ExecuteAction(
        pluginID,
        connectionID,
        resourceKey,
        actionID,
        types.ActionInput.createFrom({ id, namespace, params }),
      ),
    onSuccess: (result) => {
      if (result.message) {
        showSnackbar(result.message, 'success');
      }
      // Invalidate the resource list cache so tables refresh after actions like upgrade/rollback
      void queryClient.invalidateQueries({
        queryKey: ['RESOURCES', pluginID, connectionID, resourceKey],
      });
    },
    onError: (error: unknown, variables) => {
      const msg = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : String(error);
      showSnackbar(
        `Failed to execute action "${variables.actionID}": ${msg}`,
        'error',
      );
    },
  });

  return {
    executeAction: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    error: mutation.error,
  };
};

export default useResourceActions;
