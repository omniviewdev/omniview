import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { Mutate } from '../../resource/v2/client';
import type { MutationRequest } from '../../resource/v2/domain';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useResourceMutations = ({ pluginID: explicitPluginID }: { pluginID?: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const mutation = useMutation({
    mutationFn: (request: MutationRequest) => Mutate(pluginID, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) });
    },
    onError: createErrorHandler(showSnackbar, 'Failed to mutate resource'),
  });
  return { mutate: mutation.mutateAsync, mutation };
};

export default useResourceMutations;
