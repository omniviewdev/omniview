import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GetConnection, SaveConnectionProfile, ImportConnectionProfile, ResetConnectionProfile, RemoveConnection, StartConnection, StopConnection } from '../../resource/v2/client';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { ConnectionProfileResult } from '../../resource/v2/host';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';

function requireAppliedProfile(result: ConnectionProfileResult) {
  if (!result.applied) throw new Error('Connection profile was not applied');
  return result;
}

/** Connection lifecycle and explicit desired profiles remain separate from native discovery. */
export const useConnection = ({
  pluginID: explicitPluginID, connectionID, enabled = true,
}: { pluginID?: string; connectionID: string; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const queryKey = [pluginID, 'connection', 'detail', connectionID];
  const invalidateEffectiveState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [pluginID, 'connection'] }),
      queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) }),
      queryClient.invalidateQueries({ queryKey: ['EDITOR_SCHEMAS', pluginID] }),
    ]);
  };
  const { mutateAsync: startConnection } = useMutation({
    mutationFn: () => StartConnection(pluginID, connectionID),
    // Start returns ConnectionStatus, never a Connection detail-cache replacement.
    onSuccess: invalidateEffectiveState,
    onError: createErrorHandler(showSnackbar, 'Failed to start connection'),
  });
  const { mutateAsync: stopConnection } = useMutation({
    mutationFn: () => StopConnection(pluginID, connectionID),
    onSuccess: invalidateEffectiveState,
    onError: createErrorHandler(showSnackbar, 'Failed to stop connection'),
  });
  const { mutateAsync: saveConnectionProfile } = useMutation({
    mutationFn: (connection: Connection) => SaveConnectionProfile(pluginID, connection).then(requireAppliedProfile),
    onSuccess: () => { showSnackbar('Connection profile saved', 'success'); },
    onError: createErrorHandler(showSnackbar, 'Failed to save connection profile'),
    onSettled: invalidateEffectiveState,
  });
  const { mutateAsync: importConnectionProfile } = useMutation({
    mutationFn: () => ImportConnectionProfile(pluginID, connectionID).then(requireAppliedProfile),
    onSuccess: () => { showSnackbar('Connection profile imported', 'success'); },
    onError: createErrorHandler(showSnackbar, 'Failed to import connection profile'),
    onSettled: invalidateEffectiveState,
  });
  const { mutateAsync: resetConnectionProfile } = useMutation({
    mutationFn: () => ResetConnectionProfile(pluginID, connectionID).then(requireAppliedProfile),
    onSuccess: () => { showSnackbar('Connection profile reset', 'success'); },
    onError: createErrorHandler(showSnackbar, 'Failed to reset connection profile'),
    onSettled: invalidateEffectiveState,
  });
  const { mutateAsync: removeConnection } = useMutation({
    mutationFn: () => RemoveConnection(pluginID, connectionID),
    onSuccess: () => { showSnackbar('Connection disabled', 'success'); },
    onError: createErrorHandler(showSnackbar, 'Failed to disable connection'),
    onSettled: invalidateEffectiveState,
  });
  const connection = useQuery({
    queryKey,
    queryFn: () => GetConnection(pluginID, connectionID),
    enabled: enabled && !!connectionID,
  });
  return { connection, startConnection, stopConnection, saveConnectionProfile, importConnectionProfile, resetConnectionProfile, removeConnection };
};
