import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GetConnection,
  SaveConnectionProfile,
  ImportConnectionProfile,
  ResetConnectionProfile,
  RemoveConnection,
} from '../../resource/v2/client';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { ConnectionProfileCredentials, ConnectionProfileResult } from '../../resource/v2/host';
import { useNotifications } from '../../activity/context';
import { createErrorHandler } from '../../errors/parseAppError';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';
import {
  invalidateConnectionReadiness,
  startConnectionWithReadiness,
  stopConnectionWithReadiness,
} from '../../connection/connectionReadiness';

function requireAppliedProfile(result: ConnectionProfileResult) {
  if (!result.applied) throw new Error('Connection profile was not applied');
  return result;
}

/** Connection lifecycle and explicit desired profiles remain separate from native discovery. */
export const useConnection = ({
  pluginID: explicitPluginID,
  connectionID,
  enabled = true,
}: {
  pluginID?: string;
  connectionID: string;
  enabled?: boolean;
}) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const queryKey = [pluginID, 'connection', 'detail', connectionID];
  const invalidateEffectiveState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [pluginID, 'connection'] }),
      queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(pluginID) }),
      queryClient.invalidateQueries({ queryKey: [pluginID, 'resource-v2', 'editor-schemas'] }),
      queryClient.invalidateQueries({ queryKey: ['metric'] }),
    ]);
  };
  const refreshProfileState = async () => {
    invalidateConnectionReadiness(pluginID, connectionID);
    await invalidateEffectiveState();
  };
  const { mutateAsync: startConnection } = useMutation({
    mutationFn: () => startConnectionWithReadiness(pluginID, connectionID),
    // Lifecycle responses never replace the connection metadata cache.
    onSuccess: invalidateEffectiveState,
    onError: createErrorHandler(notify, 'Failed to start connection'),
  });
  const { mutateAsync: stopConnection } = useMutation({
    mutationFn: () => stopConnectionWithReadiness(pluginID, connectionID),
    onSuccess: invalidateEffectiveState,
    onError: createErrorHandler(notify, 'Failed to stop connection'),
  });
  const { mutateAsync: saveProfile } = useMutation({
    mutationFn: ({
      connection,
      credentials,
    }: {
      connection: Connection;
      credentials?: ConnectionProfileCredentials;
    }) => SaveConnectionProfile(pluginID, connection, credentials).then(requireAppliedProfile),
    onSuccess: () => {
      void notify({ title: 'Connection profile saved', severity: 'success' });
    },
    onError: createErrorHandler(notify, 'Failed to save connection profile'),
    onSettled: refreshProfileState,
  });
  const saveConnectionProfile = (
    connection: Connection,
    credentials?: ConnectionProfileCredentials,
  ) => saveProfile({ connection, credentials });
  const { mutateAsync: importConnectionProfile } = useMutation({
    mutationFn: () => ImportConnectionProfile(pluginID, connectionID).then(requireAppliedProfile),
    onSuccess: () => {
      void notify({ title: 'Connection profile imported', severity: 'success' });
    },
    onError: createErrorHandler(notify, 'Failed to import connection profile'),
    onSettled: refreshProfileState,
  });
  const { mutateAsync: resetConnectionProfile } = useMutation({
    mutationFn: () => ResetConnectionProfile(pluginID, connectionID).then(requireAppliedProfile),
    onSuccess: () => {
      void notify({ title: 'Connection profile reset', severity: 'success' });
    },
    onError: createErrorHandler(notify, 'Failed to reset connection profile'),
    onSettled: refreshProfileState,
  });
  const { mutateAsync: removeConnection } = useMutation({
    mutationFn: () => RemoveConnection(pluginID, connectionID),
    onSuccess: () => {
      invalidateConnectionReadiness(pluginID, connectionID, true);
      void notify({ title: 'Connection disabled', severity: 'success' });
    },
    onError: createErrorHandler(notify, 'Failed to disable connection'),
    onSettled: invalidateEffectiveState,
  });
  const connection = useQuery({
    queryKey,
    queryFn: () => GetConnection(pluginID, connectionID),
    enabled: enabled && !!connectionID,
  });
  return {
    connection,
    startConnection,
    stopConnection,
    saveConnectionProfile,
    importConnectionProfile,
    resetConnectionProfile,
    removeConnection,
  };
};
