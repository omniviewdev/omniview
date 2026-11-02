import type { ExtensionContributionRegistration } from '../types/extensions';
import type { ResourceEditorContext, ResourceEditorContribution, ResourceEditorPath } from '../types/resource-editor';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const path = (v: unknown): v is ResourceEditorPath => Array.isArray(v) && v.length > 0 && v.every(s =>
  (typeof s === 'string' && s.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(s)) ||
  (typeof s === 'number' && Number.isSafeInteger(s) && s >= 0));
const paths = (v: unknown): boolean => Array.isArray(v) && v.every(path);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

/** Returns a safe diagnostic, never contributor source or field values. */
export function validateResourceEditorContribution(value: unknown): string | null {
  if (!record(value) || value.contractVersion !== 1) return 'Unsupported resource editor contract.';
  if (!text(value.label) || !Array.isArray(value.targets) || value.targets.length === 0) return 'Resource editor requires exact targets and a label.';
  const seen = new Set<string>();
  for (const target of value.targets) {
    if (!record(target) || typeof target.group !== 'string' || !text(target.version) || !text(target.kind) ||
      !(text(target.resource) || (target.resource === '' && Array.isArray(value.intents) &&
        ((value.intents.every(i => i === 'inspect') && Array.isArray(value.ownedPaths) && value.ownedPaths.length === 0) ||
          (record(value.request) && text(value.request.protocol) && value.intents.every(i => i === 'action' || i === 'inspect'))))) ||
      !['Namespaced', 'Cluster'].includes(String(target.scope)) ||
      [target.group, target.version, target.kind, target.resource].some(v => String(v).includes('*'))) return 'Resource editor target must be exact.';
    const key = JSON.stringify([target.group, target.version, target.kind, target.resource, target.scope]);
    if (seen.has(key)) return 'Duplicate resource editor target.';
    seen.add(key);
  }
  if (!Array.isArray(value.intents) || value.intents.length === 0 || value.intents.some(i => !['create', 'edit', 'inspect', 'action'].includes(i)) ||
    new Set(value.intents).size !== value.intents.length) return 'Invalid resource editor intents.';
  if (!Array.isArray(value.sections) || value.sections.length === 0 || value.sections.some(s => !record(s) || !text(s.id) || !text(s.label)) ||
    new Set(value.sections.map(s => s.id)).size !== value.sections.length) return 'Invalid resource editor sections.';
  if (!paths(value.ownedPaths) || (value.sensitivePaths !== undefined && !paths(value.sensitivePaths))) return 'Invalid resource editor paths.';
  if (value.ownershipPolicy !== undefined && !['declarative', 'conditional', 'controller', 'system'].includes(String(value.ownershipPolicy))) {
    return 'Invalid resource editor ownership policy.';
  }
  if (typeof value.component !== 'function' && !(record(value.component) && typeof value.component.$$typeof === 'symbol')) return 'Invalid resource editor component.';
  for (const key of ['validate', 'validateSubmission', 'formUnavailable', 'readOnly']) {
    if (value[key] !== undefined && typeof value[key] !== 'function') return 'Invalid resource editor callback.';
  }
  if (value.request !== undefined) {
    const request = value.request;
    if (!record(request) || !text(request.protocol)) return 'Invalid resource editor request.';
    if (request.source === 'canonical') {
      if (request.buildInput !== undefined || ![
        'kubernetes.review.v1',
        'kubernetes.service-account-token.v1',
        'kubernetes.csr-approval.v1',
        'kubernetes.pod-eviction.v1',
        'kubernetes.scale.v1',
      ].includes(request.protocol)) return 'Unsupported canonical resource editor request.';
    } else if ((request.source !== undefined && request.source !== 'projection') || typeof request.buildInput !== 'function') {
      return 'Invalid resource editor projection request.';
    }
  }
  if (value.requirements !== undefined) {
    const r = value.requirements;
    if (!record(r)) return 'Invalid resource editor requirements.';
    if (r.capabilities !== undefined && (!strings(r.capabilities) || r.capabilities.some(c => !['create', 'update', 'delete', 'list', 'get'].includes(c)))) return 'Invalid resource editor capabilities.';
    if ((r.actions !== undefined && !strings(r.actions)) || (r.features !== undefined && !strings(r.features))) return 'Invalid resource editor requirements.';
    if (r.schema !== undefined && (!record(r.schema) || (r.schema.identity !== undefined && !text(r.schema.identity)) || (r.schema.paths !== undefined && !paths(r.schema.paths)))) return 'Invalid resource editor schema requirements.';
  }
  return null;
}

/** Segment matching avoids granting specFoo when a provider owns spec. */
export function resourceEditorPathContains(owner: ResourceEditorPath, candidate: ResourceEditorPath): boolean {
  return owner.length <= candidate.length && owner.every((segment, index) => segment === candidate[index]);
}

/** Pure matcher; host-validated local captures permit inspection, never mutation. */
export function matchesResourceEditor(contribution: ResourceEditorContribution, context: ResourceEditorContext): boolean {
  const localInspection = context.intent === 'inspect' &&
    (context.discovery.status === 'unknown' || context.discovery.status === 'absent') &&
    context.discovery.features['host.local-capture'] === 'available';
  if ((context.discovery.status !== 'available' && !localInspection) || !contribution.intents.includes(context.intent)) return false;
  if (!contribution.targets.some(t => t.group === context.group && t.version === context.version && t.kind === context.kind && t.resource === context.resource && t.scope === context.scope)) return false;
  const r = contribution.requirements;
  if (r?.capabilities?.some(c => context.capabilities[c] !== 'available')) return false;
  if (r?.actions?.some(a => context.capabilities.actions[a] !== 'available')) return false;
  if (r?.features?.some(f => context.discovery.features[f] !== 'available')) return false;
  if (r?.schema) {
    if (context.schema.status !== 'available' || (r.schema.identity !== undefined && r.schema.identity !== context.schema.identity)) return false;
    if (r.schema.paths?.some(p => !context.schema.paths?.some(s => p.length === s.length && resourceEditorPathContains(s, p)))) return false;
  }
  return true;
}

export type ResourceEditorSelection =
  | { status: 'selected'; contribution: ExtensionContributionRegistration<ResourceEditorContribution> }
  | { status: 'choose'; contributions: readonly ExtensionContributionRegistration<ResourceEditorContribution>[] }
  | { status: 'fallback' };

/** IDs and built-in ownership come from the host, never descriptor metadata. */
export function selectResourceEditor(
  contributions: readonly ExtensionContributionRegistration<ResourceEditorContribution>[],
  context: ResourceEditorContext,
  options: { preferredID?: string; builtinPluginID: string },
): ResourceEditorSelection {
  const compatible = contributions.filter(c => matchesResourceEditor(c.value, context));
  const preferred = compatible.find(c => c.id === options.preferredID);
  if (preferred) return { status: 'selected', contribution: preferred };
  const builtins = compatible.filter(c => c.plugin === options.builtinPluginID);
  if (builtins.length === 1) return { status: 'selected', contribution: builtins[0]! };
  if (compatible.length === 1) return { status: 'selected', contribution: compatible[0]! };
  return compatible.length ? { status: 'choose', contributions: compatible } : { status: 'fallback' };
}
