import { activityClient, ActivityProvider, useActivities } from '@omniviewdev/runtime';
import { NetworkerClient, WindowClient } from '@omniviewdev/runtime/api';
import { window as windowModels } from '@omniviewdev/runtime/models';
import { Browser, Events, Window } from '@omniviewdev/runtime/runtime';
import { useEffect, useLayoutEffect, useState } from 'react';
import { isNativeWindow, loadNotices, loadSession, noticesStorage, resolveWindowName, windowStorage, type LoadedNotices, type LoadedSession } from '../../shell';
import { productionApi } from './connections';
import { createActivityFeed, type ActivityFeedControl } from '../../shell/panel/activity';
import { CLOSED_EVENT } from '../../shell/panel/ports/api';
import { attachLocalTerminal, restoreLocalTerminals, type TerminalsOptions } from '../../shell/panel/terminal';
import { loadAppTerminalChannels } from '../../shell/panel/terminal/terminalChannel';
import { listenForLifecycle } from './lifecycle';
import { PluginHost } from './PluginHost';
import { PluginStore } from './pluginStore';
import type { PortForwardNetwork } from './portForward';
import { useHashLink } from './route';
import { useInstalledPlugins } from './useInstalledPlugins';
import type { WindowService } from './windows';

/**
 * Hands what the runtime's activity provider holds to the feed the Problems and Operations tools read (`shell/panel/activity.ts`): its records, and its `unavailable`, the sentence for why it cannot observe the host's activity service
 * right now (a subscription or a heartbeat that failed, and nothing since has made it good). A failed observation holds no record, as an observation of no activity does not, so a tool that was handed the records alone could not tell the
 * two apart (and this window draws no other surface for it). The provider's `error` is not handed over: it is the wider sentence its toast and notification center say, and it also holds a notice that could not be published and a record
 * that could not be opened, which say nothing of whether the service can be observed. The window has ONE subscription to the host's activity service, the provider's (each is a producer lease), and this leaf is how the two tools share it.
 * It renders nothing, and it is what renders when a record changes (a task's progress ticks many times a second): the host above it is not told, and each tool reads the feed itself.
 */
function ActivityTap({ control }: { readonly control: ActivityFeedControl }) {
  const { records, unavailable } = useActivities();
  useEffect(() => {
    control.push(records, unavailable);
  }, [control, records, unavailable]);
  return null;
}

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

/**
 * Opens an address outside the app, in the system's browser: the host's own call (`Browser.OpenURL`), which the Terminal tool uses for a link a person follows in a terminal's output. The tool gives it only http and https addresses; the host
 * checks the address again and may refuse it (one with a shell metacharacter in it), and a refusal is the call's rejection, which the tool turns into a warning on the console.
 */
async function openExternal(url: string): Promise<void> {
  await Browser.OpenURL(url);
}

/** The id of the forward a closed event of the host is about: its payload is the session, and its `id` is the only thing of it read here. */
function closedId(data: unknown): string | undefined {
  return typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string' && data.id !== '' ? data.id : undefined;
}

/**
 * The host's networker as a page's forward reaches it (`ctx.panel.ports.forward`, and the `stop` of the forward it answers): the runtime's own calls, as they are, and nothing decided here. `start` is the typed start: the plugin and the
 * connection the page is read in are its routing, and the request is the typed one the host admits and hands to the plugin's forwarder. `stop` is the close of a forward by its id, and the session the host answers is not read. What comes
 * of either is worded by the forward (`portForward.ts`), so the host's refusal is the call's rejection as it came. `onClosed` is the host's word that a forward was closed, by whoever closed it: its event, `core/networker/portforward/closed`,
 * whose payload is the session, heard through the runtime from the moment it is asked for until the function it answers is called. The window asks only while it counts a forward, so a window that forwards nothing listens to nothing.
 */
const networker: PortForwardNetwork = {
  start: async (plugin, connection, request) => NetworkerClient.StartResourcePortForwardingSession(plugin, connection, request),
  stop: async (sessionId) => {
    await NetworkerClient.ClosePortForwardSession(sessionId);
  },
  onClosed: (listener) =>
    Events.On(CLOSED_EVENT, ({ data }) => {
      const id = closedId(data);
      if (id !== undefined) {
        listener(id);
      }
    }),
};

/** The name of the window this page is in, as the host's window service knows it (`resolveWindowName`): the key of its slots. */
const windowName = async (): Promise<string> => resolveWindowName({ name: async () => Window.Name(), list: async () => WindowClient.List() });

/** The host's window service over the runtime's calls: the name of this window, a new workspace window with the session it starts from, a window's close and focus, the windows that are open, and the runtime's events. */
const windowService: WindowService = {
  name: windowName,
  open: async (session) => WindowClient.Open({ kind: windowModels.Kind.KindWorkspace, initialState: { session }, anchorWindow: '', clientX: 0, clientY: 0, hasPosition: false, width: 0, height: 0 }),
  close: async (name) => WindowClient.Close(name),
  focus: async (name) => WindowClient.Focus(name),
  list: async () => WindowClient.List(),
  emit: async (event, data) => Events.Emit(event, data),
  on: (event, listener) => Events.On(event, ({ data }) => {
    listener(data);
  }),
};

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
  const [windows] = useState(() => (isNativeWindow() ? windowService : undefined));
  const [openSettingsWindow] = useState(() => (isNativeWindow() ? showSettingsWindow : undefined));
  const inventory = useInstalledPlugins();
  const link = useHashLink();
  const [loaded, setLoaded] = useState<{ readonly session: LoadedSession; readonly notices: LoadedNotices; readonly terminals: TerminalsOptions } | undefined>(undefined);
  // What the two panel tools ask of the activity service besides reading it: stop a task the producer can stop, and keep that a record was read. The window's calls, through the runtime's client.
  const [activity] = useState(() =>
    createActivityFeed({
      cancel: async (id) => activityClient.requestCancellation(id),
      markRead: async (id) => activityClient.setPresentation({ id, read: true }),
    }),
  );

  // What the host says of a plugin that stops (`plugin/unloaded`: its process crashed, it is reloading, uninstalled or turned off) and of one that runs again (`plugin/state_change`): the store drops what the
  // window drew from the plugin and loads it again from its files, with no reload of the window (decision A21, P1b3c-01). The inventory above only ever adds.
  useEffect(() => listenForLifecycle(store, Events), [store]);

  useEffect(() => {
    let current = true;
    const channels = loadAppTerminalChannels();
    void Promise.all([loadWindowSession(), loadWindowNotices()]).then(([session, notices]) => {
      if (current) {
        // When the window attaches, the Terminal tool asks the host for the terminals this window left (`restoreLocalTerminals`), and a terminal another tab took over is attached again (`attachLocalTerminal`), both
        // through the page's channels, which hold the capabilities. A stream that drops is connected again by its own feed, so there is no signal to forward. A link a person follows in a terminal opens in the system browser (`openExternal`).
        setLoaded({ session, notices, terminals: { restore: async () => restoreLocalTerminals(channels), reattach: (id) => attachLocalTerminal(id, undefined, channels), openExternal } });
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
      <ActivityTap control={activity} />
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
          windows={windows}
          openSettingsWindow={openSettingsWindow}
          session={loaded.session}
          savedNotices={loaded.notices}
          connections={productionApi}
          terminals={loaded.terminals}
          activity={activity.feed}
          networker={networker}
        />
      )}
    </ActivityProvider>
  );
}
