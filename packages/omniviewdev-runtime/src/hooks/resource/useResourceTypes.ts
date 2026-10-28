import { useQuery } from '@tanstack/react-query';
import { Catalog } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useResourceTypes = ({ pluginID: explicitPluginID, route }: { pluginID?: string; route: AccessRoute }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const resourceTypes = useQuery({
    queryKey: [pluginID, 'resource-v2', 'catalog', route],
    queryFn: () => Catalog(pluginID, { route }),
    select: (catalog) => catalog.types,
    retry: false,
  });
  return { resourceTypes };
};
