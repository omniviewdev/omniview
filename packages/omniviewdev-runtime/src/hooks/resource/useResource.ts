import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { Get, Mutate } from '../../resource/v2/client';
import type { MutationRequest } from '../../resource/v2/domain';
import type { HostGetRequest } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { resourceQueryKeys } from '../../resourceQueryKeys';

export const useResource = ({
  pluginID: explicitPluginID,
  request,
  enabled = true,
}: { pluginID?: string; request?: HostGetRequest; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const queryKey = resourceQueryKeys.resource(pluginID, request);
  const { mutateAsync: mutate } = useMutation({
    mutationFn: (input: Omit<MutationRequest, 'route' | 'reference'>) => {
      if (!request) throw new Error('Resource target is not resolved');
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
    queryFn: ({ signal }) => {
      if (!request) throw new Error('Resource target is not resolved');
      signal.throwIfAborted();
      const pending = Get(pluginID, request);
      const cancel = () => { void pending.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      return pending.finally(() => signal.removeEventListener('abort', cancel));
    },
    enabled: enabled && !!request,
    retry: false,
  });
  return { resource, mutate };
};

export default useResource;
