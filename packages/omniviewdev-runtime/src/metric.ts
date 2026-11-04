import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { MetricShape, QueryResponse } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';
import type {
  ResourceSetQueryResponse, MetricBinding, MetricDefinition, MetricSourceReference,
  ProviderConnection, MetricDataSource, MetricValidationResult, MetricDiscoveryResult,
} from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';

export { GetProviders, GetProvidersForResource, HasPlugin, ListPlugins, Unsubscribe } from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';

/** Encoded request-only SDK shapes are not emitted by Wails' reachable-model generator. */
export interface MetricResource {
  token: string;
  resource_key: string;
  resource_id: string;
  resource_namespace: string;
  reference?: ResourceReference;
  route?: AccessRoute;
  public_data?: Value;
}

/** SDK finite-set wire request. Times use RFC 3339; step uses nanoseconds. */
export interface ResourceSetQueryRequest {
  resource_plugin_id: string;
  resource_connection_id: string;
  binding_id: string;
  source: MetricSourceReference;
  resources: MetricResource[];
  metric_ids: string[];
  definitions: MetricDefinition[];
  public_scope: Record<string, string>;
  shape: MetricShape;
  start_time: string;
  end_time: string;
  step: number;
  mapping_revision: string;
}

/** Credential is write-only; omission preserves the saved backend secret. */
export interface ProviderConnectionInput {
  connection: ProviderConnection;
  credential?: string;
}

/** Bounded exact-match discovery. Source is overwritten by the host's routed IDs. */
export interface MetricDiscoveryRequest {
  source: MetricSourceReference;
  metric_name: string;
  label_name: string;
  matchers: Record<string, string>;
  start_time: string;
  end_time: string;
  limit: number;
}

/** SDK query metadata plus the canonical, optional resource target. Times are RFC 3339; step is nanoseconds. */
export interface MetricQueryRequest {
  resource_key: string;
  resource_id: string;
  resource_namespace: string;
  resource_data?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  metric_ids: string[];
  shape: MetricShape;
  start_time: string;
  end_time: string;
  step: number;
  params?: Record<string, string>;
}

export interface SubscribeRequest {
  resource_key: string;
  resource_id: string;
  resource_namespace: string;
  resource_data?: Value;
  reference?: ResourceReference;
  route?: AccessRoute;
  metric_ids: string[];
  interval: number;
  params?: Record<string, string>;
}

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/metric.ServiceWrapper';
export function Query(plugin: string, connectionID: string, request: MetricQueryRequest): CancellablePromise<QueryResponse | null> {
  return Call.ByName(`${service}.Query`, plugin, connectionID, encodeRequestJSON(request, [plugin, connectionID]));
}
export function QueryAll(connectionID: string, request: MetricQueryRequest): CancellablePromise<{ [plugin: string]: QueryResponse | null }> {
  return Call.ByName(`${service}.QueryAll`, connectionID, encodeRequestJSON(request, [connectionID]));
}
export function Subscribe(plugin: string, connectionID: string, request: SubscribeRequest): CancellablePromise<string> {
  return Call.ByName(`${service}.Subscribe`, plugin, connectionID, encodeRequestJSON(request, [plugin, connectionID]));
}

/**
 * Resource owner fields remain independent of the selected provider source.
 * An empty binding_id resolves the saved binding; "native" explicitly selects native metrics.
 * Normal queries never use caller-supplied definitions or source to bypass saved policy.
 */
export function QueryResources(request: ResourceSetQueryRequest): CancellablePromise<ResourceSetQueryResponse | null> {
  return Call.ByName(`${service}.QueryResources`, encodeRequestJSON(request));
}
export function GetMetricBindings(pluginID: string, connectionID: string): CancellablePromise<MetricBinding[]> {
  return Call.ByName(`${service}.GetMetricBindings`, pluginID, connectionID);
}
export function SaveMetricBinding(request: MetricBinding): CancellablePromise<MetricBinding> {
  return Call.ByName(`${service}.SaveMetricBinding`, encodeRequestJSON(request));
}
export function DeleteMetricBinding(pluginID: string, connectionID: string, bindingID: string): CancellablePromise<void> {
  return Call.ByName(`${service}.DeleteMetricBinding`, pluginID, connectionID, bindingID);
}
export function GetMetricDefinitions(): CancellablePromise<MetricDefinition[]> {
  return Call.ByName(`${service}.GetMetricDefinitions`);
}
export function SaveMetricDefinition(request: MetricDefinition): CancellablePromise<MetricDefinition> {
  return Call.ByName(`${service}.SaveMetricDefinition`, encodeRequestJSON(request));
}
export function DeleteMetricDefinition(id: string): CancellablePromise<void> {
  return Call.ByName(`${service}.DeleteMetricDefinition`, id);
}
export function GetProviderConnections(pluginID: string): CancellablePromise<ProviderConnection[]> {
  return Call.ByName(`${service}.GetProviderConnections`, pluginID);
}
export function SaveProviderConnection(pluginID: string, request: ProviderConnectionInput): CancellablePromise<ProviderConnection> {
  return Call.ByName(`${service}.SaveProviderConnection`, pluginID, encodeRequestJSON(request, [pluginID]));
}
export function DeleteProviderConnection(pluginID: string, id: string): CancellablePromise<void> {
  return Call.ByName(`${service}.DeleteProviderConnection`, pluginID, id);
}
export function GetDataSources(pluginID: string, connectionID: string): CancellablePromise<MetricDataSource[]> {
  return Call.ByName(`${service}.GetDataSources`, pluginID, connectionID);
}
export function TestProviderConnection(pluginID: string, connectionID: string): CancellablePromise<MetricValidationResult> {
  return Call.ByName(`${service}.TestProviderConnection`, pluginID, connectionID);
}
export function ValidateMetricDefinition(pluginID: string, connectionID: string, datasourceUID: string, request: MetricDefinition): CancellablePromise<MetricValidationResult> {
  return Call.ByName(`${service}.ValidateMetricDefinition`, pluginID, connectionID, datasourceUID, encodeRequestJSON(request, [pluginID, connectionID, datasourceUID]));
}

/** Runs one draft definition against an explicit, host-admitted resource sample. */
export function PreviewMetricDefinition(request: ResourceSetQueryRequest): CancellablePromise<ResourceSetQueryResponse | null> {
  return Call.ByName(`${service}.PreviewMetricDefinition`, encodeRequestJSON(request));
}
export function DiscoverMetricLabels(pluginID: string, connectionID: string, datasourceUID: string, request: MetricDiscoveryRequest): CancellablePromise<MetricDiscoveryResult> {
  return Call.ByName(`${service}.DiscoverMetricLabels`, pluginID, connectionID, datasourceUID, encodeRequestJSON(request, [pluginID, connectionID, datasourceUID]));
}
