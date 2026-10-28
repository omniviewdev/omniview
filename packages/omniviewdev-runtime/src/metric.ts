import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { QueryRequest, QueryResponse } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { Value, ResourceReference, AccessRoute } from './resource/v2/domain';
import { encodeRequestJSON } from './resource/v2/requestJSON';

export { GetProviders, GetProvidersForResource, HasPlugin, ListPlugins, Unsubscribe } from './bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';

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
export function Query(plugin: string, connectionID: string, request: QueryRequest): CancellablePromise<QueryResponse | null> {
  return Call.ByName(`${service}.Query`, plugin, connectionID, encodeRequestJSON(request, [plugin, connectionID]));
}
export function QueryAll(connectionID: string, request: QueryRequest): CancellablePromise<{ [plugin: string]: QueryResponse | null }> {
  return Call.ByName(`${service}.QueryAll`, connectionID, encodeRequestJSON(request, [connectionID]));
}
export function Subscribe(plugin: string, connectionID: string, request: SubscribeRequest): CancellablePromise<string> {
  return Call.ByName(`${service}.Subscribe`, plugin, connectionID, encodeRequestJSON(request, [plugin, connectionID]));
}
