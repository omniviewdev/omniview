import type { ExtensionPointSettings, ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { ResourceExtensionRenderContext, SidebarComponent } from '@/features/plugins/core/types';

export const RESOURCE_SIDEBAR_EXTENSION_POINT_ID = 'omniview/resource/sidebar/infopanel';

/**
 * Create the builtin resource sidebar extension point definition.
 *
 * Mode: single — at most one sidebar component matches per { pluginId, resourceKey }.
 * Matcher: structured context, no string parsing. Ownership is the host-assigned
 * `contribution.plugin`; `meta.resourceKey` is only the opaque resource type ID.
 */
export function createResourceSidebarExtensionPoint(): ExtensionPointSettings<
  ResourceExtensionRenderContext,
  SidebarComponent
> {
  return {
    id: RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'single',
    matcher: (
      contribution: ExtensionContributionRegistration<SidebarComponent>,
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
