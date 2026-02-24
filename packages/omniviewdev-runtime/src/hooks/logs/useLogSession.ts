import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../snackbar/useSnackbar';
import { CreateSession, CloseSession } from '../../wailsjs/go/logs/Client';
import { logs } from '../../wailsjs/go/models';
import { useBottomDrawer } from '../drawer';

type UseLogSessionOptions = {
  pluginID: string;
};

type CreateLogSessionArgs = {
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  resourceData: Record<string, any>;
  icon?: string | React.ReactNode;
  label?: string;
  target?: string;
  follow?: boolean;
  tailLines?: number;
  params?: Record<string, string>;
};

export const useLogs = ({ pluginID }: UseLogSessionOptions) => {
  const { showSnackbar } = useSnackbar();
  const { createTab } = useBottomDrawer();

  const createSessionMutation = useMutation({
    mutationFn: async ({
      connectionID,
      resourceKey,
      resourceID,
      resourceData,
      icon,
      label,
      target,
      follow = true,
      tailLines = 1000,
      params,
    }: CreateLogSessionArgs) => {
      const opts = logs.CreateSessionOptions.createFrom({
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_data: resourceData,
        options: logs.LogSessionOptions.createFrom({
          target: target ?? '',
          follow,
          include_previous: false,
          include_timestamps: true,
          tail_lines: tailLines,
          since_seconds: 0,
          limit_bytes: 0,
          include_source_events: true,
          params: params ?? {},
        }),
      });

      const session = await CreateSession(pluginID, connectionID, opts);
      createTab({
        id: session.id,
        title: label ?? `Logs ${session.id.substring(0, 8)}`,
        variant: 'logs',
        icon: icon ?? 'LuLogs',
      });
      return session;
    },
    onError(error: Error) {
      showSnackbar(`Failed to start log session: ${error.message}`, 'error');
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: async (sessionID: string) => {
      await CloseSession(sessionID);
    },
    onError(error: Error) {
      showSnackbar(`Failed to close log session: ${error.message}`, 'error');
    },
  });

  return {
    createLogSession: createSessionMutation.mutateAsync,
    closeLogSession: closeSessionMutation.mutateAsync,
  };
};

export default useLogs;
