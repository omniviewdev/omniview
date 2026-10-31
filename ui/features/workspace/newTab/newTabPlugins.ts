import { useMemo } from 'react';
import type { PluginInfo } from '@omniviewdev/runtime/models';
import { usePluginService } from '@/features/plugins';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { orFallback } from '@/utils/orFallback';

/** A plugin that a new tab can open, on its home page. */
export type NewTabPlugin = {
  readonly id: string;
  readonly name: string;
  /** react-icons name (e.g. `SiKubernetes`) or image URL; empty when the plugin has none. */
  readonly icon: string;
};

type Registrations = ReadonlyMap<string, { readonly routes: readonly unknown[] }>;

/**
 * Installed plugins that have pages of their own, sorted by name. A plugin that
 * loaded without routes only contributes to other plugins' extension points
 * (Flux adds its pages to the Kubernetes plugin), so there is nothing to open.
 * Plugins that have not loaded yet (or failed to) keep their entry.
 */
export function selectNewTabPlugins(inventory: readonly PluginInfo[] | undefined, registrations: Registrations): NewTabPlugin[] {
  return (inventory ?? [])
    .filter(({ id }) => registrations.get(id)?.routes.length !== 0)
    .map(({ id, metadata }) => ({ id, name: orFallback(metadata?.name, id), icon: metadata?.icon ?? '' }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Plugins for the new-tab launcher, or `undefined` until the inventory has loaded.
 * The launcher is always mounted, so its plugin manager also keeps the inventory
 * fresh and reports failed dev reloads, as the plugin rail it replaced did.
 */
export function useNewTabPlugins(): NewTabPlugin[] | undefined {
  const { plugins } = usePluginManager();
  const { registrations } = usePluginService();
  return useMemo(
    () => plugins.data === undefined ? undefined : selectNewTabPlugins(plugins.data, registrations),
    [plugins.data, registrations],
  );
}

export function pluginHomePath(pluginId: string): string {
  return `/_plugin/${pluginId}`;
}
