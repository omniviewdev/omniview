import { useQuery } from '@tanstack/react-query';
import { GetResourceAreaComponent } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/servicewrapper';
import type { GetResourceAreaComponentInput } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/ui/models';


export const useResourceAreaComponent = (params: GetResourceAreaComponentInput) => {
  const queryKey = ['component', params.plugin, params.resource, params.area];

  const component = useQuery({
    queryKey,
    queryFn: async () => GetResourceAreaComponent(params),
  });

  return {
    /**
     * Fetch result for the resource. The client will automatically cache the result, and update the cache
     * when the resource is updated or deleted via the returned update and remove mutation functions.
     */
    component,
  };
};

export default useResourceAreaComponent;
