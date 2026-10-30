import { skipToken, useQuery } from '@tanstack/react-query';
import { Catalog } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

export const useResourceType = ({ pluginID: explicitPluginID, route, type }: { pluginID?: string; route: AccessRoute; type: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled: !!type });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const queryEnabled = !!pluginID && !!route.connection && !!type && readiness.phase === 'connected';
  const resourceType = useQuery({
    queryKey: [pluginID, 'resource-v2', 'catalog', route],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => Catalog(pluginID, { route })) : skipToken,
    select: (catalog) => catalog.types.find((entry) => entry.type === type),
    enabled: queryEnabled,
    retry: false,
  });
  return { resourceType };
};

export default useResourceType;
