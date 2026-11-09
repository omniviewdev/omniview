import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { ResolveTarget } from '../../resource/v2/client';
import type { ResolveTargetRequest } from '../../resource/v2/host';
import { parseAppError } from '../../errors/parseAppError';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionGeneration } from './useConnectionGeneration';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

/**
 * Authority, generation and representation admission belong to the host.
 *
 * A resolution is scoped to the connection's readiness generation, so a restarted,
 * reconfigured or replaced connection never serves the admission it gave before.
 * When a native source behind the same connection ID was replaced, the host rejects
 * the first resolution with RESET_REQUIRED and admits the next one. This hook asks
 * exactly once more, like the completion session. Any other error, and a second
 * RESET_REQUIRED, surfaces as the query's error.
 */
export function useResolvedResourceTarget({
  pluginID: explicitPluginID, enabled = true, ...request
}: ResolveTargetRequest & { pluginID?: string; enabled?: boolean }) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const readinessEnabled = enabled && !!request.type;
  const readiness = useConnectionReadiness({ pluginID, connectionID: request.route.connection, enabled: readinessEnabled });
  const guardQuery = useConnectionQueryGuard(pluginID, request.route.connection);
  const generation = useConnectionGeneration(pluginID, request.route.connection, readinessEnabled);
  const queryEnabled = readinessEnabled && !!pluginID && !!request.route.connection && readiness.phase === 'connected' && generation !== undefined;
  const query = useQuery({
    queryKey: [pluginID, 'resource-v2', 'resolve-target', request, generation],
    queryFn: queryEnabled ? async ({ signal, queryKey }) => {
      try {
        return await guardQuery(queryKey, signal, () => ResolveTarget(pluginID, request));
      } catch (error) {
        if (parseAppError(error).code !== 'RESET_REQUIRED') throw error;
        await queryClient.invalidateQueries({ queryKey: [pluginID, 'resource-v2', 'catalog', request.route, generation] });
        return guardQuery(queryKey, signal, () => ResolveTarget(pluginID, request));
      }
    } : skipToken,
    enabled: queryEnabled,
    retry: false,
    placeholderData: undefined,
  });
  // An old admission is never a placeholder for a pending, failed or disabled resolution.
  return { ...query, data: queryEnabled && query.isSuccess && !query.isFetching ? query.data : undefined };
}
