import { useQuery } from '@tanstack/react-query';
import { ListConnectionProfiles } from '../../resource/v2/client';
import type { ConnectionProfile } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';

/** Desired profiles include disabled/review entries missing from effective discovery. */
export function useConnectionProfiles({ pluginID: explicitPluginID }: { pluginID?: string }) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const profiles = useQuery<readonly ConnectionProfile[]>({
    queryKey: [pluginID, 'connection', 'profiles'],
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      const pending = ListConnectionProfiles(pluginID);
      const cancel = () => { void pending.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      return pending.finally(() => signal.removeEventListener('abort', cancel));
    },
    enabled: !!pluginID,
    retry: false,
  });
  return { profiles };
}
