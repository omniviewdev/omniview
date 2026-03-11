import type { ExtensionPointSettings, ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { ResourceExtensionRenderContext, SidebarComponent } from '@/features/plugins/core/types';

export const RESOURCE_SIDEBAR_EXTENSION_POINT_ID = 'omniview/resource/sidebar/infopanel';

/**
 * Create the builtin resource sidebar extension point definition.
 *
 * Mode: single — at most one sidebar component matches per { pluginId, resourceKey }.
 * Matcher: structured context, no string parsing.
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
      if (!context) return false;
      const meta = contribution.meta as { pluginId?: string; resourceKey?: string } | undefined;
      return meta?.resourceKey === context.resourceKey && meta?.pluginId === context.pluginId;
    },
    select: (contributions) => contributions[0],
  };
}
