import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Get, Set } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/data/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UsePluginDataResult<T> = {
  data: T;
  update: (value: T) => Promise<void>;
  isLoading: boolean;
};

/**
 * Check whether a value from the data store structurally matches the expected
 * type indicated by the default value. This catches cases where the Go backend
 * returns a JSON type that doesn't match the TypeScript generic (e.g. an object
 * was stored but the caller expects an array).
 */
function matchesShape<T>(value: unknown, defaultValue: T): value is T {
  if (Array.isArray(defaultValue)) return Array.isArray(value);
  if (defaultValue !== null && typeof defaultValue === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof defaultValue;
}

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
      if (!matchesShape(result, defaultValue)) {
        console.warn(
          `[usePluginData] stored value for "${key}" has unexpected type ` +
          `(expected ${Array.isArray(defaultValue) ? 'array' : typeof defaultValue}, ` +
          `got ${Array.isArray(result) ? 'array' : typeof result}). Using default.`,
        );
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
