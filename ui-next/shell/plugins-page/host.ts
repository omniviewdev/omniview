import { PluginManager } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import type { QueryClient } from '@tanstack/react-query';
import { INVENTORY_KEY } from '../../plugins/host/useInstalledPlugins';
import type { PluginActions } from './core/model';
import type { InventoryEntry } from './core/types';
import type { PluginsPageDeps } from './PluginsPage';

// The Plugins page over the real host (the runtime's bound `PluginManager` and `Events`). Everything the page does to the host goes through these functions, so a test or a probe gives the page others (`PluginsPageDeps`).

/** The host's inventory: every plugin it holds, in no order (a Go map). */
const read = async (): Promise<readonly InventoryEntry[]> => (await PluginManager.ListPlugins()) ?? [];

const actions: PluginActions = {
  reload: async (id) => PluginManager.ReloadPlugin(id),
  setEnabled: async (id, enabled) => PluginManager.SetPluginEnabled(id, enabled),
  uninstall: async (id) => PluginManager.UninstallPlugin(id),
};

/** The inventory the window already holds (`useInstalledPlugins` reads it into the one query client), so the page's first frame has its list. */
function seed(queryClient: QueryClient): readonly InventoryEntry[] | undefined {
  const held = queryClient.getQueryData<readonly InventoryEntry[]>(INVENTORY_KEY);
  return Array.isArray(held) ? held : undefined;
}

export const productionDeps: PluginsPageDeps = { read, actions, events: Events, seed };
