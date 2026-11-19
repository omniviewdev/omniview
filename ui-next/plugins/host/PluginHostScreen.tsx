import { ActivityProvider } from '@omniviewdev/runtime';
import { Window } from '@omniviewdev/runtime/runtime';
import { useEffect, useState } from 'react';
import { isNativeWindow } from '../../shell';
import { PluginHost } from './PluginHost';
import { PluginStore } from './pluginStore';
import { useHashLink } from './route';
import { useInstalledPlugins } from './useInstalledPlugins';

/**
 * Closes the app's window: the same request the window's close button makes. The main window hides instead of closing (`backend/window/wails.go`, `attachMainWindow`), so what comes of this
 * is a hidden window and a running app (on macOS the Dock icon brings it back; the shell asks for this on a Mac only, because on Windows and Linux nothing does yet: docs/ui-next/status/S2a.md, Backend catalog); any other window closes.
 */
function closeWindow(): void {
  Window.Close().catch((error: unknown) => {
    console.warn('[window] the window could not be closed', error);
  });
}

/**
 * The screen of contributed pages as the window mounts it: the installed plugins, their interfaces loading in a bounded pool beside the first paint (the
 * shell never waits for a plugin), the address, and the providers a plugin's hooks read through the host: the QueryClient and the theme are mounted above
 * by the entry, the activity provider here. A plugin that has no interface, or whose interface fails, is a state of its own tab, not of this screen.
 * Closing the window is the app's own window's to do: a browser tab has none, so the host is told of none there and the close chord does nothing.
 */
export function PluginHostScreen() {
  const [store] = useState(() => new PluginStore());
  const [onCloseWindow] = useState(() => (isNativeWindow() ? closeWindow : undefined));
  const inventory = useInstalledPlugins();
  const link = useHashLink();

  const { plugins } = inventory;
  useEffect(() => {
    for (const plugin of plugins) {
      void store.load(plugin);
    }
  }, [plugins, store]);

  return (
    <ActivityProvider>
      <PluginHost
        plugins={store}
        inventory={inventory.state}
        link={link}
        onRetry={(id) => {
          const plugin = plugins.find((candidate) => candidate.id === id);
          if (plugin !== undefined) {
            void store.retry(plugin);
          }
        }}
        onRetryInventory={inventory.retry}
        onCloseWindow={onCloseWindow}
      />
    </ActivityProvider>
  );
}
