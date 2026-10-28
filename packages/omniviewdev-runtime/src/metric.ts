import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { MetricShape, QueryResponse } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export { GetProviders, GetProvidersForResource, HasPlugin, ListPlugins, Unsubscribe } from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';

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
