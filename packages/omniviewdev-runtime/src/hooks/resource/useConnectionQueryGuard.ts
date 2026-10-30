import { useCallback } from 'react';
import { CancelledError, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  connectionReadinessStore,
  getConnectionReadinessGeneration,
  isConnectionReadinessCurrent,
} from '../../connection/connectionReadiness';

/** Cancel connection-scoped reads immediately and reject late results after invalidation. */
export function useConnectionQueryGuard(pluginID: string, connectionID: string) {
  const queryClient = useQueryClient();
  return useCallback(async <T,>(queryKey: QueryKey, signal: AbortSignal, operation: () => Promise<T>, routeConnectionID = connectionID): Promise<T> => {
    const connectionID = routeConnectionID;
    const generation = getConnectionReadinessGeneration(pluginID, connectionID);
    const current = () => generation !== undefined && isConnectionReadinessCurrent(pluginID, connectionID, generation);
    if (signal.aborted || !current()) throw new CancelledError({ revert: true });

    let request: Promise<T> | undefined;
    let invalidated = false;
    let released = false;
    const cancelNative = () => {
      if (request && 'cancel' in request && typeof request.cancel === 'function') {
        void Promise.resolve(request.cancel()).catch((error: unknown) => {
          console.error('Failed to cancel resource query', error);
        });
      }
      releaseOnce();
    };
    const release = connectionReadinessStore(pluginID, connectionID).subscribe(() => {
      if (current()) return;
      invalidated = true;
      void queryClient.cancelQueries({ queryKey, exact: true }).catch((error: unknown) => {
        console.error('Failed to cancel invalidated resource query', error);
      });
    });
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };
    signal.addEventListener('abort', cancelNative, { once: true });
    try {
      if (signal.aborted || invalidated || !current()) throw new CancelledError({ revert: true });
      request = operation();
      const result = await request;
      if (signal.aborted || invalidated || !current()) throw new CancelledError({ revert: true });
      return result;
    } finally {
      signal.removeEventListener('abort', cancelNative);
      releaseOnce();
    }
  }, [pluginID, connectionID, queryClient]);
}
