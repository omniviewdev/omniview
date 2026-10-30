import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { Get, Mutate } from '../../resource/v2/client';
import type { MutationRequest } from '../../resource/v2/domain';
import type { HostGetRequest } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { requireConnectionReady } from '../../connection/connectionReadiness';

export const useResource = ({
  pluginID: explicitPluginID,
  request,
  enabled = true,
}: { pluginID?: string; request?: HostGetRequest; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const connectionID = request?.request.route.connection ?? '';
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: enabled && !!request });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const queryKey = resourceQueryKeys.resource(pluginID, request);
  const queryEnabled = enabled && !!request && readiness.phase === 'connected';
  const { mutateAsync: mutate } = useMutation({
    mutationFn: async (input: Omit<MutationRequest, 'route' | 'reference'>) => {
      if (!request) throw new Error('Resource target is not resolved');
      await requireConnectionReady(pluginID, request.request.route.connection);
      return Mutate(pluginID, {
        ...input,
        route: request.request.route,
        reference: request.request.reference,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to mutate resource'),
  });
  const resource = useQuery({
    queryKey,
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => Get(pluginID, request!)) : skipToken,
    retry: false,
    enabled: queryEnabled,
  });
  return { resource, mutate };
};

export default useResource;
