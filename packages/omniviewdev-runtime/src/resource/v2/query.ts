import type { AccessRoute, QueryScope, Value } from './domain';

export type QuerySpec = { version: string; targets: Target[]; predicate: Predicate; declarations: Record<string, BindingType>; bindings: Record<string, Value>; text?: TextConstraint; projection: Projection[]; order: OrderTerm[]; delivery: Delivery };
export type Target = { targetId: string; provider: string; authority: string; type: string; accessRoute: AccessRoute; representation: RepresentationSelector; scope: QueryScope };
export type RepresentationSelector = { id: string; revision: string };
export type Predicate = { language: 'cel'; profile: 'omniview.resource-predicate.v1'; source: string } | { language: 'builder'; version: 'omniview.builder.v1'; document: Builder };
export type BindingType = { kind: 'bool' | 'string' | 'int64' | 'uint64' | 'double' | 'timestamp' } | { kind: 'list'; element: BindingType } | { kind: 'map' | 'nullable'; value: BindingType };
export type PathSegment = { kind: 'member'; name: string } | { kind: 'index'; index: number };
export type DocumentFieldPath = PathSegment[];
export type TextConstraint = { term: string; fields: DocumentFieldPath[]; match: 'substring'; case: 'sensitive'; combine: 'any' };
export type Projection = { id: string; path: DocumentFieldPath };
export type OrderTerm = { path: DocumentFieldPath; direction: 'asc' | 'desc'; missing: 'first' | 'last'; null: 'first' | 'last' };
export type Delivery = { mode: 'once' | 'follow'; pageSize: number; after?: string; allowPartial?: boolean };
export type Builder = { version: 'omniview.builder.v1'; root: Node };
export type BuilderPath = { root: 'resource' | { element: string }; segments: DocumentFieldPath };
export type Operand = { kind: 'parameter'; name: string } | { kind: 'literal'; type: BindingType; value: Value };
export type Condition = { kind: 'discriminatorEquals'; path: BuilderPath; value: string | boolean };
export type Node = { kind: 'state'; path: BuilderPath; state: 'absent' | 'present' | 'null' | 'nonNull' } | { kind: 'value'; path: BuilderPath; op: 'equal' | 'notEqualPresent'; operand: Operand; when?: Condition[] } | { kind: 'all' | 'any'; children: Node[] } | { kind: 'not'; child: Node } | { kind: 'exists'; path: BuilderPath; element: string; child: Node; when?: Condition[] };
