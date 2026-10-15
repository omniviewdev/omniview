import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { useEffect, useRef } from 'react';

/**
 * graphChangedEvent is the event the host emits, at most about once a second,
 * when relationship edges touching a connection change.
 */
export function graphChangedEvent(pluginID: string, connectionID: string): string {
  return `${pluginID}/${connectionID}/graph/CHANGED`;
}

/**
 * useRefetchOnGraphChange invalidates one query whenever the host reports a
 * relationship graph change for the connection.
 */
export function useRefetchOnGraphChange(
  pluginID: string,
  connectionID: string,
  queryKey: QueryKey,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();

  // The key array is rebuilt every render; subscribe per distinct key only.
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const keyHash = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || !pluginID || !connectionID) {
      return;
    }

    const cancel = Events.On(graphChangedEvent(pluginID, connectionID), () => {
      void queryClient.invalidateQueries({ queryKey: keyRef.current, exact: true });
    });

    return () => {
      cancel();
    };
  }, [queryClient, pluginID, connectionID, keyHash, enabled]);
}
