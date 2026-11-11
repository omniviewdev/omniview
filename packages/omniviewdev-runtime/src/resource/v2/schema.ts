// Handwritten projection of backend/pkg/resourcecatalog navigation/overlay DTOs
// and backend/pkg/plugin/resource/schema_service.go. Catalog DTO fields carry no
// JSON tags, so their wire names are the Go field names.
import type { AccessRoute, Operation, SchemaRequest, SchemaTarget, Value } from './domain';

export type PathSegmentKind = 'field' | 'mapValue' | 'item';
export interface PathSegment { Kind: PathSegmentKind; Name?: string }
export interface BranchCondition { Pointer: string; Branch: number; Combinator: 'anyOf' | 'oneOf' }
export type SchemaFieldType = 'null' | 'boolean' | 'string' | 'integer' | 'number' | 'object' | 'array';
export interface FieldInfo {
  Segment: PathSegment;
  /** Empty means any. */
  Types: readonly SchemaFieldType[] | null;
  Format: string;
  Title: string;
  Description: string;
  Enum: readonly Value[] | null;
  Presence: 'required' | 'optional' | 'unknown';
  Nullable: 'yes' | 'no' | 'unknown';
  Applicability: 'unconditional' | 'conditional';
  Conditions: readonly BranchCondition[] | null;
  CELChecking: 'static' | 'partial' | 'dynamic';
  HasChildren: boolean;
  /** Always "unsupported": a schema never grants native filtering. */
  NativeFilter: 'unsupported';
}
export interface SchemaConstraint { Pointer: string; Keyword: string }
export type HostEvaluation = 'schemaChecked' | 'dynamic' | 'unavailable' | 'unsupported';
export interface TypeOverlay {
  Operations: readonly Operation[];
  NativeQueryLanguages: readonly string[];
  HostEvaluation: HostEvaluation;
  /** Error code when HostEvaluation is unavailable or unsupported. */
  HostEvaluationCode: string;
  Validation: 'full' | 'reduced' | 'none';
  Unvalidated: readonly SchemaConstraint[] | null;
}
export interface SchemaFieldsRequest {
  request: SchemaRequest;
  path: readonly PathSegment[];
}
export interface SchemaFieldsResult {
  type: string;
  target: SchemaTarget;
  observation: string;
  schemaState: string;
  schemaRevision?: string;
  dialect?: string;
  overlay: TypeOverlay;
  fields: readonly FieldInfo[];
  truncated: boolean;
  truncationReason?: string;
}
export type EditorSchemaStatus = 'available' | 'absent' | 'unavailable' | 'unsupported' | 'invalid' | 'limit';
export interface EditorSchemaResult {
  type: string;
  target: SchemaTarget;
  observation: string;
  schemaRevision?: string;
  dialect?: string;
  root?: string;
  status: EditorSchemaStatus;
  code?: string;
  document?: EditorSchemaDocument;
}
/** Host-rendered draft-07 editor document. */
export interface EditorSchemaDocument { documentId: string; schema: unknown }

/** Stable editor identity. Revisions describe enrichment or content, never a model. */
export interface ResourceEditorModelIdentity {
  pluginID: string;
  route: AccessRoute;
  type: string;
  target: SchemaTarget;
  name: string;
}

/** Encode every opaque segment, including dot-only names, without host hash coupling. */
export function resourceEditorModelURI({ pluginID, route, type, target, name }: ResourceEditorModelIdentity): string {
  const segments = [pluginID, route.connection, type];
  if (target.representation) {
    segments.push('representation', target.representation.id);
  } else {
    const { key, reference } = target.auxiliary;
    const { address, incarnation } = reference;
    segments.push('auxiliary', key, address.provider, address.authority, address.type);
    const scope = [...address.scope].sort((left, right) =>
      left.dimension < right.dimension ? -1 : left.dimension > right.dimension ? 1 : 0);
    segments.push(String(scope.length));
    for (const { dimension, value } of scope) segments.push(dimension, value);
    segments.push(address.id, incarnation === undefined ? 'unversioned' : 'incarnation');
    if (incarnation !== undefined) segments.push(incarnation);
  }
  segments.push(name);
  return `file:///omniview-editor/${segments.map(segment =>
    `v${encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`).join('/')}.yaml`;
}
