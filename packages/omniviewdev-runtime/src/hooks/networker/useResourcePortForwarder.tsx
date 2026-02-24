import { PortForwardResourceOpts } from './types';
import { ALL_SESSIONS_KEY } from './usePortForwardSessions';
import { networker } from '../../wailsjs/go/models';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import {
  ClosePortForwardSession,
  FindPortForwardSessions,
  StartResourcePortForwardingSession,
} from '../../wailsjs/go/networker/Client';
import { useSnackbar } from '../snackbar';
import { createErrorHandler, parseAppError } from '../../errors/parseAppError';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
* Programatically forward a port from a resource object to the host.
*/
export function useResourcePortForwarder({ pluginID, connectionID, resourceID }: { pluginID: string; connectionID: string; resourceID: string }) {
  const queryKey = ['networker', 'portforward', 'sessions', pluginID, connectionID, resourceID];

  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey,
    queryFn: async () => FindPortForwardSessions(pluginID, connectionID, networker.FindPortForwardSessionRequest.createFrom({
      resource_id: resourceID,
      connection_id: connectionID,
    })).catch((e: unknown) => {
      const appErr = parseAppError(e);
      // "not found" means the plugin doesn't have the networker capability — not an error.
      if (appErr.detail.includes('not found')) {
        return [];
      }
      showSnackbar({ message: 'Failed to fetch port forward sessions', status: 'error', details: appErr.detail });
      return [];
    }),
    retry: false,
  });

  const forwardMutation = useMutation({
    mutationFn: async ({ opts }: { opts: Partial<PortForwardResourceOpts> }) => {
      const sessionOpts = networker.PortForwardSessionOptions.createFrom({
        local_port: opts.localPort || 0,
        remote_port: opts.remotePort,
        protocol: opts.protocol || 'TCP',
        connection_type: 'RESOURCE',
        connection: {
          resource_data: opts.resource,
          connection_id: connectionID,
          plugin_id: pluginID,
          resource_id: opts.resourceId,
          resource_key: opts.resourceKey,
        },
        labels: opts.labels ?? {},
        params: opts.parameters ?? {},
      });

      const result = await StartResourcePortForwardingSession(pluginID, connectionID, sessionOpts);
      if (opts.openInBrowser) {
        BrowserOpenURL(`http://localhost:${result.local_port}`);
      }
      return result
    },
    onError: createErrorHandler(showSnackbar, 'Failed to start port forwarding session'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...ALL_SESSIONS_KEY] }),
      ]);
    }
  });

  // const forward: PortForwardResourceFunction = React.useCallback(async (opts) => {
  //   const sessionOpts = networker.PortForwardSessionOptions.createFrom({
  //     local_port: opts.localPort || 0,
  //     remote_port: opts.remotePort,
  //     protocol: opts.protocol || 'TCP',
  //     connection_type: 'RESOURCE',
  //     connection: {
  //       resource_data: opts.resource,
  //       connection_id: connectionID,
  //       plugin_id: pluginID,
  //       resource_id: opts.resourceId,
  //       resource_key: opts.resourceKey,
  //     },
  //     labels: opts.labels ?? {},
  //     params: opts.parameters ?? {},
  //   });
  //
  //   try {
  //     const session = await StartResourcePortForwardingSession(pluginID, connectionID, sessionOpts);
  //     setSessions([...sessions, session]);
  //     if (opts.openInBrowser) {
  //       BrowserOpenURL(`http://localhost:${session.local_port}`);
  //     }
  //
  //     return session;
  //   } catch (e) {
  //     if (e instanceof Error) {
  //       showSnackbar(`Failed to start port forwarding sessions: ${e.message}`, 'error');
  //     }
  //
  //     throw e;
  //   }
  // }, [pluginID, connectionID, sessions]);

  const closeMutation = useMutation({
    mutationFn: async ({ opts }: { opts: { sessionID: string } }) => ClosePortForwardSession(opts.sessionID),
    onError: createErrorHandler(showSnackbar, 'Failed to close port forwarding session'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: [...ALL_SESSIONS_KEY] }),
      ]);
    }
  });

  // const close = React.useCallback(async (sessionId: string) => {
  //   try {
  //     await ClosePortForwardSession(sessionId);
  //     setSessions(sessions.filter((s) => s.id !== sessionId));
  //   } catch (e) {
  //     if (e instanceof Error) {
  //       showSnackbar(`Failed to close port forwarding sessions: ${e.message}`, 'error');
  //     }
  //
  //     throw e;
  //   }
  // }, [sessions]);

  return {
    sessions,
    forward: forwardMutation.mutateAsync,
    close: closeMutation.mutateAsync,
  };
}

export default useResourcePortForwarder
