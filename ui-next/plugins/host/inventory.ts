import type { PluginDescriptor } from './pluginStore';

// What the window reads of the host's inventory of plugins (`PluginManager.ListPlugins`, read by `useInstalledPlugins`): which plugins have an interface to load, under what name, and which the host already holds as failed. The phase is read
// and nothing else of the plugin's state: the inventory carries the text of its last error (`lastError`), which is the plugins page's to show and never this window's, so no word of a plugin or of its process reaches a page by this way.

/** The members of an inventory entry (`PluginInfo`) that the window reads. */
export type InstalledPlugin = {
  readonly id: string;
  readonly origin: string;
  readonly enabled: boolean;
  readonly phase: string;
  readonly metadata: { readonly name: string };
};

/**
 * The phases in which the host holds a plugin as failed: its load failed (a process that did not start, files that did not validate) or its build did. A window that was not open when the load failed was told nothing (the host's events reach
 * the windows that are open), so the inventory is how it learns: the plugin is shown as failed from the first, with a Retry that asks the host.
 */
const FAILED_PHASES: ReadonlySet<string> = new Set(['Failed', 'BuildFailed']);

/** The plugins whose interface the window should load, in the order the host lists them. */
export function describePlugins(plugins: readonly InstalledPlugin[]): readonly PluginDescriptor[] {
  return (
    plugins
      // Product-owned frontends and plugins the user turned off have no bundle to load here.
      .filter((plugin) => plugin.origin !== 'builtin' && plugin.enabled)
      .map((plugin): PluginDescriptor => ({ id: plugin.id, name: plugin.metadata.name === '' ? plugin.id : plugin.metadata.name, ...(FAILED_PHASES.has(plugin.phase) ? { failed: true } : {}) }))
  );
}
