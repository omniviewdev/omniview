import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Get, Set } from '../../wailsjs/go/data/Client';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UsePluginDataResult<T> = {
  data: T;
  update: (value: T) => Promise<void>;
  isLoading: boolean;
};

/**
 * Generic hook for reading/writing plugin data from the Plugin Data Store.
 * Uses React Query for caching and optimistic updates.
 */
export function usePluginData<T>(
  explicitPluginID: string | undefined,
  key: string,
  defaultValue: T,
): UsePluginDataResult<T> {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const queryKey = [pluginID, 'data', key];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await Get(pluginID, key);
      if (result === null || result === undefined) {
        return defaultValue;
      }
      return result as T;
    },
  });

  const mutation = useMutation({
    mutationFn: async (value: T) => {
      await Set(pluginID, key, value);
    },
    onMutate: async (value: T) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<T>(queryKey);
      queryClient.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_err, _value, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    data: query.data ?? defaultValue,
    update: async (value: T) => {
      await mutation.mutateAsync(value);
    },
    isLoading: query.isLoading,
  };
}
