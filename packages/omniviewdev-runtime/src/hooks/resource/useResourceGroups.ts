import { useQuery } from '@tanstack/react-query';
import { GetResourceGroups } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';

export const useResourceGroups = ({ pluginID: explicitPluginID, route }: { pluginID?: string; route: AccessRoute }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const groups = useQuery({
    queryKey: [pluginID, 'resource-v2', 'groups', route],
    queryFn: () => GetResourceGroups(pluginID, route),
    retry: false,
  });
  return { groups };
};

export default useResourceGroups;
