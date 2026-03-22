import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from '../snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { CreateSession, CloseSession } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/logs/servicewrapper';
import { CreateSessionOptions, LogSessionOptions } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import { useBottomDrawer } from '../drawer';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseLogSessionOptions = {
  pluginID?: string;
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

export const useLogs = ({ pluginID: explicitPluginID }: UseLogSessionOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
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
      const opts = CreateSessionOptions.createFrom({
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_data: resourceData,
        options: LogSessionOptions.createFrom({
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
      if (!session) throw new Error('Failed to create log session: null response');
      createTab({
        id: session.id,
        title: label ?? `Logs ${session.id.substring(0, 8)}`,
        variant: 'logs',
        icon: icon ?? 'LuLogs',
      });
      return session;
    },
    onError: createErrorHandler(showSnackbar, 'Failed to start log session'),
  });

  const closeSessionMutation = useMutation({
    mutationFn: async (sessionID: string) => {
      await CloseSession(sessionID);
    },
    onError: createErrorHandler(showSnackbar, 'Failed to close log session'),
  });

  return {
    createLogSession: createSessionMutation.mutateAsync,
    closeLogSession: closeSessionMutation.mutateAsync,
  };
};

export default useLogs;
