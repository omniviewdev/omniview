import type { ComponentType } from 'react';

export const RESOURCE_EDITOR_EXTENSION_POINT = 'kubernetes/resource/editor/v1' as const;
export type ResourceEditorPath = readonly (string | number)[];
export type ResourceEditorIntent = 'create' | 'edit' | 'inspect' | 'action';
export type ResourceEditorAvailability = 'available' | 'denied' | 'unavailable' | 'absent' | 'unknown';
export interface ResourceEditorTarget {
  group: string;
  version: string;
  kind: string;
  resource: string;
  scope: 'Namespaced' | 'Cluster';
}
export interface ResourceEditorCapabilities {
  create: ResourceEditorAvailability;
  update: ResourceEditorAvailability;
  delete: ResourceEditorAvailability;
  list: ResourceEditorAvailability;
  get: ResourceEditorAvailability;
  actions: Readonly<Record<string, ResourceEditorAvailability>>;
}
export interface ResourceEditorContext extends ResourceEditorTarget {
  connectionID: string;
  namespace?: string;
  /** Trusted host policy only. Omission means unknown, never application-owned. */
  ownership?: { status: 'application' | 'controller' | 'system' | 'unknown' };
  name?: string;
  uid?: string;
  resourceVersion?: string;
  intent: ResourceEditorIntent;
  capabilities: ResourceEditorCapabilities;
  discovery: { status: ResourceEditorAvailability; features: Readonly<Record<string, ResourceEditorAvailability>> };
  schema: { status: ResourceEditorAvailability; identity?: string; paths?: readonly ResourceEditorPath[] };
}
/** Host-owned immutable, redacted projection. Never persist drafts or opaque values. */
export interface ResourceEditorDraft {
  readonly sessionID: string;
  readonly revision: number;
  get(path: ResourceEditorPath): unknown;
  has(path: ResourceEditorPath): boolean;
}
export type ResourceEditorPatch =
  | { op: 'set'; path: ResourceEditorPath; value: unknown }
  | { op: 'remove'; path: ResourceEditorPath }
  | { op: 'insert'; path: ResourceEditorPath; index: number; value: unknown };
export interface ResourceEditorPatchRequest {
  sessionID: string;
  expectedRevision: number;
  operations: readonly ResourceEditorPatch[];
}
export type ResourceEditorPatchResult =
  | { status: 'accepted'; revision: number }
  | { status: 'stale' | 'forbidden' | 'immutable' | 'unsafe' | 'invalid'; message: string };
export interface ResourceEditorFieldIssue {
  path: ResourceEditorPath;
  message: string;
}
export type ResourceEditorReferenceProjection = 'metadata' | 'servicePorts' | 'storageClass' | 'ingressClass' | 'secretType';
export interface ResourceEditorServiceRequest {
  sessionID: string;
  generation: number;
  signal: AbortSignal;
}
export interface ResourceEditorReferenceRequest extends ResourceEditorServiceRequest {
  group: string;
  version: string;
  resource: string;
  namespace?: string;
  projection?: ResourceEditorReferenceProjection;
}
/** Sanitized reference only; secret data and arbitrary resource bodies are never returned. */
export interface ResourceEditorReference {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Readonly<Record<string, string>>;
  servicePorts?: readonly { name?: string; port: number; protocol?: string; targetPort?: string | number }[];
  /** Sanitized selector presence; omission must be treated as unknown. */
  serviceSelector?: 'none' | 'present' | 'unknown';
  storageClass?: { provisioner: string; volumeBindingMode?: string; allowVolumeExpansion?: boolean };
  ingressClass?: { controller: string; isDefault?: boolean };
  secretType?: string;
}
export type ResourceEditorReferenceResult =
  | { status: 'ready'; items: readonly ResourceEditorReference[] }
  | { status: 'denied' | 'unavailable' | 'absent'; message: string };
export interface ResourceEditorReferenceService {
  list(request: ResourceEditorReferenceRequest): Promise<ResourceEditorReferenceResult>;
}
export interface ResourceEditorActionRequest extends ResourceEditorServiceRequest {
  protocol: string;
  input: unknown;
}
export type ResourceEditorActionResult =
  | { status: 'ready'; output: unknown; sensitive?: boolean }
  | { status: 'denied' | 'unavailable' | 'absent' | 'invalid' | 'cancelled'; message: string };
export interface ResourceEditorActionService {
  execute(request: ResourceEditorActionRequest): Promise<ResourceEditorActionResult>;
}
export interface ResourceEditorFormProps {
  context: ResourceEditorContext;
  draft: ResourceEditorDraft;
  baseline?: ResourceEditorDraft;
  section: string;
  disabled: boolean;
  patch(request: ResourceEditorPatchRequest): ResourceEditorPatchResult;
  onValidityChange(error: string | null): void;
  references: ResourceEditorReferenceService;
  actions: ResourceEditorActionService;
  requestResult?: ResourceEditorActionResult;
}
export interface ResourceEditorRequirements {
  capabilities?: readonly (keyof Omit<ResourceEditorCapabilities, 'actions'>)[];
  actions?: readonly string[];
  features?: readonly string[];
  schema?: { identity?: string; paths?: readonly ResourceEditorPath[] };
}
export interface ResourceEditorContribution {
  contractVersion: 1;
  targets: readonly ResourceEditorTarget[];
  intents: readonly ResourceEditorIntent[];
  label: string;
  sections: readonly { id: string; label: string }[];
  ownedPaths: readonly ResourceEditorPath[];
  sensitivePaths?: readonly ResourceEditorPath[];
  requirements?: ResourceEditorRequirements;
  /** Domain authoring policy, never RBAC authority; omission means unknown. */
  ownershipPolicy?: 'declarative' | 'conditional' | 'controller' | 'system';
  component: ComponentType<ResourceEditorFormProps>;
  validate?: (draft: ResourceEditorDraft, context: ResourceEditorContext) => readonly ResourceEditorFieldIssue[];
  /** Read-only admission at submit, never enumeration; draft remains redacted. */
  validateSubmission?: (
    draft: ResourceEditorDraft,
    context: ResourceEditorContext,
    services: { references: ResourceEditorReferenceService; actions: ResourceEditorActionService },
    signal: AbortSignal,
  ) => Promise<readonly ResourceEditorFieldIssue[]>;
  formUnavailable?: (draft: ResourceEditorDraft, context: ResourceEditorContext) => string | null;
  readOnly?: (draft: ResourceEditorDraft, context: ResourceEditorContext) => boolean;
  request?:
    | { protocol: string; source: 'canonical' }
    | {
        protocol: string;
        source?: 'projection';
        /** Always receives the redacted projection, never canonical sensitive source. */
        buildInput: (draft: ResourceEditorDraft, context: ResourceEditorContext) => unknown;
      };
}
