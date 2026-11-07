import { useQuery } from '@tanstack/react-query';
import { GetProviders, GetProviderConnections, GetDataSources, GetMetricBindings } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';
import type { MetricSourceRef } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { ListConnections } from '../../resource/v2/client';
import { connectionListQueryKey } from '../connection/useConnections';

export interface MetricSourcePresentation {
  readonly source: Readonly<MetricSourceRef>;
  readonly providerName: string;
  readonly providerIcon: string;
  readonly connectionName: string;
  readonly datasourceName: string;
  readonly label: string;
  readonly available: boolean;
}
export interface MetricSourceInventory {
  readonly providers: readonly { pluginID: string; name: string; icon: string }[];
  readonly options: readonly MetricSourcePresentation[];
  readonly failures: readonly { pluginID: string; message: string }[];
}
export function metricSourceIdentity(source: Readonly<MetricSourceRef>): string {
  return JSON.stringify([source.plugin_id, source.connection_id, source.native === true, source.datasource_uid, source.datasource_kind]);
}

/** Only public display fields enter the shared cache. Credentials and connection URLs never do. */
export async function loadMetricSourceInventory(): Promise<MetricSourceInventory> {
  const providers = await GetProviders();
  const failures: { pluginID: string; message: string }[] = [];
  const discovered = await Promise.all(providers.filter(provider => provider.supports_connections).map(async provider => {
    try {
      const connections = await GetProviderConnections(provider.plugin_id);
      return (await Promise.all(connections.map(async connection => {
        try {
          const datasources = await GetDataSources(provider.plugin_id, connection.id);
          return datasources.map(datasource => ({
            source: Object.freeze({ plugin_id: provider.plugin_id, connection_id: connection.id,
              datasource_uid: datasource.uid, datasource_kind: datasource.kind, native: false }),
            providerName: provider.name || provider.plugin_id, providerIcon: provider.icon,
            connectionName: connection.name || connection.id, datasourceName: datasource.name || datasource.uid,
            label: `${connection.name || connection.id} · ${datasource.name || datasource.uid}`,
            available: true,
          }));
        } catch {
          failures.push({ pluginID: provider.plugin_id, message: 'A connection source catalog is unavailable.' });
          return [];
        }
      }))).flat();
    } catch {
      failures.push({ pluginID: provider.plugin_id, message: 'Provider source catalog is unavailable.' });
      return [];
    }
  }));
  return { providers: providers.map(provider => ({ pluginID: provider.plugin_id, name: provider.name || provider.plugin_id, icon: provider.icon })),
    options: discovered.flat(), failures };
}

/** One resource-independent inventory shared by source selectors and provenance details. */
export function useMetricSourceInventory() {
  return useQuery({ queryKey: ['metric', 'source-inventory'], queryFn: loadMetricSourceInventory,
    staleTime: 30_000, retry: false });
}
export function presentMetricSource(source: Readonly<MetricSourceRef> | null | undefined,
  inventory: MetricSourceInventory | undefined): MetricSourcePresentation | null {
  if (!source) return null;
  const match = inventory?.options.find(option => metricSourceIdentity(option.source) === metricSourceIdentity(source));
  if (match) return match;
  const provider = inventory?.providers.find(item => item.pluginID === source.plugin_id);
  const native = source.native === true;
  const connectionName = source.connection_id;
  const datasourceName = native ? 'Native' : source.datasource_uid;
  return { source, providerName: provider?.name || source.plugin_id, providerIcon: provider?.icon || '',
    connectionName, datasourceName, label: native ? `${provider?.name || source.plugin_id} · Native` : `${connectionName} · ${datasourceName}`,
    available: native && !!provider };
}
export function useMetricSourcePresentation(source: Readonly<MetricSourceRef> | null | undefined): MetricSourcePresentation | null {
  const inventory = useMetricSourceInventory();
  const owner = useMetricOwnerConnection(source?.native ? source.plugin_id : '', source?.connection_id || '');
  const presentation = presentMetricSource(source, inventory.data);
  if (!presentation || !source?.native || !owner) return presentation;
  return { ...presentation, connectionName: owner.name || source.connection_id,
    label: `${owner.name || source.connection_id} · Native` };
}

/** Bindings remain owner-scoped; callers must not infer a binding from source identity. */
export function useMetricBindings(ownerPluginID: string, ownerConnectionID: string) {
  return useQuery({ queryKey: ['metric', 'bindings', ownerPluginID, ownerConnectionID],
    queryFn: () => GetMetricBindings(ownerPluginID, ownerConnectionID),
    enabled: !!ownerPluginID && !!ownerConnectionID, staleTime: 30_000, retry: false });
}

/** Reuses the generic connection-list cache; never makes per-resource metadata requests. */
export function useMetricOwnerConnection(ownerPluginID: string, ownerConnectionID: string) {
  const connections = useQuery({ queryKey: connectionListQueryKey(ownerPluginID),
    queryFn: () => ListConnections(ownerPluginID), enabled: !!ownerPluginID,
    staleTime: 30_000, retry: false });
  return connections.data?.find(connection => connection.id === ownerConnectionID) ?? null;
}
