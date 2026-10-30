import { skipToken, useQuery } from '@tanstack/react-query';
import { ResolveTarget } from '../../resource/v2/client';
import type { ResolveTargetRequest } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

/** Authority, generation and representation admission belong to the host. */
export function useResolvedResourceTarget({
  pluginID: explicitPluginID, enabled = true, ...request
}: ResolveTargetRequest & { pluginID?: string; enabled?: boolean }) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: request.route.connection, enabled: enabled && !!request.type });
  const guardQuery = useConnectionQueryGuard(pluginID, request.route.connection);
  const queryEnabled = enabled && !!pluginID && !!request.route.connection && !!request.type && readiness.phase === 'connected';
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'resolve-target', request],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => ResolveTarget(pluginID, request)) : skipToken,
    enabled: queryEnabled,
    retry: false,
    placeholderData: undefined,
  });
  // An old admission is never a placeholder for a pending, failed or disabled resolution.
  return { ...query, data: queryEnabled && query.isSuccess && !query.isFetching ? query.data : undefined };
}
