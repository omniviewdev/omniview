import { Call, type CancellablePromise } from '@wailsio/runtime';
import type { AccessRoute, ActionRequest, Catalog as CatalogResult, CatalogRequest, GetRequest, MutationRequest, ReadTarget, Record, SchemaDocument, SchemaDocumentReference, Value } from './domain';
import type { ActionDescriptor, EditorSchema, FeatureSet, RelationshipDescriptor, ResolvedRelationship, ResourceDefinition, ResourceEvent, ResourceGroup, ResourceHealth } from './ancillary';
import type { AppError } from '../../errors/types';
import type { WatchConnectionSummary } from '../../types/watch';
import type { ConnectionProfile, ConnectionProfileResult, HostConnectionState, HostEnumerateRequest, HostGetRequest, HostNativeQueryRequest, HostRecord, HostSourcePage, HostSubscriptionRequest, ResolvedResourceReference, ResolvedResourceTarget, ResolveReferenceRequest, ResolveTargetRequest } from './host';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { encodeRequestJSON } from './requestJSON';
import type { ConnectionMetadataEnvelope } from '../../connection/metadata';

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ServiceWrapper';
function invoke<T>(method: string, ...args: unknown[]): CancellablePromise<T> {
  return Call.ByName(`${service}.${method}`, ...args);
}

export const Features = (pluginID: string) => invoke<FeatureSet>('Features', pluginID);
export const GetConnectionMetadata = (pluginID: string, connectionID: string) => invoke<ConnectionMetadataEnvelope>('GetConnectionMetadata', pluginID, connectionID);
export const RefreshConnectionMetadata = (pluginID: string, connectionID: string) => invoke<ConnectionMetadataEnvelope>('RefreshConnectionMetadata', pluginID, connectionID);
export const Catalog = (pluginID: string, request: CatalogRequest) => invoke<CatalogResult>('Catalog', pluginID, request);
export const Get = (pluginID: string, request: HostGetRequest) => invoke<HostRecord>('Get', pluginID, request);
export const Enumerate = (pluginID: string, request: HostEnumerateRequest) => invoke<HostSourcePage>('Enumerate', pluginID, request);
export const NativeQuery = (pluginID: string, request: HostNativeQueryRequest) => invoke<HostSourcePage>('NativeQuery', pluginID, encodeRequestJSON(request, [pluginID]));
export const Mutate = (pluginID: string, request: MutationRequest) => invoke<Record>('Mutate', pluginID, encodeRequestJSON(request, [pluginID]));
export const Action = (pluginID: string, request: ActionRequest) => invoke<Value>('Action', pluginID, encodeRequestJSON(request, [pluginID]));
export const ResolveTarget = (pluginID: string, request: ResolveTargetRequest) => invoke<ResolvedResourceTarget>('ResolveTarget', pluginID, request);
export const ResolveReference = (pluginID: string, request: ResolveReferenceRequest) => invoke<ResolvedResourceReference>('ResolveReference', pluginID, request);
export const GetSchemaDocument = (pluginID: string, route: AccessRoute, reference: SchemaDocumentReference) => invoke<SchemaDocument>('GetSchemaDocument', pluginID, route, reference);
export const GetAllConnectionStates = () => invoke<{ [pluginID: string]: HostConnectionState[] }>('GetAllConnectionStates');
export const ListConnectionProfiles = (pluginID: string) => invoke<ConnectionProfile[]>('ListConnectionProfiles', pluginID);
export const SaveConnectionProfile = (pluginID: string, connection: Connection) => invoke<ConnectionProfileResult>('SaveConnectionProfile', pluginID, connection);
export const ImportConnectionProfile = (pluginID: string, id: string) => invoke<ConnectionProfileResult>('ImportConnectionProfile', pluginID, id);
export const ResetConnectionProfile = (pluginID: string, id: string) => invoke<ConnectionProfileResult>('ResetConnectionProfile', pluginID, id);
export const RemoveConnection = (pluginID: string, id: string) => invoke<void>('RemoveConnection', pluginID, id);
export const GetResourceGroups = (pluginID: string, route: AccessRoute) => invoke<ResourceGroup[]>('GetResourceGroups', pluginID, route);
export const GetResourceDefinition = (pluginID: string, route: AccessRoute, type: string) => invoke<ResourceDefinition>('GetResourceDefinition', pluginID, route, type);
export const GetEditorSchemas = (pluginID: string, route: AccessRoute) => invoke<EditorSchema[]>('GetEditorSchemas', pluginID, route);
export const GetRelationships = (pluginID: string, route: AccessRoute, type: string) => invoke<RelationshipDescriptor[]>('GetRelationships', pluginID, route, type);
export const ResolveRelationships = (pluginID: string, request: GetRequest) => invoke<ResolvedRelationship[]>('ResolveRelationships', pluginID, request);
export const GetHealth = (pluginID: string, request: GetRequest, body: Value) => invoke<ResourceHealth | null>('GetHealth', pluginID, encodeRequestJSON({ request, body }, [pluginID]));
export const GetResourceEvents = (pluginID: string, request: GetRequest, limit: number) => invoke<ResourceEvent[]>('GetResourceEvents', pluginID, request, limit);
export const GetActions = (pluginID: string, route: AccessRoute, type: string) => invoke<ActionDescriptor[]>('GetActions', pluginID, route, type);
export const StreamAction = (pluginID: string, request: ActionRequest) => invoke<string>('StreamAction', pluginID, encodeRequestJSON(request, [pluginID]));
export interface ActionEventDTO { type: string; data?: Value; error?: AppError }
export interface ActionSnapshot { sequence: number; event: ActionEventDTO; terminal: boolean }
export const AttachStreamAction = (handleID: string) => invoke<ActionSnapshot>('AttachStreamAction', handleID);
export const CancelStreamAction = (handleID: string) => invoke<void>('CancelStreamAction', handleID);

export const StartConnectionWatch = (pluginID: string, targets: readonly ReadTarget[]) => invoke<void>('StartConnectionWatch', pluginID, targets);
export const StopConnectionWatch = (pluginID: string, route: AccessRoute) => invoke<void>('StopConnectionWatch', pluginID, route);
export const GetWatchState = (pluginID: string, route: AccessRoute) => invoke<WatchConnectionSummary | null>('GetWatchState', pluginID, route);
export const EnsureResourceWatch = (pluginID: string, target: ReadTarget) => invoke<void>('EnsureResourceWatch', pluginID, target);
export const StopResourceWatch = (pluginID: string, route: AccessRoute, type: string) => invoke<void>('StopResourceWatch', pluginID, route, type);
export const RestartResourceWatch = (pluginID: string, target: ReadTarget) => invoke<void>('RestartResourceWatch', pluginID, target);
export const IsResourceWatchRunning = (pluginID: string, route: AccessRoute, type: string) => invoke<boolean>('IsResourceWatchRunning', pluginID, route, type);
export const SubscribeResource = (pluginID: string, request: HostSubscriptionRequest) => invoke<void>('SubscribeResource', pluginID, request);
export const UnsubscribeResource = (pluginID: string, request: HostSubscriptionRequest) => invoke<void>('UnsubscribeResource', pluginID, request);
export const ScopeValues = (pluginID: string, route: AccessRoute, dimension: string) => invoke<string[]>('ScopeValues', pluginID, route, dimension);

// Connection lifecycle remains independent of the resource domain.
export {
  CheckConnection, GetConnection,
  ListAllConnections, ListConnections, ListPlugins, LoadConnections,
  StartConnection, StopConnection,
  HasPlugin,
} from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
