import type { ExtensionPointRegistryContract } from '@omniviewdev/runtime';
import {
  RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
  createResourceSidebarExtensionPoint,
} from './sidebar/extensionPoint';
import {
  RESOURCE_DRAWER_EXTENSION_POINT_ID,
  createResourceDrawerExtensionPoint,
} from './drawer/extensionPoint';
import {
  THEME_EXTENSION_POINT_ID,
  createThemeExtensionPoint,
} from './theme/extensionPoint';
import { GLOBAL_SEARCH_EXTENSION_POINT_ID, createGlobalSearchExtensionPoint } from '../command-search/extensionPoint';
import { RESOURCE_ICON_EXTENSION_POINT_ID } from '@omniviewdev/runtime';
import { SETTINGS_EDITOR_EXTENSION_POINT_ID } from '@omniviewdev/runtime';

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
  registerIfAbsent(registry, THEME_EXTENSION_POINT_ID, createThemeExtensionPoint);
  registerIfAbsent(registry, GLOBAL_SEARCH_EXTENSION_POINT_ID, createGlobalSearchExtensionPoint);
  registerIfAbsent(registry, SETTINGS_EDITOR_EXTENSION_POINT_ID, () => ({
    id: SETTINGS_EDITOR_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'multiple',
  }));
  registerIfAbsent(registry, RESOURCE_ICON_EXTENSION_POINT_ID, () => ({
    id: RESOURCE_ICON_EXTENSION_POINT_ID,
    pluginId: 'core',
    mode: 'multiple',
  }));
}

function registerIfAbsent(
  registry: ExtensionPointRegistryContract,
  id: string,
  factory: () => any,
): void {
  if (registry.hasExtensionPoint(id)) {
    // Already registered — verify ownership
    const store = registry.getExtensionPoint(id);
    if (store && store.pluginId !== 'core') {
      throw new Error(
        `Builtin extension point "${id}" has been claimed by non-core owner "${store.pluginId}"`,
      );
    }

    // Core-owned, already registered — idempotent no-op
    return;
  }

  registry.addExtensionPoint(factory());
}
