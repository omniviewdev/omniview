import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { showAppError } from '../../errors/parseAppError';
import { GetActions, Action } from '../../resource/v2/client';
import type { AccessRoute, ActionRequest } from '../../resource/v2/domain';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useResourceActions = ({
  pluginID: explicitPluginID, route, type, enabled = true,
}: { pluginID?: string; route: AccessRoute; type: string; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'actions', route, type],
    queryFn: () => GetActions(pluginID, route, type),
    enabled: enabled && !!pluginID && !!route.connection && !!type,
    staleTime: 5 * 60 * 1000,
  });
  return { actions: query.data ?? [], isLoading: query.isLoading, error: query.error };
};

export const useExecuteAction = ({ pluginID: explicitPluginID }: { pluginID?: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const mutation = useMutation({
    mutationFn: (request: ActionRequest) => Action(pluginID, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) });
    },
    onError: (error: unknown, request) => {
      showAppError(showSnackbar, error, `Failed to execute action "${request.action}"`);
    },
  });
  return { executeAction: mutation.mutateAsync, isExecuting: mutation.isPending, error: mutation.error };
};

export default useResourceActions;
