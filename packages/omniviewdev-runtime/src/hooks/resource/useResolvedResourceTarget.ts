import { useQuery } from '@tanstack/react-query';
import { ResolveTarget } from '../../resource/v2/client';
import type { ResolveTargetRequest } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';

/** Authority, generation and representation admission belong to the host. */
export function useResolvedResourceTarget({
  pluginID: explicitPluginID, enabled = true, ...request
}: ResolveTargetRequest & { pluginID?: string; enabled?: boolean }) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'resolve-target', request],
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      const pending = ResolveTarget(pluginID, request);
      const cancel = () => { void pending.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      return pending.finally(() => signal.removeEventListener('abort', cancel));
    },
    enabled: enabled && !!pluginID && !!request.route.connection && !!request.type,
    retry: false,
    placeholderData: undefined,
  });
  // An old admission is never a placeholder for a pending, failed or disabled resolution.
  return { ...query, data: enabled && query.isSuccess && !query.isFetching ? query.data : undefined };
}
