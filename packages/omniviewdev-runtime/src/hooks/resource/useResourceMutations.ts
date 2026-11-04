import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from '../../activity/context';
import { createErrorHandler } from '../../errors/parseAppError';
import { Mutate } from '../../resource/v2/client';
import type { MutationRequest } from '../../resource/v2/domain';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { requireConnectionReady } from '../../connection/connectionReadiness';

export const useResourceMutations = ({ pluginID: explicitPluginID }: { pluginID?: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const mutation = useMutation({
    mutationFn: async (request: MutationRequest) => {
      await requireConnectionReady(pluginID, request.route.connection);
      return Mutate(pluginID, request);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) });
    },
    onError: createErrorHandler(notify, 'Failed to mutate resource'),
  });
  return { mutate: mutation.mutateAsync, mutation };
};

export default useResourceMutations;
