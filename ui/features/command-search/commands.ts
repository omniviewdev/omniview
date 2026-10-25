import { connectionListQueryKey } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import type { QueryClient } from '@tanstack/react-query';

/** The closed palette command uses the same list cache as useConnections. */
export async function reloadConnections(queryClient: QueryClient, pluginId: string) {
  const connections = await ResourceClient.LoadConnections(pluginId);
  const queryKey = connectionListQueryKey(pluginId);
  // Discovery returns only the provider's subset; the existing list query reads
  // the full merged host cache, including user-created connections.
  await queryClient.invalidateQueries({ queryKey });
  return connections;
}
