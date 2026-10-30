// Handwritten projection of plugin-sdk/pkg/resource/v2/ancillary_types.go.
import type { AccessRoute, ResourceReference, SchemaBinding, ScopeEntry, Value } from './domain';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';

/** Ancillary transport traits; finite support comes only from the qualified catalog. */
export type Feature = 'connections' | 'connectionBrowser' | 'connectionOverlay' | 'scopeValues' | 'presentation' | 'editorSchemas' | 'schemaDocuments' | 'relationships' | 'health' | 'actionCatalog' | 'streamingActions' | 'bestEffortUpdates';
export interface FeatureSet { traits: readonly Feature[] }

/** Explicit host-owned desired state, never a replay of native discovery snapshots. */
export interface ConnectionOverlay {
  upserts: readonly Connection[];
  disabledIDs: readonly string[];
}

export interface EditorSchema { type: string; fileMatch: string; uri: string; language: string; binding: SchemaBinding }
export interface ResourceGroup { id: string; name: string; description: string; icon: string; resources: readonly string[] }
export interface ResourceDefinition { columnDefs: readonly ColumnDefinition[] }
export interface ColumnDefinition {
  id: string;
  header: string;
  accessor: string;
  accessorPriority?: string;
  colorMap?: { [key: string]: string };
  color?: string;
  align?: string;
  hidden?: boolean;
  width?: number;
  formatter?: string;
  component?: string;
  componentParams?: unknown;
  resourceLink?: ResourceLink;
  valueMap?: { [key: string]: string };
}
export interface ResourceLink { type?: string; typeAccessor?: string; typeMap?: { [key: string]: string }; idAccessor: string; scopeAccessors: readonly ScopeExtractor[]; displayId: boolean }
export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
export interface SchemaProperty {
  type: SchemaType;
  description?: string;
  enum?: readonly string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  properties?: { [key: string]: SchemaProperty };
  required?: readonly string[];
}
/** Retained action schema subset, not a normalized resource schema. */
export interface Schema { properties?: { [key: string]: SchemaProperty }; required?: readonly string[] }
export type ActionScope = 'instance' | 'type';
export interface ActionDescriptor {
  id: string;
  label: string;
  description: string;
  icon: string;
  scope: ActionScope;
  streaming: boolean;
  paramsSchema?: Schema;
  outputSchema?: Schema;
  dangerous?: boolean;
}
export interface ActionEvent { type: string; data: Value; error?: ResourceOperationError }
export interface ResourceOperationError { code: string; title: string; message: string; suggestions?: readonly string[] }
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'pending' | 'unknown';
export type EventSeverity = 'normal' | 'warning' | 'error';
export interface HealthCondition { type: string; status: string; reason?: string; message?: string; lastProbeTime?: string; lastTransitionTime?: string }
export interface ResourceHealth { status: HealthStatus; reason?: string; message?: string; since?: string; conditions?: readonly HealthCondition[] }
export interface ResourceEvent { type: EventSeverity; reason: string; message: string; source?: string; count?: number; firstSeen: string; lastSeen: string }
export type RelationshipType = 'owns' | 'runs_on' | 'uses' | 'exposes' | 'manages' | 'member_of' | 'selects';
export type EdgeDirection = '' | 'incoming';
export interface RelationshipExtractor { method: string; fieldPath?: string; labelSelector?: { [key: string]: string } }
export interface ScopeExtractor { dimension: string; fieldPath: string }
export interface RelationshipDescriptor {
  type: RelationshipType;
  targetType: string;
  label: string;
  inverseLabel?: string;
  cardinality?: string;
  direction?: EdgeDirection;
  extractor?: RelationshipExtractor;
  targetScope: readonly ScopeEntry[];
  scopeExtractors: readonly ScopeExtractor[];
}
export interface RelationshipTarget { reference: ResourceReference; route: AccessRoute; displayName?: string }
export interface ResolvedRelationship { descriptor: RelationshipDescriptor; targets: readonly RelationshipTarget[] }
