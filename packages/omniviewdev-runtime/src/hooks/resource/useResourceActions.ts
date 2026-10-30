import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { showAppError } from '../../errors/parseAppError';
import { GetActions, Action } from '../../resource/v2/client';
import type { AccessRoute, ActionRequest } from '../../resource/v2/domain';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { requireConnectionReady } from '../../connection/connectionReadiness';

export const useResourceActions = ({
  pluginID: explicitPluginID, route, type, enabled = true,
}: { pluginID?: string; route: AccessRoute; type: string; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const connectionID = route.connection;
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: enabled && !!type });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'actions', route, type],
    queryFn: enabled && !!type && readiness.phase === 'connected' ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetActions(pluginID, route, type)) : skipToken,
    enabled: enabled && !!pluginID && !!route.connection && !!type && readiness.phase === 'connected',
    staleTime: 5 * 60 * 1000,
  });
  return { actions: query.data ?? [], isLoading: query.isLoading, error: query.error };
};

export const useExecuteAction = ({ pluginID: explicitPluginID }: { pluginID?: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const mutation = useMutation({
    mutationFn: async (request: ActionRequest) => {
      await requireConnectionReady(pluginID, request.route.connection);
      return Action(pluginID, request);
    },
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
