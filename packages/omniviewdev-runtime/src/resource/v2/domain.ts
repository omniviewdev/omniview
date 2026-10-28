// Handwritten projection of plugin-sdk/pkg/resource/v2/domain.go.
// Generated bindings are transport details, not public resource domain types.

export interface ScopeEntry { dimension: string; value: string }
export interface ResourceAddress {
  provider: string;
  authority: string;
  type: string;
  scope: readonly ScopeEntry[];
  id: string;
}
export interface AccessRoute { connection: string }
export interface ResourceReference { address: ResourceAddress; incarnation?: string }
export type ScopeConstraint =
  | { dimension: string; match: 'any' }
  | { dimension: string; match: 'oneOf'; values: readonly string[] };
export type QueryScope = readonly ScopeConstraint[];

/** Exact scalar intent survives transport. Integers never pass through JS number. */
export type Value =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'int64'; value: string }
  | { kind: 'uint64'; value: string }
  | { kind: 'double'; value: number }
  | { kind: 'timestamp'; value: string }
  | { kind: 'list'; value: readonly Value[] }
  | { kind: 'map'; value: { readonly [key: string]: Value } };

export interface SchemaBinding {
  state: string;
  revision?: string;
  dialect?: string;
  root?: string;
  documentRef?: SchemaDocumentReference;
  document?: unknown;
  validation: string;
  unvalidated: readonly string[];
}
export interface SchemaDocumentReference { id: string; revision: string }
export interface SchemaDocument { reference: SchemaDocumentReference; dialect: string; document: unknown }
export interface Representation { id: string; revision: string; schema: SchemaBinding }
export interface Dimension { name: string; allowEmpty: boolean }
export type Operation = 'enumerate' | 'get' | 'nativeQuery' | 'update' | 'mutation' | 'action';
export interface Capability { operation: Operation; scope: QueryScope; guarantee?: string }
export interface ResourceType {
  type: string;
  displayName: string;
  identityDimensions: readonly Dimension[];
  queryDimensions: readonly Dimension[];
  representations: readonly Representation[];
  defaultRepresentation?: string;
  capabilities: readonly Capability[];
  nativeAuthorityHint?: NativeAuthorityHint;
}
export interface CatalogRequest { route: AccessRoute }
/** Provider metadata never grants authority or permission to share identity. */
export interface NativeAuthorityHint { scheme: string; id: string; continuity: 'connectionLocal' | 'stableNative' }
export interface Catalog {
  provider: string;
  types: readonly ResourceType[];
  revision: string;
  coverage: Coverage;
}
export interface ReadTarget {
  route: AccessRoute;
  provider: string;
  authority: string;
  type: string;
  scope: QueryScope;
  representation: string;
}
export interface GetRequest { route: AccessRoute; reference: ResourceReference; representation: string }
export interface EnumerateRequest { target: ReadTarget; pageSize: number; cursor?: string }
export interface NativeQueryRequest {
  target: ReadTarget;
  language: string;
  query: Value;
  pageSize: number;
  cursor?: string;
}
export interface Coverage { kind: string; paths: readonly string[]; reason?: string }
export interface Count { kind: string; value?: string }
export interface Record {
  reference: ResourceReference;
  body: Value;
  representation: Representation;
  coverage: Coverage;
  sourceRevision?: string;
}
/** Bounded native acquisition page. Its cursor is not a host query cursor. */
export interface SourcePage {
  records: readonly Record[];
  nextCursor?: string;
  count: Count;
  coverage: Coverage;
  consistency: string;
  sourceRevision?: string;
}
export interface MutationRequest {
  route: AccessRoute;
  reference: ResourceReference;
  operation: string;
  input: Value;
  expectedRevision?: string;
}
export interface ActionRequest {
  route: AccessRoute;
  reference: ResourceReference;
  action: string;
  input: Value;
}
