/** Shared keys for native ListResult/GetResult snapshots, never display labels or search text. */
export const resourceQueryKeys = {
  scope: (pluginId: string, connectionId: string, resourceKey: string) =>
    [pluginId, connectionId, resourceKey] as const,
  list: (pluginId: string, connectionId: string, resourceKey: string, namespaces: readonly string[] = []) =>
    [pluginId, connectionId, resourceKey, namespaces, 'list'] as const,
  resource: (pluginId: string, connectionId: string, resourceKey: string, resourceId: string, namespace = '') =>
    [pluginId, connectionId, resourceKey, namespace, resourceId] as const,
};
