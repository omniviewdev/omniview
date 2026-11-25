import { ActivityProvider } from '@omniviewdev/runtime';
import { WindowClient } from '@omniviewdev/runtime/api';
import { Events, Window } from '@omniviewdev/runtime/runtime';
import { useEffect, useLayoutEffect, useState } from 'react';
import { isNativeWindow, loadNotices, loadSession, noticesStorage, resolveWindowName, windowStorage, type LoadedNotices, type LoadedSession } from '../../shell';
import { productionApi } from './connections';
import { attachLocalTerminal, restoreLocalTerminals, type TerminalsOptions } from '../../shell/panel/terminal';
import { loadAppTerminalChannels } from '../../shell/panel/terminal/terminalChannel';
import { listenForLifecycle } from './lifecycle';
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
 * Where the app has native windows Settings is a window of its own, the original application's (owner's ruling, 2026-11-22): the host shows it, creates it the first time, and focuses the one that is open when it is asked again (`OpenSettings`
 * with no target keeps where it was). A browser has none, and Settings is a sheet in the window.
 */
async function showSettingsWindow(): Promise<void> {
  await WindowClient.OpenSettings('');
}

/** The name of the window this page is in, as the host's window service knows it (`resolveWindowName`): the key of its slots. */
const windowName = async (): Promise<string> => resolveWindowName({ name: async () => Window.Name(), list: async () => WindowClient.List() });

/**
 * This window's saved session, read through the host's window service: the slots the Go side keeps for the window this page is in (`backend/window`, persisted to `windows.json` in the
 * instance's state root). It never rejects: a window that cannot name itself, or whose slots cannot be read, starts empty and saves nothing, with a note on the console (`shell/session`).
 */
const loadWindowSession = async (): Promise<LoadedSession> => loadSession(windowStorage({ client: WindowClient, name: windowName }));

/**
 * This window's saved notification history, read beside its session and from the same place, in a slot of its own (`shell/notices/storage.ts`). It never rejects either: a history that cannot be read or used is a window
 * that starts with none, with a note on the console.
 */
const loadWindowNotices = async (): Promise<LoadedNotices> => loadNotices(noticesStorage({ client: WindowClient, name: windowName }));

/**
 * The screen of contributed pages as the window mounts it: the installed plugins, their interfaces loading in a bounded pool beside the first paint (the
 * shell never waits for a plugin), the address, and the providers a plugin's hooks read through the host: the QueryClient and the theme are mounted above
 * by the entry, the activity provider here. A plugin that has no interface, or whose interface fails, is a state of its own tab, not of this screen.
 * Closing the window is the app's own window's to do: a browser tab has none, so the host is told of none there and the close chord does nothing.
 *
 * The window's saved session is read beside all of that, and the host is drawn once it has: its tabs, the rail's choice and the panel are the first frame, so nothing is drawn and then moved. The read
 * is bounded (`READ_DEADLINE_MS`) and never fails, so the window is never held back by it for longer than that, and never blank for good. The capabilities of the window's terminals are read from the tab's own storage (`loadAppTerminalChannels`: synchronous, never failing), so that the terminals the window left are found from the first frame.
 */
export function PluginHostScreen() {
  const [store] = useState(() => new PluginStore());
  const [onCloseWindow] = useState(() => (isNativeWindow() ? closeWindow : undefined));
  const [openSettingsWindow] = useState(() => (isNativeWindow() ? showSettingsWindow : undefined));
  const inventory = useInstalledPlugins();
  const link = useHashLink();
  const [loaded, setLoaded] = useState<{ readonly session: LoadedSession; readonly notices: LoadedNotices; readonly terminals: TerminalsOptions } | undefined>(undefined);

  // What the host says of a plugin that stops (`plugin/unloaded`: its process crashed, it is reloading, uninstalled or turned off) and of one that runs again (`plugin/state_change`): the store drops what the
  // window drew from the plugin and loads it again from its files, with no reload of the window (decision A21, P1b3c-01). The inventory above only ever adds.
  useEffect(() => listenForLifecycle(store, Events), [store]);

  useEffect(() => {
    let current = true;
    const channels = loadAppTerminalChannels();
    void Promise.all([loadWindowSession(), loadWindowNotices()]).then(([session, notices]) => {
      if (current) {
        // When the window attaches, the Terminal tool asks the host for the terminals this window left (`restoreLocalTerminals`), and a terminal another tab took over is attached again (`attachLocalTerminal`), both
        // through the page's channels, which hold the capabilities. A stream that drops is connected again by its own feed, so there is no signal to forward.
        setLoaded({ session, notices, terminals: { restore: async () => restoreLocalTerminals(channels), reattach: (id) => attachLocalTerminal(id, undefined, channels) } });
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
      {loaded === undefined ? null : (
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
          openSettingsWindow={openSettingsWindow}
          session={loaded.session}
          savedNotices={loaded.notices}
          connections={productionApi}
          terminals={loaded.terminals}
        />
      )}
    </ActivityProvider>
  );
}
