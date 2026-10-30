import { skipToken, useQuery } from '@tanstack/react-query';
import { ScopeValues } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from './useConnectionReadiness';
import { useConnectionQueryGuard } from '../resource/useConnectionQueryGuard';

export const useScopeValues = ({
  pluginID: explicitPluginID, route, dimension, enabled = true,
}: { pluginID?: string; route: AccessRoute; dimension: string; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: enabled && !!dimension });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const queryEnabled = enabled && !!pluginID && !!route.connection && !!dimension && readiness.phase === 'connected';
  const values = useQuery({
    queryKey: [pluginID, 'resource-v2', 'scope-values', route, dimension],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => ScopeValues(pluginID, route, dimension)) : skipToken,
    enabled: queryEnabled,
  });
  return { values };
};
