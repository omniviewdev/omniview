import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { DrawerFactory, SidebarComponent } from '@/features/plugins/core/types';

/**
 * The plugin contributions an open drawer was built from. A drawer built only from host code
 * (the generic linked-resource drawer without a plugin sidebar, or a component a caller passed
 * straight to `openDrawer`) has none, so the registry never retires it.
 */
export type DrawerSources = {
  /** The plugin drawer factory that produced the drawer's views and actions. */
  readonly drawer?: ExtensionContributionRegistration<DrawerFactory>;
  /** The plugin sidebar the host's linked-resource drawer renders as its overview. */
  readonly sidebar?: ExtensionContributionRegistration<SidebarComponent>;
};

/**
 * The contribution an open drawer was built from that the registry no longer holds, or
 * `undefined` while every source is live. Unloading a plugin removes its registrations and
 * reloading replaces them with new objects, so identity is the liveness test for both: a
 * drawer built from a replaced registration is stale even though a successor exists.
 */
export function retiredDrawerSource(
  sources: DrawerSources,
  drawers: ReadonlyArray<ExtensionContributionRegistration<DrawerFactory>>,
  sidebars: ReadonlyArray<ExtensionContributionRegistration<SidebarComponent>>,
): ExtensionContributionRegistration | undefined {
  if (sources.drawer && !drawers.includes(sources.drawer)) {
    return sources.drawer;
  }

  if (sources.sidebar && !sidebars.includes(sources.sidebar)) {
    return sources.sidebar;
  }

  return undefined;
}
