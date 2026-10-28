import { useQuery } from '@tanstack/react-query';
import { Catalog } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useResourceType = ({ pluginID: explicitPluginID, route, type }: { pluginID?: string; route: AccessRoute; type: string }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const resourceType = useQuery({
    queryKey: [pluginID, 'resource-v2', 'catalog', route],
    queryFn: () => Catalog(pluginID, { route }),
    select: (catalog) => catalog.types.find((entry) => entry.type === type),
    retry: false,
  });
  return { resourceType };
};

export default useResourceType;
