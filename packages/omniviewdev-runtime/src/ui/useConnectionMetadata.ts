import { useCallback, useLayoutEffect, useRef } from 'react';
import { useConnectionMetadata as useRootConnectionMetadata } from '../hooks/connection/useConnectionMetadata';
import type { ConnectionMetadataState } from '../hooks/connection/useConnectionMetadata';

export interface UseConnectionMetadataOptions {
  pluginID?: string;
  /** `undefined` reads nothing, as `enabled: false` does. */
  connectionID: string | undefined;
  /** Defaults to true; false reads nothing and subscribes to nothing. */
  enabled?: boolean;
}

/**
 * The curated entry's call, in the options form of `useConnectionReadiness`, `useResources` and `useResolvedResourceTarget`. It is a thin wrapper
 * over the main entry's `useConnectionMetadata(pluginID, connectionID)`, which stays as it shipped (plugins built for the previous UI call that
 * positional form): one implementation, so one cache and one event subscription whichever shape a consumer calls.
 */
export function useConnectionMetadata({ pluginID, connectionID, enabled = true }: UseConnectionMetadataOptions): ConnectionMetadataState & { refresh: () => Promise<void> } {
  const state = useRootConnectionMetadata(pluginID, enabled ? connectionID : undefined);
  // The root `refresh` is memoized on the connection it was given, so a callback kept across a disable would still reach the shared cache.
  // Read the current `enabled` at call time instead: disabled resolves with no request and no change to the cache.
  const enabledRef = useRef(enabled);
  const rootRefreshRef = useRef(state.refresh);
  useLayoutEffect(() => {
    enabledRef.current = enabled;
    rootRefreshRef.current = state.refresh;
  });
  const refresh = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    await rootRefreshRef.current();
  }, []);
  return { ...state, refresh };
}
