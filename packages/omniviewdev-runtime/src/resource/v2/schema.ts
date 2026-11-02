// Handwritten projection of backend/pkg/resourcecatalog navigation/overlay DTOs
// and backend/pkg/plugin/resource/schema_service.go. Catalog DTO fields carry no
// JSON tags, so their wire names are the Go field names.
import type { AccessRoute, Operation, Value } from './domain';

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
  route: AccessRoute;
  type: string;
  /** Empty selects the type's default representation. */
  representation?: string;
  path: readonly PathSegment[];
}
export interface SchemaFieldsResult {
  catalogRevision: string;
  type: string;
  representation: string;
  /** Provider binding state: absent | available | unavailable. */
  schemaState: string;
  schemaRevision?: string;
  dialect?: string;
  overlay: TypeOverlay;
  fields: readonly FieldInfo[];
  truncated: boolean;
  truncationReason?: 'fields' | 'visits';
}
export type EditorSchemaStatus = 'available' | 'absent' | 'unavailable' | 'unsupported' | 'invalid' | 'limit';
export interface EditorSchemaAssociation {
  type: string;
  representation?: string;
  /** Auxiliary schema key; empty for catalog representations. */
  key?: string;
  language: string;
  /** "file:///omniview-schema/<hex16>" */
  modelDirectory: string;
  /** "**\/omniview-schema/<hex16>/*" */
  fileMatch: string;
  /** Full hex document digest; set only when status is available. */
  documentId?: string;
  /** "#/definitions/n<id>"; set only when status is available. */
  root?: string;
  status: EditorSchemaStatus;
  code?: string;
}
/** Host-rendered draft-07 editor document. */
export interface EditorSchemaDocument { documentId: string; schema: unknown }
