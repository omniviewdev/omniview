import type { ExtensionContributionRegistration, ExtensionPointSettings } from '../types/extensions';
import {
  RESOURCE_CELL_EXTENSION_POINT_ID,
  type ResourceCellContext,
  type ResourceCellContribution,
} from '../types/resource-cell';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const uniqueText = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.length > 0 && v.every(text) && new Set(v).size === v.length;

/** Returns a safe diagnostic, never contributor source or field values. */
export function validateResourceCellContribution(value: unknown): string | null {
  if (!record(value) || value.contractVersion !== 1) {
    return 'Unsupported resource cell contract.';
  }

  if (!text(value.name)) {
    return 'Resource cell requires the component name its columns declare.';
  }

  if (value.resourceKeys !== undefined && (!uniqueText(value.resourceKeys) || value.resourceKeys.some(key => key.includes('*')))) {
    return 'Resource cell resourceKeys must be a nonempty list of unique, exact resource type IDs.';
  }

  if (value.providers !== undefined && !uniqueText(value.providers)) {
    return 'Resource cell providers must be a nonempty list of unique plugin IDs.';
  }

  if (typeof value.component !== 'function' && !(record(value.component) && typeof value.component.$$typeof === 'symbol')) {
    return 'Invalid resource cell component.';
  }

  return null;
}

/**
 * Pure matcher. Ownership comes from the host-assigned `registration.plugin`, never from the
 * descriptor: a renderer serves its own plugin's column declarations, plus those of providers
 * it explicitly lists. Resource types are compared as opaque IDs.
 *
 * Never throws: registrations are resolved while rendering, outside any contribution boundary.
 */
export function matchesResourceCell(
  registration: ExtensionContributionRegistration<ResourceCellContribution>,
  context: ResourceCellContext,
): boolean {
  const { value } = registration;
  if (!record(value) || value.name !== context.component) {
    return false;
  }

  const owned = registration.plugin === context.pluginId
    || (Array.isArray(value.providers) && value.providers.includes(context.pluginId));
  if (!owned) {
    return false;
  }

  return !Array.isArray(value.resourceKeys) || value.resourceKeys.includes(context.resourceKey);
}

export type ResourceCellResolution =
  | { status: 'resolved'; registration: ExtensionContributionRegistration<ResourceCellContribution> }
  | { status: 'ambiguous'; registrations: readonly ExtensionContributionRegistration<ResourceCellContribution>[] }
  | { status: 'missing' };

/**
 * Selects the single renderer for a column declaration. The provider's own contributions win
 * over opted-in foreign ones, and an exact resource type wins over a type-agnostic renderer.
 * Equally specific candidates are ambiguous: the host never picks one by registration order.
 */
export function resolveResourceCell(
  registrations: readonly ExtensionContributionRegistration<ResourceCellContribution>[],
  context: ResourceCellContext,
): ResourceCellResolution {
  const matched = registrations.filter(registration => matchesResourceCell(registration, context));
  if (matched.length === 0) {
    return { status: 'missing' };
  }

  const rank = (registration: ExtensionContributionRegistration<ResourceCellContribution>) =>
    (registration.plugin === context.pluginId ? 0 : 2) + (Array.isArray(registration.value.resourceKeys) ? 0 : 1);
  const best = Math.min(...matched.map(rank));
  const candidates = matched.filter(registration => rank(registration) === best);
  return candidates.length === 1
    ? { status: 'resolved', registration: candidates[0]! }
    : { status: 'ambiguous', registrations: candidates };
}

/** The core-owned definition the host registers at `RESOURCE_CELL_EXTENSION_POINT_ID`. */
export function createResourceCellExtensionPoint(): ExtensionPointSettings<ResourceCellContext, ResourceCellContribution> {
  return {
    id: RESOURCE_CELL_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'multiple',
    matcher: (registration, context) => context !== undefined && matchesResourceCell(registration, context),
  };
}
