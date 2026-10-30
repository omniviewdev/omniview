import { skipToken, useQuery } from '@tanstack/react-query';
import { GetResourceGroups } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

export const useResourceGroups = ({ pluginID: explicitPluginID, route, enabled = true }: { pluginID?: string; route: AccessRoute; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const queryEnabled = enabled && !!pluginID && !!route.connection && readiness.phase === 'connected';
  const groups = useQuery({
    queryKey: [pluginID, 'resource-v2', 'groups', route],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => GetResourceGroups(pluginID, route)) : skipToken,
    enabled: queryEnabled,
    retry: false,
  });
  return { groups };
};

export default useResourceGroups;
