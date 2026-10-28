import type { ReadTarget } from './resource/v2/domain';
import type { HostEnumerateRequest, HostGetRequest, HostNativeQueryRequest } from './resource/v2/host';

/** React Query partitions include route and representation, not display fields. */
export const resourceQueryKeys = {
  all: (pluginID: string) => [pluginID, 'resource-v2'] as const,
  scope: (pluginID: string, target: ReadTarget) => [pluginID, 'resource-v2', 'target', target] as const,
  list: (pluginID: string, request?: HostEnumerateRequest) => [pluginID, 'resource-v2', 'enumerate', request] as const,
  nativeQuery: (pluginID: string, request?: HostNativeQueryRequest) => [pluginID, 'resource-v2', 'native-query', request] as const,
  resource: (pluginID: string, request?: HostGetRequest) => [pluginID, 'resource-v2', 'get', request] as const,
};
