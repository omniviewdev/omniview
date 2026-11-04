import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Get,
  GetSnapshot,
  CompareAndSwap,
  Set,
} from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/data/servicewrapper';
import { useResolvedPluginId } from '../useResolvedPluginId';

type PluginDataUpdate<T> = T | ((current: T) => T);

type UsePluginDataResult<T> = {
  data: T;
  update: (value: PluginDataUpdate<T>) => Promise<void>;
  isLoading: boolean;
};

/**
 * Check whether a value from the data store structurally matches the expected
 * type indicated by the default value. This catches cases where the Go backend
 * returns a JSON type that doesn't match the TypeScript generic (e.g. an object
 * was stored but the caller expects an array).
 */
function matchesShape<T>(value: unknown, defaultValue: T): value is T {
  if (defaultValue === null) return value === null;
  if (Array.isArray(defaultValue)) return Array.isArray(value);
  if (typeof defaultValue === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof defaultValue;
}

/**
 * Generic hook for reading/writing plugin data from the Plugin Data Store.
 * Functional updaters must be pure: conflicts re-evaluate them against a fresh
 * backend snapshot, up to eight attempts. Mutation scope also orders local calls.
 */
export function usePluginData<T>(
  explicitPluginID: string | undefined,
  key: string,
  defaultValue: T,
): UsePluginDataResult<T> {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const queryKey = [pluginID, 'data', key];

  async function readPersistedValue() {
    return persistedValue(await Get(pluginID, key));
  }

  function persistedValue(result: unknown): T {
    if (result === null || result === undefined) return defaultValue;
    if (!matchesShape(result, defaultValue)) {
      console.warn(
        `[usePluginData] stored value for "${key}" has unexpected type ` +
          `(expected ${Array.isArray(defaultValue) ? 'array' : typeof defaultValue}, ` +
          `got ${Array.isArray(result) ? 'array' : typeof result}). Using default.`,
      );
      return defaultValue;
    }
    return result as T;
  }

  const query = useQuery({ queryKey, queryFn: readPersistedValue });

  const mutation = useMutation({
    scope: { id: JSON.stringify(queryKey) },
    mutationFn: async (next: PluginDataUpdate<T>) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const cached = queryClient.getQueryData<T>(queryKey);
      const previous = cached === undefined ? defaultValue : cached;
      try {
        if (typeof next !== 'function') {
          queryClient.setQueryData(queryKey, next);
          await Set(pluginID, key, next);
          return;
        }
        for (let attempt = 0; attempt < 8; attempt++) {
          const snapshot = await GetSnapshot(pluginID, key);
          const value = (next as (current: T) => T)(
            persistedValue(snapshot.value),
          );
          queryClient.setQueryData(queryKey, value);
          if (await CompareAndSwap(pluginID, key, snapshot.revision, value)) {
            return;
          }
        }
        throw new Error(
          `[usePluginData] update for "${key}" conflicted after 8 attempts`,
        );
      } catch (error) {
        queryClient.setQueryData(queryKey, previous);
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });

  return {
    data: query.data ?? defaultValue,
    update: mutation.mutateAsync,
    isLoading: query.isLoading,
  };
}
