import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClosePortForwardSession,
  ListAllPortForwardSessions,
} from '../../wailsjs/go/networker/Client';
import { BrowserOpenURL, EventsOn } from '../../wailsjs/runtime/runtime';
import { useSnackbar } from '../snackbar';
import { createErrorHandler, parseAppError } from '../../errors/parseAppError';

const ALL_SESSIONS_KEY = ['networker', 'portforward', 'all-sessions'] as const;

/**
 * Global hook providing a view of all active port-forward sessions across all plugins.
 * Listens to Wails events for real-time updates instead of polling.
 */
export function usePortForwardSessions() {
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: [...ALL_SESSIONS_KEY],
    queryFn: async () =>
      ListAllPortForwardSessions().catch((e: unknown) => {
        const appErr = parseAppError(e);
        // Suppress "not found" — means no networker plugins are loaded
        if (appErr.detail.includes('not found')) return [];
        throw e;
      }),
    retry: false,
  });

  // Listen for session lifecycle events from the Go backend and invalidate the query cache.
  useEffect(() => {
    const cancelCreated = EventsOn('core/networker/portforward/created', () => {
      queryClient.invalidateQueries({ queryKey: [...ALL_SESSIONS_KEY] });
    });
    const cancelClosed = EventsOn('core/networker/portforward/closed', () => {
      queryClient.invalidateQueries({ queryKey: [...ALL_SESSIONS_KEY] });
    });

    return () => {
      cancelCreated();
      cancelClosed();
    };
  }, [queryClient]);

  // All sessions from ListAllPortForwardSessions are inherently active — closed
  // sessions are removed from the host-side session index. The proto→SDK state
  // conversion has a known bug (int→string gives a code point, not "ACTIVE"),
  // so we don't filter by state here.
  const activeSessions = sessions.data ?? [];

  const closeMutation = useMutation({
    mutationFn: async (sessionID: string) => ClosePortForwardSession(sessionID),
    onError: createErrorHandler(showSnackbar, 'Failed to close port forwarding session'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...ALL_SESSIONS_KEY] });
    },
  });

  return {
    sessions,
    activeSessions,
    closeSession: closeMutation.mutateAsync,
    openInBrowser: (localPort: number) => BrowserOpenURL(`http://localhost:${localPort}`),
  };
}

export { ALL_SESSIONS_KEY };
export default usePortForwardSessions;
