import { ActivityProvider } from '@omniviewdev/runtime';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PluginHost } from './PluginHost';
import { PluginStore } from './pluginStore';
import { useHashRoute } from './route';
import { useInstalledPlugins } from './useInstalledPlugins';

/**
 * The screen of contributed pages as the window mounts it: the installed plugins, their interfaces loading in a bounded pool beside the first paint (the
 * shell never waits for a plugin), the route, and the providers a plugin's hooks read through the host: the QueryClient and the theme are mounted above
 * by the entry, the activity provider here. A plugin that has no interface, or whose interface fails, is a state of its own frame, not of this screen.
 */
export function PluginHostScreen() {
  const [store] = useState(() => new PluginStore());
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const inventory = useInstalledPlugins();
  const [route, navigate] = useHashRoute();

  const { plugins } = inventory;
  useEffect(() => {
    for (const plugin of plugins) {
      void store.load(plugin);
    }
  }, [plugins, store]);

  return (
    <ActivityProvider>
      <PluginHost
        entries={entries}
        inventory={inventory.state}
        route={route}
        onNavigate={navigate}
        onRetry={(id) => {
          const plugin = plugins.find((candidate) => candidate.id === id);
          if (plugin !== undefined) {
            void store.retry(plugin);
          }
        }}
        onRetryInventory={inventory.retry}
      />
    </ActivityProvider>
  );
}
