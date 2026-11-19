import { ActivityProvider } from '@omniviewdev/runtime';
import { WindowClient } from '@omniviewdev/runtime/api';
import { Window } from '@omniviewdev/runtime/runtime';
import { useEffect, useLayoutEffect, useState } from 'react';
import { isNativeWindow, loadSession, resolveWindowName, windowStorage, type LoadedSession } from '../../shell';
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
 * This window's saved session, read through the host's window service: the slots the Go side keeps for the window this page is in (`backend/window`, persisted to `windows.json` in the
 * instance's state root). It never rejects: a window that cannot name itself, or whose slots cannot be read, starts empty and saves nothing, with a note on the console (`shell/session`).
 */
const loadWindowSession = async (): Promise<LoadedSession> =>
  loadSession(windowStorage({ client: WindowClient, name: async () => resolveWindowName({ name: async () => Window.Name(), list: async () => WindowClient.List() }) }));

/**
 * The screen of contributed pages as the window mounts it: the installed plugins, their interfaces loading in a bounded pool beside the first paint (the
 * shell never waits for a plugin), the address, and the providers a plugin's hooks read through the host: the QueryClient and the theme are mounted above
 * by the entry, the activity provider here. A plugin that has no interface, or whose interface fails, is a state of its own tab, not of this screen.
 * Closing the window is the app's own window's to do: a browser tab has none, so the host is told of none there and the close chord does nothing.
 *
 * The window's saved session is read beside all of that, and the host is drawn once it has: its tabs, the rail's choice and the panel are the first frame, so nothing is drawn and then moved. The read
 * is bounded (`READ_DEADLINE_MS`) and never fails, so the window is never held back by it for longer than that, and never blank for good.
 */
export function PluginHostScreen() {
  const [store] = useState(() => new PluginStore());
  const [onCloseWindow] = useState(() => (isNativeWindow() ? closeWindow : undefined));
  const inventory = useInstalledPlugins();
  const link = useHashLink();
  const [session, setSession] = useState<LoadedSession | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void loadWindowSession().then((loaded) => {
      if (current) {
        setSession(loaded);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  // The plugins are handed to the store before the screen is painted, in the commit the list arrives in: a tab restored from a session names a plugin that the host has not been told of until then,
  // and would be drawn for a frame as a plugin that is not installed.
  const { plugins } = inventory;
  useLayoutEffect(() => {
    for (const plugin of plugins) {
      void store.load(plugin);
    }
  }, [plugins, store]);

  return (
    <ActivityProvider>
      {session === undefined ? null : (
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
          session={session}
        />
      )}
    </ActivityProvider>
  );
}
