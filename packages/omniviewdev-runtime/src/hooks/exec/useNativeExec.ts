import { useCallback, useMemo } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SessionOptions } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models';
import { GetHandler, GetNativeTerminalSupport, OpenNativeSession } from '../../exec';
import { showAppError } from '../../errors/parseAppError';
import { useSnackbar } from '../snackbar/useSnackbar';
import { useResolvedPluginId } from '../useResolvedPluginId';

export type NativeExecInput = {
  connectionID: string;
  opts: Partial<SessionOptions>;
};

export type UseNativeExecResult = {
  openNativeSession: (input: NativeExecInput) => Promise<boolean>;
  isSupported: boolean;
  isPending: boolean;
};

/** Launch a fresh native terminal process; never allocate an integrated tab/session. */
export function useNativeExec({ pluginID: explicitPluginID, resourceKey }: { pluginID?: string; resourceKey: string }): UseNativeExecResult {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const mutationKey = useMemo(() => ['exec', 'native-launch', pluginID, resourceKey], [pluginID, resourceKey]);
  const isPending = useIsMutating({ mutationKey, exact: true }) > 0;
  const platform = useQuery({
    queryKey: ['exec', 'native-terminal-support'],
    queryFn: GetNativeTerminalSupport,
    staleTime: Infinity,
    retry: false,
  });
  const handler = useQuery({
    queryKey: ['executions', pluginID, resourceKey, 'actions'],
    queryFn: async () => ({ exec: await GetHandler(pluginID, resourceKey) }),
    enabled: !!resourceKey && platform.data === true,
    retry: false,
  });
  const isSupported = platform.isSuccess && platform.data === true
    && handler.isSuccess && handler.data.exec?.supports_native_command === true;
  const { mutateAsync } = useMutation({
    mutationKey,
    mutationFn: async ({ connectionID, opts }: NativeExecInput): Promise<boolean> => {
      try {
        await OpenNativeSession(pluginID, connectionID, SessionOptions.createFrom({ tty: true, ...opts }));
        return true;
      } catch (error) {
        showAppError(showSnackbar, error, 'Failed to open native terminal');
        return false;
      }
    },
    retry: false,
  });
  const openNativeSession = useCallback(async (input: NativeExecInput): Promise<boolean> => {
    // Read the shared cache synchronously: another surface may mount mid-launch.
    if (!isSupported || queryClient.isMutating({ mutationKey, exact: true }) > 0) return false;
    return mutateAsync(input);
  }, [isSupported, queryClient, mutationKey, mutateAsync]);

  return { openNativeSession, isSupported, isPending };
}
