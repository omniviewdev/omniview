import {
  createAnnouncer,
  createPaletteStore,
  normaliseRoute,
  seedChips,
  toggleChordText,
  togglePanel,
  type Contributions,
  type OpenPalette,
  type PaletteBindings,
  type PaletteCandidate,
  type PaletteCommandOutcome,
  type PaletteSource,
  type PanelStore,
  type Route,
  type TabsStore,
} from '../../shell';
import { openable } from '../contract/admit';
import type { SidebarNodeV1 } from '../contract/v1';
import { connectionOf, routeKey, type PluginSource } from './contributions';
import type { Published } from './published';
import { DEFAULT_RAIL_ICON, failedOf, railOf } from './rail';

// The host's side of the command palette (ui-next/shell/core/palette is the model, ui-next/shell/palette draws it): the sources the host registers, the commands it can run, what the palette opens
// with, and what it keeps up to date while the window lives. The model is plugin-agnostic and so is this: what a plugin is called, where its pages are and whether a route can open all come from
// what the host already answers (`Contributions`, the plugin source, the sidebar nodes a plugin's hook published), and the host's own words are the only ones written here.
//
// There are three sources, all of the host's, and each answers synchronously from what the host holds at the moment it is asked: nothing is kept between one question and the next, so there is
// nothing to go stale. The model scores, filters and ranks what a source returns; a source returns the candidates that could answer and does not look at the query. While the palette is narrowed
// to a plugin (ch16 S69) the places of the others are not offered, and the host's commands still are.
//   Pages     the home of each plugin, whatever state it is in, and a row for each page of a plugin that is ready that its sidebar opens (section Go to).
//   Tabs      the open tabs, in the strip's order (section Tabs).
//   Commands  what the host can do from here, each with the reason it cannot when it cannot (section Commands).

/** What the host hands the palette. */
export type HostPaletteDeps = {
  /** The tab model: places open through it, its tabs are listed, and the tab commands run on it. */
  readonly tabs: TabsStore;
  /** The installed plugins and the state each is in. */
  readonly plugins: PluginSource;
  /** What the tab model asks the host: a route's words and whether it can open, and a plugin's home. */
  readonly contributions: Contributions;
  /** The sidebar nodes the plugin on the rail published, by plugin id. Nothing, or null: the contribution's skeleton stands. */
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
  /** The window's bottom panel. Absent: there is no panel to toggle. */
  readonly panel: PanelStore | undefined;
  readonly platform: 'mac' | 'other';
  /** Closes the window, where the app has one of its own. */
  readonly onCloseWindow: (() => void) | undefined;
  /** Where each plugin was last shown. A page of a plugin that is not on screen opens at the connection that plugin was last used in, as the entries of its own sidebar do. Absent: no connection is carried. */
  readonly remembered?: ((plugin: string) => Route | undefined) | undefined;
};

/** What the shell is given (`PaletteBindings`), and what the host starts once the window is on screen. */
export type HostPalette = PaletteBindings & {
  /**
   * Keeps the palette in step with the window: it remembers the place on screen and each one the user moves to (Recent), and, while the palette is open, makes its list again when the tabs, the
   * plugins or the published nodes change. Answers the function that undoes all of it. A palette that is closed costs nothing: there is no timer, no listener on the document, and nothing here
   * but those subscriptions.
   */
  readonly attach: () => () => void;
};

/** What the model calls the host's own sources, and the plugin it says owns them. */
const OWN = { plugin: 'host', pluginName: 'Omniview' } as const;

const NO_TAB = 'There is no tab to close.';
const NO_OTHER_TAB = 'There is no other tab.';
const UNSAVED = 'This tab has unsaved changes.';
/** Command W on a Mac and Control W elsewhere, as the panel's toggle chord is written (`toggleChordText`). */
const CLOSE_TAB_CHORD = { mac: '⌘W', other: 'Ctrl+W' } as const;
/** The app menu's Close Window. Only a Mac has it, and only a Mac is offered the command. */
const CLOSE_WINDOW_CHORD = '⌘⇧W';
/** A browser tab keeps Command or Control W and J for itself, so the shell also binds Control Option (Control Alt): that is the chord that works where the window is not the app's own, and the one said there. */
const WEB_CLOSE_TAB_CHORD = { mac: '⌃⌥W', other: 'Ctrl+Alt+W' } as const;
const WEB_TOGGLE_CHORD = { mac: '⌃⌥J', other: 'Ctrl+Alt+J' } as const;

/**
 * A list of places as one text: a place another part already named is said once ("north", never "north · north"). A part is a list of places joined by ` › `, and the parts are joined by
 * ` · `. The model says the places of a recent the same way, and the design lab's palette says those of a tab.
 */
function placesOf(parts: readonly string[]): string {
  const seen = new Set<string>();
  const said: string[] = [];
  for (const part of parts) {
    const chunks: string[] = [];
    for (const chunk of part.split(' · ')) {
      const fresh = chunk.split(' › ').filter((place) => {
        const key = place.toLowerCase();
        if (place === '' || seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
      if (fresh.length > 0) {
        chunks.push(fresh.join(' › '));
      }
    }

    if (chunks.length > 0) {
      said.push(chunks.join(' · '));
    }
  }

  return said.join(' · ');
}

/** The words a row is found by, each once whatever its case: the keywords of a candidate. */
function wordsOf(parts: readonly string[]): string {
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = part.trim().toLowerCase();
      if (key === '' || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .join(' ');
}

type Leaf = {
  readonly node: SidebarNodeV1;
  /** The labels of the groups it sits in, outermost first. */
  readonly groups: readonly string[];
};

/** The entries of a sidebar that are not groups, in the order the sidebar draws them. */
function leavesOf(nodes: readonly SidebarNodeV1[], groups: readonly string[] = []): Leaf[] {
  return nodes.flatMap((node) => (node.children === undefined ? [{ node, groups }] : leavesOf(node.children, [...groups, node.label])));
}

/**
 * The rows of the pages source. For each plugin, ready ones first in the order of the rail and then the others as the source lists them: its home, then a row for each page its sidebar opens.
 * A plugin that is not ready has its home alone: that opens a page that says what is wrong, and the model draws the row as Degraded. The home says where it is: its page's title when that is
 * not the plugin's name again. The sidebar's entry for the home is not a second row: its label is said by the home instead, when the home had nothing to say, and found by it.
 */
function pagesOf({ tabs, plugins, contributions, nodes, remembered }: HostPaletteDeps, only: string | null): PaletteCandidate[] {
  const entries = plugins.getSnapshot();
  const rail = railOf(entries);
  const place = new Map(rail.map((entry, index) => [entry.id, index]));
  const glyphs = new Map([...rail, ...failedOf(entries)].map((entry) => [entry.id, entry.icon]));
  const wanted = entries.filter((entry) => only === null || entry.id === only).sort((a, b) => (place.get(a.id) ?? rail.length) - (place.get(b.id) ?? rail.length));
  const onScreen = activeRoute(tabs)?.plugin;
  const rows: PaletteCandidate[] = [];
  for (const entry of wanted) {
    // A page of a plugin that is not on screen opens at the connection that plugin was last used in (the tab model gives a page the connection of the tab it is opened from, and that tab is another plugin's).
    const last = onScreen === entry.id ? undefined : remembered?.(entry.id);
    const connection = last === undefined ? undefined : connectionOf(last);
    const name = entry.phase === 'ready' ? entry.contribution.plugin.name : entry.name;
    const input = contributions.home?.(entry.id);
    const home = input === undefined ? undefined : normaliseRoute(input);
    const title = home === undefined ? '' : (contributions.describe(home)?.title ?? '').trim();
    let context = title.toLowerCase() === name.toLowerCase() ? '' : title;
    const found = [name, title];
    const pages: PaletteCandidate[] = [];
    const leaves = entry.phase === 'ready' ? leavesOf(openable(nodes.get(entry.id) ?? entry.contribution.sidebar.nodes, entry.contribution.pages)) : [];
    for (const { node, groups } of leaves) {
      const plain: Route = { plugin: entry.id, contribution: node.id, params: {} };
      const route: Route = connection === undefined ? plain : { ...plain, params: { connection } };
      if (home !== undefined && routeKey(plain) === routeKey(home)) {
        found.push(node.label);
        context = context === '' && node.label.toLowerCase() !== name.toLowerCase() ? node.label : context;
      } else {
        pages.push({
          id: `page:${entry.id}:${node.id}`,
          kind: 'page',
          noun: 'Page',
          title: node.label,
          icon: node.icon,
          tone: 'neutral',
          route,
          context: groups.length === 0 ? name : placesOf([name, groups.join(' › ')]),
          keywords: wordsOf([name, ...groups]),
        });
      }
    }

    if (home !== undefined) {
      rows.push({ id: `home:${entry.id}`, kind: 'home', noun: 'Plugin home', title: name, icon: glyphs.get(entry.id) ?? DEFAULT_RAIL_ICON, tone: 'neutral', route: home, context, keywords: wordsOf(found), order: rows.length });
    }

    for (const page of pages) {
      rows.push({ ...page, order: rows.length });
    }
  }

  return rows;
}

/**
 * The rows of the tabs source: each open tab in the strip's order, naming the tab as the tab model does and carrying its route, so a tab of a plugin that did not load is Degraded. Where it is
 * reads as the design lab's does: the crumbs of its path between the plugin's name and the page's own title, then its scope, and the tab on screen is marked. The mark is drawn and never
 * matched, so a search for those words does not find the one tab that holds them.
 */
function tabsOf({ tabs, plugins }: HostPaletteDeps, only: string | null): PaletteCandidate[] {
  const state = tabs.getSnapshot();
  const rows: PaletteCandidate[] = [];
  const installed = new Set(plugins.getSnapshot().map((entry) => entry.id));
  for (const id of state.order) {
    const tab = state.tabs[id];
    const identity = tabs.selectors.identity(state, id);
    if (tab === undefined || identity === undefined || (only !== null && tab.location.route.plugin !== only)) {
      continue;
    }

    const { route } = tab.location;
    const { pluginName } = tab.face;
    const above = identity.path.slice(0, -1).map((crumb) => crumb.label);
    if (above[0]?.toLowerCase() === pluginName.toLowerCase()) {
      above.shift();
    }

    const where = placesOf([above.join(' › '), tab.face.scope?.label ?? '']);
    rows.push({
      id,
      kind: 'tab',
      noun: 'Tab',
      title: identity.title,
      icon: tab.face.icon,
      tab: id,
      // A tab whose plugin is gone can still be switched to (the strip does, and its page says what happened): its row names no destination, so it is not refused as one.
      route: installed.has(route.plugin) ? route : undefined,
      context: state.active === id ? placesOf([where, 'Current tab']) : where,
      matchContext: where,
      keywords: wordsOf([pluginName === '' ? route.plugin : pluginName, route.contribution]),
    });
  }

  return rows;
}

/** What a tab operation answers, as far as a command reads it. */
type TabAnswer = { readonly status: 'done' | 'noop' } | { readonly status: 'confirm' } | { readonly status: 'refused'; readonly message: string };

/**
 * What a tab operation came to, as a command says it. A refusal is a refusal with the reason the tab model gave. `confirm` is one too: the model asks to be told the user chose to discard
 * what is unsaved, and the palette has no way to ask, so the tab stays and the user is told why.
 */
function outcomeOf(answer: TabAnswer): PaletteCommandOutcome {
  if (answer.status === 'refused') {
    return { ok: false, reason: answer.message };
  }

  return answer.status === 'confirm' ? { ok: false, reason: UNSAVED } : true;
}

/** A command of the host: what the palette lists, and what runs when it is chosen. */
type HostCommand = {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly icon: string;
  /** The chord the host binds to it, written for the platform. Absent: none is bound, and none is invented. */
  readonly shortcut?: string;
  /** Why it cannot run now. Absent: it can. */
  readonly unavailable?: string;
  readonly run: () => PaletteCommandOutcome;
};

/**
 * The commands the host can run from here, made from what is true now: Close tab, Toggle panel (when there is a panel), Close window (only on a Mac, and only when the app can close its window:
 * elsewhere the main window hides and nothing brings it back, decision A17), and Next tab and Previous tab. The palette lists them and the runner looks them up here, so what it runs is what
 * it checked a moment before.
 */
function commandsOf({ tabs, panel, platform, onCloseWindow }: HostPaletteDeps): HostCommand[] {
  const state = tabs.getSnapshot();
  const others = state.order.length > 1 ? undefined : NO_OTHER_TAB;
  // The app's own window gets the chords the shell binds natively; a browser tab keeps those for itself, and the shell's Control Option chords are what work there.
  const native = onCloseWindow !== undefined;
  const commands: HostCommand[] = [
    {
      id: 'host.tab.close',
      title: 'Close tab',
      context: 'Tabs',
      icon: 'close',
      shortcut: native ? CLOSE_TAB_CHORD[platform] : WEB_CLOSE_TAB_CHORD[platform],
      unavailable: state.active === null ? NO_TAB : undefined,
      run: () => outcomeOf(tabs.close()),
    },
  ];
  if (panel !== undefined) {
    commands.push({
      id: 'host.panel.toggle',
      title: 'Toggle panel',
      context: 'Panel',
      icon: 'panel-bottom',
      shortcut: native ? toggleChordText(platform) : WEB_TOGGLE_CHORD[platform],
      run: () => {
        togglePanel(panel);
        return true;
      },
    });
  }

  if (platform === 'mac' && onCloseWindow !== undefined) {
    commands.push({
      id: 'host.window.close',
      title: 'Close window',
      context: 'Window',
      icon: 'close',
      shortcut: CLOSE_WINDOW_CHORD,
      run: () => {
        onCloseWindow();
        return true;
      },
    });
  }

  // No chord is bound to either of these today, so none is shown.
  commands.push(
    { id: 'host.tab.next', title: 'Next tab', context: 'Tabs', icon: 'arrow-right', unavailable: others, run: () => outcomeOf(tabs.next()) },
    { id: 'host.tab.previous', title: 'Previous tab', context: 'Tabs', icon: 'arrow-left', unavailable: others, run: () => outcomeOf(tabs.previous()) },
  );
  return commands;
}

/** The route of the tab on screen: the same object until the tab moves. */
function activeRoute(tabs: TabsStore): Route | undefined {
  const state = tabs.getSnapshot();
  return state.active === null ? undefined : state.tabs[state.active]?.location.route;
}

/**
 * The host's palette: the announcer and the store the shell draws, with the host's sources registered in the store and the tab model, the plugins and the commands behind its seam. The window
 * calls `attach` once it is on screen.
 */
export function createHostPalette(deps: HostPaletteDeps): HostPalette {
  const { tabs, plugins, contributions, nodes, platform } = deps;
  const announcer = createAnnouncer();
  const store = createPaletteStore({
    // What the tab model made of the open (the route with the connection the tab was given) is what is remembered, whichever tab it opened, so a place is remembered as it was reached and not as its row named it.
    open: (destination, options) => {
      const result = tabs.open(destination, options);
      if (result.status === 'done') {
        const route = tabs.getSnapshot().tabs[result.id]?.location.route;
        if (route !== undefined) {
          store.record({ route, kind: 'page' });
        }
      }

      return result;
    },
    recordOpens: false,
    activate: tabs.activate,
    availability: contributions.availability,
    describe: contributions.describe,
    announce: announcer.announce,
    platform,
    // `windows` is not passed: the shell has no second window, so the footer does not say New window and Shift+Enter is refused with the reason, until a step builds one.
    // The command is looked up again, and checked against what is true now, immediately before it runs: the palette may have listed it a moment ago, and the host answers for the rest.
    run: (command) => {
      const found = commandsOf(deps).find((candidate) => candidate.id === command.id);
      if (found === undefined) {
        return { ok: false, reason: 'This command is not available.' };
      }

      return found.unavailable === undefined ? found.run() : { ok: false, reason: found.unavailable };
    },
  });

  const sources: readonly PaletteSource[] = [
    { id: 'host:pages', ...OWN, title: 'Pages', section: 'goto', match: (_query, scope) => pagesOf(deps, scope.plugin) },
    { id: 'host:tabs', ...OWN, title: 'Tabs', section: 'tabs', match: (_query, scope) => tabsOf(deps, scope.plugin) },
    {
      id: 'host:commands',
      ...OWN,
      title: 'Commands',
      section: 'commands',
      match: () =>
        commandsOf(deps).map(({ id, title, context, icon, shortcut, unavailable }) => ({ id, kind: 'command', title, context, icon, shortcut, unavailable, keywords: title.toLowerCase(), command: { id } })),
    },
  ];
  for (const source of sources) {
    const registration = store.registerProvider(source);
    if (!registration.ok) {
      throw new Error(`The palette refused the host's own source ${source.id}: ${registration.reason}`);
    }
  }

  /** The route on screen, and the chips that narrow the search to the tab's own plugin and scope when that plugin is ready (ch16 S69). */
  const opening = (): OpenPalette => {
    const state = tabs.getSnapshot();
    const tab = state.active === null ? undefined : state.tabs[state.active];
    if (tab === undefined) {
      return { current: undefined, scope: [] };
    }

    const entries = plugins.getSnapshot();
    const entry = entries.find((candidate) => candidate.id === tab.location.route.plugin);
    if (entry?.phase !== 'ready') {
      return { current: tab.location.route, scope: [] };
    }

    const pluginIcon = railOf(entries).find((candidate) => candidate.id === entry.id)?.icon;
    return { current: tab.location.route, scope: seedChips({ plugin: entry.id, pluginName: entry.contribution.plugin.name, pluginIcon, scope: tab.face.scope }) };
  };

  const attach = (): (() => void) => {
    const remember = (route: Route | undefined): void => {
      if (route !== undefined) {
        store.record({ route, kind: 'page' });
      }
    };

    const refresh = (moved?: { readonly route: Route | undefined }): void => {
      if (store.getSnapshot().open) {
        store.refresh(moved);
      }
    };

    let shown = activeRoute(tabs);
    remember(shown);
    const stops = [
      tabs.subscribe(() => {
        const route = activeRoute(tabs);
        const moved = route !== shown;
        if (moved) {
          shown = route;
          remember(route);
        }

        refresh(moved ? { route } : undefined);
      }),
      // A place the plugins could not describe when it was remembered (a window restored before they had loaded) is remembered again once they do.
      plugins.subscribe(() => {
        remember(activeRoute(tabs));
        refresh();
      }),
      nodes.subscribe(refresh),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }

      // A palette that is open when the window goes is closed with it: nothing of it outlives the subscriptions that kept it current.
      store.close();
    };
  };

  return { store, announcer, opening, attach };
}
