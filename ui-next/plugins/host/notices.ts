import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { createCentre, createNoticesAnnouncer, createNoticesStore, type Contributions, type LoadedNotices, type NoticesBindings, type NoticesStore, type Route, type TabsStore } from '../../shell';
import { routeKey, type PluginSource } from './contributions';
import type { PluginEntry } from './pluginStore';

// The host's side of the notices (ui-next/shell/core/notices is the model, ui-next/shell/notices draws its toasts): the store with the host's seam behind it, the one real source that feeds it, and what keeps it true
// while the window lives. The model is plugin-agnostic and so is this: which plugins exist and what a route can do come from what the host already answers (the plugin source, the tab model's contributions), and the
// host's own words are the only ones written here.
//
// THE SOURCE is a failed action of a page (`pageFailures.ts`): a command of a page's header fails with what the runtime's hooks throw, the host's `apperror` envelope as a `RuntimeError` whose message is its JSON.
// The runtime's `parseAppError` is the one parser (decision R13); the model maps what it answers (`noticeFromHostError`): the title is the class's, the detail the plugin's one sentence, FORBIDDEN, UNAUTHORIZED, INTERNAL
// and PROVIDER_ERROR keep the host's own text, raw text is never chrome, and a cancellation is no notice. The toast offers Retry, which asks the same command again. NOT a source: the command palette, whose
// feedback is its own status line (S85: never a toast for palette feedback); it only holds the stack back while it is open (S89a).

/** What tells the notices that a modal owns the window (ch16 S89a): the command palette is the one today. */
export type ModalSource = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly open: () => boolean;
};

export type HostNoticesDeps = {
  /** The tab model: a notice's route opens through it, and the tab on screen is what an Open never opens again. */
  readonly tabs: TabsStore;
  /** The installed plugins and the state each is in. */
  readonly plugins: PluginSource;
  /** What the tab model asks the host: whether a route can open. */
  readonly contributions: Contributions;
  readonly platform: 'mac' | 'other';
  /** The history the window saved (`loadNotices`): it is where the model starts, and it is saved from the moment the window is on screen. Absent: no history comes back and none is saved. */
  readonly saved?: LoadedNotices | undefined;
};

/** What the shell is given (`NoticesBindings`), and what the host starts once the window is on screen. */
export type HostNotices = NoticesBindings & {
  /**
   * Keeps the model in step with the window: the stack waits while a modal is open, a plugin that left takes the code of its notices with it and every action is asked again what it can do when the plugins or the
   * tab on screen change. Answers the function that undoes all of it. It costs nothing while nothing happens: three subscriptions and no timer.
   */
  readonly attach: (modal: ModalSource) => () => void;
};

/**
 * A command of `plugin`'s page failed with `error`: the failure is that plugin's notice, with a Retry that runs `retry`, which is the command asked by the same path (a second failure is a count on the one toast).
 * What the runtime's parser makes of the error is all that is read of it: a cancellation is no notice, and what is not the host's envelope is a generic failure that shows none of its text.
 */
export function failureNotice(store: NoticesStore, plugin: string, error: unknown, retry: () => void): void {
  console.error(`[notices] a command of ${plugin} failed`, error);
  store.forSource(plugin).fromError(parseAppError(error), { actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: retry }] });
}

/** The route of the tab on screen: the same object until the tab moves. */
function activeRoute(tabs: TabsStore): Route | undefined {
  const state = tabs.getSnapshot();
  return state.active === null ? undefined : state.tabs[state.active]?.location.route;
}

/** What a plugin is called: its contribution's name once it is ready, else the name its manifest gives it. */
function nameOf(entries: readonly PluginEntry[], id: string): string | undefined {
  const entry = entries.find((candidate) => candidate.id === id);
  return entry === undefined ? undefined : entry.phase === 'ready' ? entry.contribution.plugin.name : entry.name;
}

export function createHostNotices(deps: HostNoticesDeps): HostNotices {
  const { tabs, plugins, contributions, platform, saved } = deps;
  const announcer = createNoticesAnnouncer();
  // The notification centre: the bell and the summary toast's Show share it (the store's `openCenter` is its `open`).
  const centre = createCentre();
  const store = createNoticesStore({
    initial: saved?.initial,
    openCenter: centre.open,
    open: (destination, options) => tabs.open(destination, options),
    availability: contributions.availability,
    current: (route) => {
      const on = activeRoute(tabs);
      return on !== undefined && routeKey(on) === routeKey(route);
    },
    announce: announcer.announce,
    pluginName: (plugin) => nameOf(plugins.getSnapshot(), plugin),
    platform,
  });

  const attach = (modal: ModalSource): (() => void) => {
    const ready = (): Set<string> => new Set(plugins.getSnapshot().flatMap((entry) => (entry.phase === 'ready' ? [entry.id] : [])));
    let known = ready();
    let shown = activeRoute(tabs);
    let held = false;

    const syncModal = (): void => {
      const open = modal.open();
      if (open !== held) {
        held = open;
        store.hold('modal', open);
      }
    };

    syncModal();
    // A modal owns the window (S89a; the browser's own modal would close a popover): the centre closes when the palette opens.
    const stopModal = modal.subscribe(() => {
      if (modal.open()) {
        centre.close();
      }
    });
    const stopSaving = saved?.attach(store);
    const stops = [
      modal.subscribe(syncModal),
      stopModal,
      // A plugin that is not ready any more (reloaded, failed, gone) has left: the code of its notices is gone with it, and every notice asks again what its actions can do.
      plugins.subscribe(() => {
        const now = ready();
        for (const id of known) {
          if (!now.has(id)) {
            store.removePlugin(id);
          }
        }

        known = now;
        store.refresh();
      }),
      // A route is not opened when it is the page the user is on (OF3): the model asks again when the tab on screen moves.
      tabs.subscribe(() => {
        const route = activeRoute(tabs);
        if (route !== shown) {
          shown = route;
          store.refresh();
        }
      }),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }

      // The history is written once more before the window goes, and the saver is let go of.
      stopSaving?.();

      if (held) {
        held = false;
        store.hold('modal', false);
      }
    };
  };

  return { store, announcer, centre, attach };
}
