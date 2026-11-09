import type { ExtensionPointSettings, ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { ResourceExtensionRenderContext, DrawerFactory } from '@/features/plugins/core/types';

export const RESOURCE_DRAWER_EXTENSION_POINT_ID = 'omniview/resource/drawer';

/**
 * Create the builtin resource drawer extension point definition.
 *
 * Mode: single — at most one drawer factory matches per { pluginId, resourceKey }.
 * Matcher: structured context, no string parsing. Ownership is the host-assigned
 * `contribution.plugin`; `meta.resourceKey` is only the opaque resource type ID.
 */
export function createResourceDrawerExtensionPoint(): ExtensionPointSettings<
  ResourceExtensionRenderContext,
  DrawerFactory
> {
  return {
    id: RESOURCE_DRAWER_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'single',
    matcher: (
      contribution: ExtensionContributionRegistration<DrawerFactory>,
      context?: ResourceExtensionRenderContext,
    ) => {
      if (!context) {
        return false;
      }

      const meta = contribution.meta as { resourceKey?: string } | undefined;
      return contribution.plugin === context.pluginId && meta?.resourceKey === context.resourceKey;
    },
    select: (contributions) => contributions[0],
  };
}
