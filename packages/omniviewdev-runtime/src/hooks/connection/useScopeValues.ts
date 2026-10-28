import { useQuery } from '@tanstack/react-query';
import { ScopeValues } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useScopeValues = ({
  pluginID: explicitPluginID, route, dimension, enabled = true,
}: { pluginID?: string; route: AccessRoute; dimension: string; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const values = useQuery({
    queryKey: [pluginID, 'resource-v2', 'scope-values', route, dimension],
    queryFn: () => ScopeValues(pluginID, route, dimension),
    enabled: enabled && !!route.connection && !!dimension,
  });
  return { values };
};
