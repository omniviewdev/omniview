import type { ExtensionPointRegistryContract } from '@omniviewdev/runtime';
import {
  RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
  createResourceSidebarExtensionPoint,
} from './sidebar/extensionPoint';
import {
  RESOURCE_DRAWER_EXTENSION_POINT_ID,
  createResourceDrawerExtensionPoint,
} from './drawer/extensionPoint';

/**
 * Ensure host-owned builtin extension points are registered.
 *
 * Idempotent for core-owned definitions: if the extension point already exists
 * and is owned by 'core', this is a no-op. If a non-core owner has claimed
 * a builtin ID, this throws to prevent silent collisions.
 *
 * Must run before any plugin contribution registration path.
 */
export function ensureBuiltinExtensionPointsRegistered(
  registry: ExtensionPointRegistryContract,
): void {
  registerIfAbsent(registry, RESOURCE_SIDEBAR_EXTENSION_POINT_ID, createResourceSidebarExtensionPoint);
  registerIfAbsent(registry, RESOURCE_DRAWER_EXTENSION_POINT_ID, createResourceDrawerExtensionPoint);
}

function registerIfAbsent(
  registry: ExtensionPointRegistryContract,
  id: string,
  factory: () => any,
): void {
  if (registry.hasExtensionPoint(id)) {
    // Already registered — verify ownership
    const store = registry.getExtensionPoint(id);
    if (store && (store as any).pluginId !== 'core') {
      throw new Error(
        `Builtin extension point "${id}" has been claimed by non-core owner "${(store as any).pluginId}"`,
      );
    }
    // Core-owned, already registered — idempotent no-op
    return;
  }

  registry.addExtensionPoint(factory());
}
