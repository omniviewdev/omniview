// Handwritten projection of backend/pkg/resourceauthoring/types.go. JSON names
// are the Go json tags. Generic Go names (Range, Target, Item, ...) carry an
// Authoring prefix so they never collide with the query or schema exports.
import type { AccessRoute, QueryScope } from './domain';
import type { BindingType } from './query';

/** Authoring DTO family version. */
export const AUTHORING_VERSION = 'omniview.authoring.v1';
/** The only language profile the host completes. */
export const PREDICATE_PROFILE = 'omniview.resource-predicate.v1';
/** The only offset unit on the wire: zero-based half-open UTF-8 byte offsets. */
export const UNIT_UTF8_BYTE = 'utf8-byte';

export type AuthoringUnit = typeof UNIT_UTF8_BYTE;
export type AuthoringContextKind = 'member' | 'index' | 'value' | 'operator' | 'expression' | 'none';
export type AuthoringDraftState = 'valid' | 'incomplete';
export type AuthoringRoot = 'resource' | 'parameter' | 'element' | 'implicit';
export type AuthoringItemKind =
  | 'field'
  | 'root'
  | 'parameter'
  | 'variable'
  | 'operator'
  | 'method'
  | 'macro'
  | 'function'
  | 'enumValue'
  | 'literal';
export type AuthoringArity = 'binary' | 'method' | 'state' | 'logic';
export type CompletionState = 'complete' | 'truncated';
export type CompletionTruncationReason = 'itemBudget' | 'byteBudget' | 'traversalBudget';

export interface AuthoringCursor { offset: number; unit: AuthoringUnit }
/** In an edit it addresses the request source; in Edit.selection it addresses Edit.text. */
export interface AuthoringRange { start: number; end: number; unit: AuthoringUnit }

export interface AuthoringTarget {
  route: AccessRoute;
  type: string;
  /** Empty or absent selects the type's default representation. */
  representation?: string;
  scope: QueryScope;
}

export interface CompletionRequest {
  version: string;
  requestId: string;
  documentId: string;
  documentRevision: number;
  source: string;
  cursor: AuthoringCursor;
  profile: string;
  declarations?: Record<string, BindingType>;
  target: AuthoringTarget;
  /** Expectations: what the caller last observed. Omit when unknown. */
  catalogRevision?: string;
  representationRevision?: string;
  schemaRevision?: string;
  environmentRevision?: string;
  accessGeneration?: string;
  maxSuggestions: number;
}

export interface AuthoringIdentity {
  plugin: string;
  provider: string;
  connection: string;
  type: string;
  representation: string;
  scopeKey: string;
  catalogRevision: string;
  representationRevision: string;
  schemaRevision?: string;
  environmentRevision: string;
  accessGeneration: string;
}

export interface AuthoringSchemaSummary {
  /** absent | available | unavailable. */
  state: string;
  dialect?: string;
  /** full | reduced | none. */
  validation: string;
  /** schemaChecked | dynamic | unavailable | unsupported. */
  hostEvaluation: string;
  hostEvaluationCode?: string;
}

export interface AuthoringPathSegment { kind: 'field' | 'mapValue' | 'item'; name?: string }
export interface AuthoringCondition { pointer: string; branch: number; combinator: 'anyOf' | 'oneOf' }
export interface AuthoringTypeInfo {
  /** Sorted JSON Schema type names; empty means any. */
  names: readonly string[] | null;
  format?: string;
}
export interface AuthoringAncestor {
  path: readonly AuthoringPathSegment[] | null;
  presence: string;
  nullable: string;
  applicability: string;
  conditions?: readonly AuthoringCondition[];
}
export interface AuthoringOperand {
  range: AuthoringRange;
  type?: AuthoringTypeInfo;
  checking?: string;
  presence?: string;
  nullable?: string;
  applicability?: string;
  conditions?: readonly AuthoringCondition[];
}
export interface AuthoringContext {
  kind: AuthoringContextKind;
  draft: AuthoringDraftState;
  prefix: string;
  replace: AuthoringRange;
  root?: AuthoringRoot;
  path?: readonly AuthoringPathSegment[];
  operand?: AuthoringOperand;
  ancestors?: readonly AuthoringAncestor[];
  /** "dynamic" when the operand is a map whose keys the schema does not name. */
  keys?: string;
}
/** Replaces start..end of the request source (utf8-byte) with text. */
export interface AuthoringEdit {
  start: number;
  end: number;
  unit: AuthoringUnit;
  text: string;
  /** Addresses `text`, not the source. */
  selection?: AuthoringRange;
}
export interface AuthoringItem {
  label: string;
  kind: AuthoringItemKind;
  detail?: string;
  documentation?: string;
  type?: AuthoringTypeInfo;
  checking?: string;
  presence?: string;
  nullable?: string;
  applicability?: string;
  conditions?: readonly AuthoringCondition[];
  hasChildren?: boolean;
  arity?: AuthoringArity;
  rootless?: boolean;
  edit: AuthoringEdit;
}
/** Truncated is not absence: never narrow the list locally as if complete. */
export interface CompletionCompleteness {
  kind: CompletionState;
  reason?: CompletionTruncationReason;
}
export interface CompletionResponse {
  version: string;
  requestId: string;
  documentId: string;
  documentRevision: number;
  cursor: AuthoringCursor;
  identity: AuthoringIdentity;
  schema: AuthoringSchemaSummary;
  context: AuthoringContext;
  items: readonly AuthoringItem[] | null;
  completion: CompletionCompleteness;
  maxSuggestions: number;
}
