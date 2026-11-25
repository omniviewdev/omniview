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
  return useRootConnectionMetadata(pluginID, enabled ? connectionID : undefined);
}
