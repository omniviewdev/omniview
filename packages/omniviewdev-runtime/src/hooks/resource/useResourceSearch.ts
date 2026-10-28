import { useQueries } from '@tanstack/react-query';
import { NativeQuery } from '../../resource/v2/client';
import type { HostNativeQueryRequest } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';

/** Bounded provider-native acquisitions, not a host-wide query result. */
export const useResourceSearch = ({
  pluginID: explicitPluginID, searches,
}: { pluginID?: string; searches: readonly HostNativeQueryRequest[] }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  return useQueries({
    queries: searches.map((request) => ({
      queryKey: resourceQueryKeys.nativeQuery(pluginID, request),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        signal.throwIfAborted();
        const pending = NativeQuery(pluginID, request);
        const cancel = () => { void pending.cancel(); };
        signal.addEventListener('abort', cancel, { once: true });
        return pending.finally(() => signal.removeEventListener('abort', cancel));
      },
      retry: false,
    })),
  });
};

export default useResourceSearch;
