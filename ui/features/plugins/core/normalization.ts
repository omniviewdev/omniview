import type {
  ValidatedExports,
  NormalizedContribution,
  SidebarComponent,
  DrawerFactory,
  ExtensionRegistration,
  DeclaredDependencies,
} from './types';

// Re-export from canonical source for backwards compatibility with existing imports.
export { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '@/features/extensions/sidebar/extensionPoint';
export { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '@/features/extensions/drawer/extensionPoint';

import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '@/features/extensions/sidebar/extensionPoint';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '@/features/extensions/drawer/extensionPoint';

/**
 * Normalize a single generic extension registration into a NormalizedContribution.
 *
 * The contributionId is stable: `${pluginId}/${registration.id}`
 */
export function normalizeExtensionRegistration(
  pluginId: string,
  registration: ExtensionRegistration<any>,
): NormalizedContribution {
  const reg = registration.registration as Record<string, any>;
  return {
    source: 'extension-registration',
    pluginId,
    extensionPointId: registration.extensionPointId,
    contributionId: `${pluginId}/${reg.id}`,
    value: reg.value ?? reg.component,
    label: reg.label,
    meta: reg.meta,
  };
}

/**
 * Normalize a legacy sidebar export into a NormalizedContribution targeting
 * the builtin sidebar extension point.
 *
 * The contributionId is stable: `${pluginId}/sidebar/${resourceKey}`
 */
export function normalizeLegacySidebar(
  pluginId: string,
  resourceKey: string,
  component: SidebarComponent,
): NormalizedContribution<SidebarComponent> {
  return {
    source: 'legacy-sidebar',
    pluginId,
    extensionPointId: RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
    contributionId: `${pluginId}/sidebar/${resourceKey}`,
    value: component,
    label: `${pluginId} sidebar for ${resourceKey}`,
    meta: { pluginId, resourceKey },
  };
}

/**
 * Normalize a legacy drawer export into a NormalizedContribution targeting
 * the builtin drawer extension point.
 *
 * The contributionId is stable: `${pluginId}/drawer/${resourceKey}`
 */
export function normalizeLegacyDrawer(
  pluginId: string,
  resourceKey: string,
  factory: DrawerFactory,
): NormalizedContribution<DrawerFactory> {
  return {
    source: 'legacy-drawer',
    pluginId,
    extensionPointId: RESOURCE_DRAWER_EXTENSION_POINT_ID,
    contributionId: `${pluginId}/drawer/${resourceKey}`,
    value: factory,
    label: `${pluginId} drawer for ${resourceKey}`,
    meta: { pluginId, resourceKey },
  };
}

/**
 * Normalize all contributions from validated exports into a flat array
 * of NormalizedContribution objects.
 *
 * This is the single normalization boundary — after this function,
 * the host works with one internal representation regardless of
 * whether the contribution came from `extensionRegistrations`,
 * legacy `sidebars`, or legacy `drawers`.
 *
 * @param pluginId The plugin's ID
 * @param validated The validated exports from the plugin module
 * @returns An array of normalized contributions ready for registration
 */
export function normalizeContributions(
  pluginId: string,
  validated: ValidatedExports,
): NormalizedContribution[] {
  const contributions: NormalizedContribution[] = [];

  // 1. Generic extension registrations
  for (const reg of validated.extensionRegistrations) {
    contributions.push(normalizeExtensionRegistration(pluginId, reg));
  }

  // 2. Legacy sidebars → builtin sidebar extension point
  for (const [resourceKey, component] of Object.entries(validated.sidebars)) {
    contributions.push(normalizeLegacySidebar(pluginId, resourceKey, component));
  }

  // 3. Legacy drawers → builtin drawer extension point
  for (const [resourceKey, factory] of Object.entries(validated.drawers)) {
    contributions.push(normalizeLegacyDrawer(pluginId, resourceKey, factory));
  }

  return contributions;
}

/**
 * Extract declared dependencies from the nested dependencies object
 * (i.e., rawModule.dependencies, not the full raw module).
 * Returns undefined if the input is null/undefined.
 * Validation has already ensured correct shape; arrays are shallow-cloned.
 */
export function extractDeclaredDependencies(
  raw: unknown,
): DeclaredDependencies | undefined {
  if (raw === undefined || raw === null) return undefined;
  const deps = raw as Record<string, unknown>;
  return {
    plugins: Array.isArray(deps.plugins) ? [...(deps.plugins as string[])] : [],
    extensionPoints: Array.isArray(deps.extensionPoints) ? [...(deps.extensionPoints as string[])] : [],
  };
}
