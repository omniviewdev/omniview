import {
  createAnnouncer,
  createPaletteStore,
  NEW_TERMINAL,
  normaliseRoute,
  SCREEN_READER_COMMAND,
  screenReaderSaid,
  seedChips,
  settingsChordText,
  TAB_PALETTE_COMMANDS,
  tabCommands,
  TERMINAL_TOOL,
  TERMINAL_TOOL_ID,
  toggleChordText,
  togglePanel,
  togglePanelMaximized,
  equaliseTool,
  focusSashOfActivePane,
  moveToPane,
  maximizeChordText,
  type Contributions,
  type Description,
  type OpenPalette,
  type PaletteBindings,
  type PaletteCandidate,
  type PaletteCommandOutcome,
  type PaletteCommandRef,
  type PaletteScope,
  type PaletteSource,
  type PanelStore,
  type Route,
  type TabsStore,
  WEB_SETTINGS_CHORD,
} from '../../shell';
import { openable } from '../contract/admit';
import { readKeywords } from '../contract/sidebarKeywords';
import { readTarget } from '../contract/sidebarTargets';
import type { ContributionV1, FrameV1, PanelHostV1, SidebarNodeV1 } from '../contract/v1';
import { laneNameOf } from './connectionName';
import type { HostConnections } from './connections';
import { faceOf } from './connections/words';
import { connectionOf, routeKey, type PluginSource } from './contributions';
import { allHostPages, HOST_PLUGIN } from './hostPages';
import { commandOf, providersOf, runCommand } from './paletteProviders';
import type { PluginEntry } from './pluginStore';
import type { Published } from './published';
import { DEFAULT_RAIL_ICON, failedOf, inRailOrder, railOf } from './rail';

type Ready = Extract<PluginEntry, { readonly phase: 'ready' }>;

// The host's side of the command palette (ui-next/shell/core/palette is the model, ui-next/shell/palette draws it): the sources the host registers, the commands it can run, what the palette opens
// with, and what it keeps up to date while the window lives. The model is plugin-agnostic and so is this: what a plugin is called, where its pages are and whether a route can open all come from
// what the host already answers (`Contributions`, the plugin source, the sidebar nodes a plugin's hook published), and the host's own words are the only ones written here.
//
// There are three sources, all of the host's, and each answers synchronously from what the host holds at the moment it is asked: nothing is kept between one question and the next, so there is
// nothing to go stale. The model scores, filters and ranks what a source returns; a source returns the candidates that could answer and does not look at the query. While the palette is narrowed
// to a plugin (ch16 S69) the places of the others are not offered, and the host's commands still are.
//   Pages     the home of each plugin, whatever state it is in, and a row for each page of a plugin that is ready that its sidebar opens (section Go to). A page's row says where it is as the design lab's kind rows do
//             ("Workloads", the connection first when the palette is not narrowed to it) and is found by the keywords its sidebar entry gives it (`contract/sidebarKeywords.ts`), which the palette ranks as names.
//   Tabs      the open tabs, in the strip's order (section Tabs).
//   Commands  what the host can do from here, each with the reason it cannot when it cannot (section Commands).
// And one more for each provider a plugin that is ready declares (contract/v1.ts, `palette`; `paletteProviders.ts` makes them): registered when the plugin is ready and taken away, with its pending requests and its rows,
// when it is not (PO1). A plugin's rows open through the tab model exactly as the host's own do, and a command a row names runs the plugin's own function, looked up again immediately before it runs.

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
  /** Opens Settings (the shell's control: `shell/settings/host.ts`). Absent: the window has none, and the command is not offered. */
  readonly openSettings?: (() => void) | undefined;
  /**
   * The Terminal tool's screen reader mode: `toggle` flips the window's one choice and answers what it is now, and `say` tells a person who cannot see the screen what it came to, through the window's live region.
   * Absent: the window has no Terminal tool, and the command is not offered.
   */
  readonly terminalScreenReader?: { readonly toggle: () => boolean; readonly say: (text: string) => void } | undefined;
  /** Starts a session in the Terminal tool, as its `+` does. Absent: the window has no Terminal tool, and the command is not offered. */
  readonly newTerminal?: (() => void) | undefined;
  /**
   * The Terminal's pane commands: focus the next and the previous pane, resize a pane (the keyboard goes to a sash) and equalise the panes. A terminal takes Tab and every Control chord and F6 leaves it, so these are the way to the other panes and to a
   * sash on every platform, also where the pane chords are the browser's. Absent: the window has no Terminal tool, and they are not offered.
   */
  readonly terminalPanes?: boolean | undefined;
  /** Where each plugin was last shown. A page of a plugin that is not on screen opens at the connection that plugin was last used in, as the entries of its own sidebar do. Absent: no connection is carried. */
  readonly remembered?: ((plugin: string) => Route | undefined) | undefined;
  /**
   * What each mounted page published for the frame around it, by `routeKey` (the host's `frames`): the scope lane is where the shell knows the NAME of a connection. A route carries a connection by its key, which is not for
   * reading; the palette says the text of the lane's face marked as the connection, or labelled Connection in a plugin built before the marker (`connectionName.ts`), and no connection when none is known. Absent: no name is known, so no row says a connection.
   */
  readonly frames?: Published<FrameV1> | undefined;
  /** What each plugin may ask of the bottom panel: handed to the plugin's commands as `context.panel`. Absent: the commands are given none. */
  readonly panelHosts?: ((plugin: string) => PanelHostV1) | undefined;
  /** Hears the rows a plugin's provider answered that were left out, and why: a problem for its author, said once for each. Default: the console. */
  readonly report?: ((problem: PaletteProblem) => void) | undefined;
  /** What the window knows of the connections of its plugins and what choosing one does (HM1). Absent: the window has none, and no row offers one. */
  readonly connections?: HostConnections | undefined;
};

/** A thing a plugin's provider did that the palette did not take: which provider (`<plugin>:<its own id>`), and a sentence for the plugin's author. */
export type PaletteProblem = { readonly provider: string; readonly message: string };

/** What the shell is given (`PaletteBindings`), and what the host starts once the window is on screen. */
export type HostPalette = PaletteBindings & {
  /**
   * Keeps the palette in step with the window: it remembers the place on screen and each one the user moves to (Recent), and, while the palette is open, makes its list again when the tabs, the
   * plugins or the published nodes change. Answers the function that undoes all of it. A palette that is closed costs nothing: there is no timer, no listener on the document, and nothing here
   * but those subscriptions.
   */
  readonly attach: () => () => void;
  /**
   * Runs a command of the host by its id, as the palette does when a row is chosen: looked up again, and checked against what is true now, immediately before it runs. The app menu's items run through it,
   * and so does `host.search`, which opens the palette and is the one command it never lists.
   */
  readonly run: (command: PaletteCommandRef) => PaletteCommandOutcome | Promise<PaletteCommandOutcome>;
};

/** What the model calls the host's own sources, and the plugin it says owns them. */
const OWN = { plugin: 'host', pluginName: 'Omniview' } as const;

const UNSAVED = 'This tab has unsaved changes.';
/** The app menu's Close Window. Only a Mac has it, and only a Mac is offered the command. */
const CLOSE_WINDOW_CHORD = '⌘⇧W';
/** A browser tab keeps Command or Control J for itself, so the shell also binds Control Option (Control Alt): that is the chord that works where the window is not the app's own, and the one said there. */
const WEB_TOGGLE_CHORD = { mac: '⌃⌥J', other: 'Ctrl+Alt+J' } as const;
/** The most distinct things the host says of one plugin's sidebar, whatever the plugin does next (`tell`). */
const MAX_SAID = 8;

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

/** What the host says to a plugin's author about the entries of its sidebar: the plugin's entry in the store (so a plugin that is loaded again is told again) and a sentence. */
type Tell = (entry: PluginEntry, message: string) => void;

/**
 * Two page rows of different plugins that would read alike (the same title and the same words under it) are told apart by the plugin's name, put first ("Acme · Group", "Acme · north · Group"): on those rows only, in the text the row
 * draws and so in the name a screen reader reads. It is the rule a session tab's scope follows when two tabs read alike: said when it is needed, so it is judged on the rows the source lists and never on the query. The name does not tell
 * apart two plugins of one name, nor two pages of one plugin: such rows read as they did. `owners` is the name of the plugin each page row (by its place in `rows`) belongs to.
 */
function tellApart(rows: PaletteCandidate[], owners: ReadonlyMap<number, string>): PaletteCandidate[] {
  const reading = new Map<string, number[]>();
  for (const index of owners.keys()) {
    const row = rows[index];
    if (row !== undefined) {
      const key = JSON.stringify([row.title, row.context ?? '']);
      reading.set(key, [...(reading.get(key) ?? []), index]);
    }
  }

  for (const alike of reading.values()) {
    if (new Set(alike.map((index) => owners.get(index))).size < 2) {
      continue;
    }

    for (const index of alike) {
      const row = rows[index];
      if (row !== undefined) {
        rows[index] = { ...row, context: placesOf([owners.get(index) ?? '', row.context ?? '']) };
      }
    }
  }

  return rows;
}

/**
 * The rows of the pages source. For each plugin, ready ones first in the order of the rail and then the others as the source lists them: its home, then a row for each page its sidebar opens.
 * A plugin that is not ready has its home alone: that opens a page that says what is wrong, and the model draws the row as Degraded. The home says where it is: its page's title when that is
 * not the plugin's name again. The sidebar's entry for the home is not a second row: its label is said by the home instead, when the home had nothing to say, and found by it, and so are its keywords.
 *
 * A page's row says where it is as the design lab's kind rows do (`shell-search.js`, `connectionRows`: `where(place)` is the connection and a place, or the place alone): the groups it sits in ("Workloads"), with the
 * connection it opens in before them, by its NAME (`connectionNameOf`: never the key the route carries), unless a chip has narrowed the palette to that connection (it says it); a page that sits in no group says the connection
 * alone, chip or none (the design lab says "Cluster" there: a group only its plugin can name, so the host makes none up), and the plugin's name only for a page with neither. A connection no lane names is not said. Rows of different plugins that would read alike are told apart (`tellApart`). One route is one row, as in the design lab
 * (`gotoCandidates`: "the same destination offered twice is one row that keeps the context and the keywords either one gave"): an entry the sidebar names twice is listed once, with the keywords and the group names of both and the first group there was to say. The open tab
 * of a page is a row of the tabs source besides, and not this one's business. The keywords of an entry are the other names its page is known by (`contract/sidebarKeywords.ts`): the row's aliases, which the model
 * ranks as names and never draws.
 */
function pagesOf({ tabs, plugins, contributions, nodes, frames, remembered }: HostPaletteDeps, scope: PaletteScope, tell: Tell): PaletteCandidate[] {
  const only = scope.plugin;
  const entries = plugins.getSnapshot();
  const rail = railOf(entries);
  const glyphs = new Map([...rail, ...failedOf(entries)].map((entry) => [entry.id, entry.icon]));
  const wanted = inRailOrder(entries).filter((entry) => only === null || entry.id === only);
  const active = activeRoute(tabs);
  const onScreen = active?.plugin;
  const rows: PaletteCandidate[] = [];
  const owners = new Map<number, string>();
  for (const entry of wanted) {
    // A page of a plugin that is not on screen opens at the connection that plugin was last used in (the tab model gives a page the connection of the tab it is opened from, and that tab is another plugin's).
    const last = onScreen === entry.id ? undefined : remembered?.(entry.id);
    const connection = last === undefined ? undefined : connectionOf(last);
    // The route the page opens from: the tab on screen's when the plugin is on screen, else the one the plugin was last shown at. Its connection is a KEY, which a chip may already name (the chip's id); what a row says is the NAME the
    // page's lane gave it, and no connection when none is known. A row says it before its groups unless a chip has narrowed the palette to that connection and says it already (a palette keeps its chips when the tab moves on,
    // so a chip of another connection does not say it); a page that sits in no group says it whatever the chip says, as there is nothing else for it to say.
    const from = onScreen === entry.id ? active : last;
    const opensIn = from === undefined ? undefined : connectionOf(from);
    const opensAs = connectionNameOf(frames, from);
    const said = scope.scope !== null && scope.scope.id === opensIn ? undefined : opensAs;
    const name = entry.phase === 'ready' ? entry.contribution.plugin.name : entry.name;
    const input = contributions.home?.(entry.id);
    const home = input === undefined ? undefined : normaliseRoute(input);
    const title = home === undefined ? '' : (contributions.describe(home)?.title ?? '').trim();
    let context = title.toLowerCase() === name.toLowerCase() ? '' : title;
    const found = [name, title];
    const homeWords: string[] = [];
    const pages = new Map<string, { readonly node: SidebarNodeV1; groups: readonly string[]; readonly route: Route; readonly words: string[]; readonly places: string[] }>();
    const leaves = entry.phase === 'ready' ? leavesOf(openable(nodes.get(entry.id) ?? entry.contribution.sidebar.nodes, entry.contribution.pages)) : [];
    for (const { node, groups } of leaves) {
      // What an entry opens (KL5): a page with the parameters it opens with is that place, one row for each place; an entry that opens a connection is no page (the palette lists the plugin's connections itself).
      const opens = readTarget(node);
      const plain = 'target' in opens && opens.target.kind === 'page' ? normaliseRoute({ plugin: entry.id, contribution: opens.target.page, params: opens.target.params }) : undefined;
      if (plain === undefined) {
        continue;
      }

      const route: Route = connection === undefined ? plain : { ...plain, params: { ...plain.params, connection } };
      const read = readKeywords(node);
      for (const problem of read.problems) {
        tell(entry, problem);
      }

      if (home !== undefined && routeKey(plain) === routeKey(home)) {
        found.push(node.label);
        homeWords.push(...read.words);
        context = context === '' && node.label.toLowerCase() !== name.toLowerCase() ? node.label : context;
      } else {
        const same = pages.get(routeKey(plain));
        if (same === undefined) {
          pages.set(routeKey(plain), { node, groups, route, words: [...read.words], places: [...groups] });
        } else {
          // The row keeps what either entry gave: the words of both, the groups of both as words it is found by, and the first group there was to say (a page named at the top and again in a group is in the group).
          same.words.push(...read.words);
          same.places.push(...groups);
          if (same.groups.length === 0) {
            same.groups = groups;
          }
        }
      }
    }

    if (home !== undefined) {
      rows.push({ id: `home:${entry.id}`, kind: 'home', noun: 'Plugin home', title: name, icon: glyphs.get(entry.id) ?? DEFAULT_RAIL_ICON, tone: 'neutral', route: home, context, keywords: wordsOf(found), aliases: wordsOf(homeWords), order: rows.length });
    }

    for (const { node, groups, route, words, places } of pages.values()) {
      owners.set(rows.length, name);
      rows.push({
        id: `page:${entry.id}:${node.id}`,
        kind: 'page',
        noun: 'Page',
        title: node.label,
        icon: node.icon,
        tone: 'neutral',
        route,
        context: groups.length === 0 ? (opensAs ?? name) : placesOf([said ?? '', groups.join(' › ')]) || name,
        keywords: wordsOf([name, ...places]),
        aliases: wordsOf(words),
        order: rows.length,
      });
    }
  }

  return tellApart(rows, owners);
}

/**
 * The name the scope lane the page at `route` published says for its connection (`connectionName.ts`: the face marked as the connection, else the one labelled Connection). A route that names a connection has its face made by
 * `contributions.describe`, which says the name and never the key; this reads the lane for a route that names none (the plugin reads its own connection, and its page says which), and for a row of a page that was not drawn.
 * `undefined` when none is known: a row then says no connection.
 */
function connectionNameOf(frames: Published<FrameV1> | undefined, route: Route | undefined): string | undefined {
  return route === undefined ? undefined : (laneNameOf(frames?.get(routeKey(route))?.scope) ?? undefined);
}

/**
 * The rows of the tabs source: each open tab in the strip's order, naming the tab as the tab model does and carrying its route, so a tab of a plugin that did not load is Degraded. Where it is
 * reads as the design lab's does: the crumbs of its path between the plugin's name and the page's own title, then its scope, and the tab on screen is marked. The mark is drawn and never
 * matched, so a search for those words does not find the one tab that holds them.
 */
function tabsOf({ tabs, plugins, frames }: HostPaletteDeps, only: string | null): PaletteCandidate[] {
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
    // The face the tab model made says the connection by its name or not at all (`contributions.describe`): the crumbs above the page's own, then the scope. A route that carries no key has no scope, and its page's lane says
    // the connection it is read in.
    const above = identity.path.slice(0, -1).map((crumb) => crumb.label);
    if (above[0]?.toLowerCase() === pluginName.toLowerCase()) {
      above.shift();
    }

    const page = route.kind === 'extension-view' ? undefined : route;
    const where = placesOf([above.join(' › '), connectionNameOf(frames, page) ?? tab.face.scope?.label ?? '']);
    rows.push({
      id,
      kind: 'tab',
      noun: 'Tab',
      title: identity.title,
      icon: tab.face.icon,
      tab: id,
      // A tab whose plugin is gone can still be switched to (the strip does, and its page says what happened): its row names no destination, so it is not refused as one.
      route: installed.has(route.plugin) ? page : undefined,
      context: state.active === id ? placesOf([where, 'Current tab']) : where,
      matchContext: where,
      keywords: wordsOf([pluginName === '' ? route.plugin : pluginName, page?.contribution ?? identity.title]),
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
 * The commands the host can run from here, made from what is true now: the tab commands (`shell/tabs/commands.ts`, the tab context menu's too), Toggle panel (when there is a panel), New terminal and the Terminal's screen reader switch (when the window has the Terminal tool), Settings (when the window has them),
 * Close window (only on a Mac, and only when the app can close its window: elsewhere the main window hides and nothing brings it back, decision A17). The palette lists them and the runner looks them
 * up here, so what it runs is what it checked a moment before.
 */
function commandsOf({ tabs, panel, platform, onCloseWindow, openSettings, terminalScreenReader, newTerminal, terminalPanes }: HostPaletteDeps): HostCommand[] {
  // The app's own window gets the chords the shell binds natively; a browser tab keeps those for itself, and the shell's Control Option chords are what work there.
  const native = onCloseWindow !== undefined;
  const tabRows = tabCommands({ tabs, platform, native }, tabs.getSnapshot().active);
  const commands: HostCommand[] = TAB_PALETTE_COMMANDS.map((id) => ({
    id: `host.tab.${id}`,
    title: tabRows[id].title,
    context: 'Tabs',
    icon: tabRows[id].icon,
    shortcut: tabRows[id].shortcut,
    unavailable: tabRows[id].unavailable,
    run: () => outcomeOf(tabRows[id].run()),
  }));
  if (panel !== undefined) {
    commands.push({
      id: 'host.panel.maximize',
      title: 'Toggle maximized panel',
      context: 'Panel',
      icon: 'external-link',
      shortcut: maximizeChordText(platform, native),
      run: () => {
        togglePanelMaximized(panel);
        return true;
      },
    });
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

  if (newTerminal !== undefined) {
    commands.push({
      id: 'host.terminal.new',
      title: NEW_TERMINAL,
      context: 'Panel',
      icon: TERMINAL_TOOL.icon,
      run: () => {
        newTerminal();
        return true;
      },
    });
  }

  if (panel !== undefined && terminalPanes === true) {
    // Made from what is true now (the palette asks when it opens): a Terminal that shows one terminal has no pane to go to and no sash, and the commands are not listed.
    const layout = panel.selectors.paneLayout(panel.getSnapshot(), TERMINAL_TOOL_ID);
    const several = layout !== null && layout.panes.length > 1;
    // The palette gives the keyboard back to where it was when it closes, so what moves it runs one task later, when the palette is gone (as Settings does).
    const later = (act: () => void): boolean => {
      panel.show({ tool: TERMINAL_TOOL_ID });
      setTimeout(act, 0);
      return true;
    };

    if (several) {
      commands.push(
        { id: 'host.terminal.focusNextPane', title: 'Terminal: Focus Next Pane', context: 'Panel', icon: TERMINAL_TOOL.icon, run: () => later(() => {
          moveToPane(panel, 'next', TERMINAL_TOOL_ID);
        }) },
        { id: 'host.terminal.focusPreviousPane', title: 'Terminal: Focus Previous Pane', context: 'Panel', icon: TERMINAL_TOOL.icon, run: () => later(() => {
          moveToPane(panel, 'previous', TERMINAL_TOOL_ID);
        }) },
        { id: 'host.terminal.resizePane', title: 'Terminal: Resize Pane…', context: 'Panel', icon: TERMINAL_TOOL.icon, run: () => later(() => {
          focusSashOfActivePane(panel, TERMINAL_TOOL_ID);
        }) },
        { id: 'host.terminal.equalisePanes', title: 'Terminal: Equalise Panes', context: 'Panel', icon: TERMINAL_TOOL.icon, run: () => later(() => {
          equaliseTool(panel, TERMINAL_TOOL_ID);
        }) },
      );
    }
  }

  if (terminalScreenReader !== undefined) {
    commands.push({
      id: 'host.terminal.toggleScreenReader',
      title: SCREEN_READER_COMMAND,
      context: 'Panel',
      icon: TERMINAL_TOOL.icon,
      // The palette is a modal dialog while this runs: the rest of the window, its live region with it, is outside the accessibility tree until the palette is gone, and a change in a region that is not there is not heard.
      // One task later the palette is gone, so what the choice came to is said then, once.
      run: () => {
        const on = terminalScreenReader.toggle();
        setTimeout(() => {
          terminalScreenReader.say(screenReaderSaid(on));
        }, 0);
        return true;
      },
    });
  }

  if (openSettings !== undefined) {
    commands.push({
      id: 'host.settings.open',
      title: 'Settings',
      context: 'Window',
      icon: 'settings',
      shortcut: native ? settingsChordText(platform) : WEB_SETTINGS_CHORD[platform],
      // The palette gives the focus back to where it was when it closes, and the sheet gives it back to what had it when it opened: opened now, that would be the palette's input. One task later the palette
      // is gone and the focus is where the person was, so the sheet remembers that.
      run: () => {
        setTimeout(openSettings, 0);
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

  // The host's own pages (Plugins, Home): Plugins opens in its singleton tab wherever the person is (ch16 S9, S26) and is shown, as any other tab, if it is already open; Home is an ordinary tab and the command opens a new one every
  // time, as the design lab's does (`openHostPage`, `plain: 'new'`, shell-regions.js).
  for (const page of allHostPages()) {
    commands.push({
      id: `host.${page.id}`,
      title: page.title,
      context: 'Window',
      icon: page.icon,
      run: () => {
        const opened = tabs.open({ route: { plugin: HOST_PLUGIN, contribution: page.id } }, { how: page.singleton === false ? 'new' : 'smart', source: 'command' });
        return opened.status === 'refused' ? { ok: false, reason: opened.message } : true;
      },
    });
  }

  return commands;
}

/** The route of the tab on screen: the same object until the tab moves. */
function activeRoute(tabs: TabsStore): Route | undefined {
  const state = tabs.getSnapshot();
  const route = state.active === null ? undefined : state.tabs[state.active]?.location.route;
  return route?.kind === 'extension-view' ? undefined : route;
}

/** The command a connection's row runs: the plugin and the connection's key are its argument. */
const GO_CONNECTION = 'host.connection.go';

/**
 * A row for each connection of each plugin that is ready (HM1): found by its NAME, saying the plugin and the state it is in, and by the words "connection" and "switch". Choosing one runs `host.connection.go`: the tab on screen goes to it when
 * the tab is the plugin's, else a tab opens at the plugin's first page in it, and a connection that is not connected is started first, with the palette saying why when it cannot be. A palette narrowed to one connection lists none: they are
 * what that chip chose from.
 */
function connectionsOf({ plugins, connections }: HostPaletteDeps, scope: PaletteScope): PaletteCandidate[] {
  if (connections === undefined || scope.scope !== null) {
    return [];
  }

  const rail = new Map(railOf(plugins.getSnapshot()).map((entry) => [entry.id, entry]));
  return connections.store.getSnapshot().connections.flatMap((connection, order): PaletteCandidate[] => {
    const entry = rail.get(connection.plugin);
    if (entry === undefined || (scope.plugin !== null && scope.plugin !== connection.plugin)) {
      return [];
    }

    return [
      {
        id: `${connection.plugin}:${connection.key}`,
        kind: 'command',
        noun: 'Connection',
        title: connection.name,
        context: placesOf([entry.label, faceOf(connection.state).word]),
        icon: 'server',
        tone: 'neutral',
        keywords: wordsOf([entry.label, 'connection', 'switch connection', 'go to connection']),
        command: { id: GO_CONNECTION, arg: { plugin: connection.plugin, connection: connection.key } },
        order,
      },
    ];
  });
}

/**
 * The host's palette: the announcer and the store the shell draws, with the host's sources registered in the store and the tab model, the plugins and the commands behind its seam. The window
 * calls `attach` once it is on screen.
 */
export function createHostPalette(deps: HostPaletteDeps): HostPalette {
  const { tabs, plugins, contributions, nodes, frames, platform } = deps;
  /**
   * What the model is told of a place when it lists Recent: the plugin's description, which says a connection by its name or not at all (`contributions.describe`). A route that carries no key has no scope, but its page's lane
   * still says which connection it is read in, as Go to and Tabs say it: Recent says it too, in a scope that has no key to give.
   */
  const described = (route: Route): Description | undefined => {
    const description = contributions.describe(route);
    const named = description === undefined || connectionOf(route) !== undefined ? undefined : connectionNameOf(frames, route);
    return description === undefined || named === undefined ? description : { ...description, scope: { id: '', label: named } };
  };

  const announcer = createAnnouncer();
  // The command is looked up again, and checked against what is true now, immediately before it runs: the palette may have listed it a moment ago, and the host answers for the rest. The app menu runs its items through it too.
  const run = (command: PaletteCommandRef): PaletteCommandOutcome | Promise<PaletteCommandOutcome> => {
    // The app menu's Search opens the palette, as its chord does. The palette never lists it: it is open when a person could choose it.
    if (command.id === 'host.search') {
      store.open(opening());
      return true;
    }

    const found = commandsOf(deps).find((candidate) => candidate.id === command.id);
    if (found !== undefined) {
      return found.unavailable === undefined ? found.run() : { ok: false, reason: found.unavailable };
    }

    // A connection's row: the host starts the connection when it is not connected and goes to it, and the palette says why when it could not (the row is inert while it runs; a failure leaves the palette open for another choice).
    if (command.id === GO_CONNECTION) {
      // The argument is the row's own: `{ plugin, connection }`, copied and frozen by the model, and read here as data again because the plugin that was listed may have left.
      const given: Readonly<Record<string, unknown>> | undefined = typeof command.arg === 'object' && command.arg !== null && !Array.isArray(command.arg) ? (command.arg as Readonly<Record<string, unknown>>) : undefined;
      const target = given?.plugin;
      const connection = given?.connection;
      if (deps.connections === undefined || typeof target !== 'string' || typeof connection !== 'string') {
        return { ok: false, reason: 'This command is not available.' };
      }

      return deps.connections.actions.goOrSwitch(target, connection).then((result): PaletteCommandOutcome => (result.ok ? true : { ok: false, reason: result.reason }));
    }

    // A command a plugin's row names, by the id the plugin and the command make together: the plugin may have left since the row was listed.
    const plugin = commandOf(plugins.getSnapshot(), command.id);
    if (plugin === undefined) {
      return { ok: false, reason: 'This command is not available.' };
    }

    return runCommand(plugin, command.arg, deps.panelHosts?.(plugin.plugin), (error) => {
      console.error(`[palette] ${plugin.plugin}:${plugin.local} failed`, error);
    });
  };

  const store = createPaletteStore({
    // What the tab model made of the open (the route with the connection the tab was given) is what is remembered, whichever tab it opened, so a place is remembered as it was reached and not as its row named it.
    open: (destination, options) => {
      const result = tabs.open(destination, options);
      if (result.status === 'done') {
        const route = tabs.getSnapshot().tabs[result.id]?.location.route;
        if (route !== undefined && route.kind !== 'extension-view') {
          store.record({ route, kind: 'page' });
        }
      }

      return result;
    },
    recordOpens: false,
    activate: tabs.activate,
    availability: contributions.availability,
    describe: described,
    announce: announcer.announce,
    platform,
    windows: tabs.windows !== undefined,
    run,
  });

  const report = deps.report ?? ((problem: PaletteProblem): void => {
    console.warn(`[palette] ${problem.provider}: ${problem.message}`);
  });

  // What a plugin's sidebar did wrong that the pages source left out (a keyword that is not valid): said to the plugin's author once for each sentence, and at most `MAX_SAID` for one load of the plugin, because the
  // source is asked on every keystroke and a hook that is wrong in a new way on every render is not to be said a thousand times. The plugin's entry in the store is the key: a plugin that is loaded again is told again.
  const told = new WeakMap<PluginEntry, Set<string>>();
  const tell: Tell = (entry, message) => {
    const said = told.get(entry) ?? new Set<string>();
    told.set(entry, said);
    if (said.size < MAX_SAID && !said.has(message)) {
      said.add(message);
      report({ provider: `${entry.id}:sidebar`, message });
    }
  };

  const sources: readonly PaletteSource[] = [
    { id: 'host:pages', ...OWN, title: 'Pages', section: 'goto', match: (_query, scope) => pagesOf(deps, scope, tell) },
    { id: 'host:tabs', ...OWN, title: 'Tabs', section: 'tabs', match: (_query, scope) => tabsOf(deps, scope.plugin) },
    { id: 'host:connections', ...OWN, title: 'Connections', section: 'goto', match: (_query, scope) => connectionsOf(deps, scope) },
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

  // The plugins' providers. What is registered is the contribution each plugin's providers were made of, so a plugin whose contribution is the same object as before is left alone, one that was replaced has its
  // providers made again, and one that is not ready (or is gone) has none. `attached` counts the windows that keep the palette current: the providers stay until the last one is undone, and none are registered before the first.
  // The model keeps sections that match equally in the order their providers were registered in, and what Enter opens is the first row: so the plugins are registered in the order of the rail (`inRailOrder`, R2), which is
  // the same on every run, and never in the order they happened to finish loading (a race between two plugins decided what a plain Enter opened, from one run to the next).
  const registered = new Map<string, ContributionV1>();
  const refused = new WeakSet<ContributionV1>();
  let attached = 0;

  const withdraw = (plugin: string): void => {
    // The host's own sources are registered under this id too, and no plugin's leaving may take them.
    if (registered.delete(plugin) && plugin !== OWN.plugin) {
      store.removePlugin(plugin);
    }
  };

  const syncProviders = (): void => {
    if (attached === 0) {
      return;
    }

    const entries = plugins.getSnapshot();
    const rail = railOf(entries);
    const wanted: Ready[] = [];
    for (const entry of inRailOrder(entries)) {
      if (entry.phase !== 'ready' || entry.contribution.palette === undefined) {
        continue;
      }

      if (entry.id === OWN.plugin) {
        // A plugin called host would have its providers asked whatever the palette is narrowed to, and `removePlugin` would take the host's own sources with it.
        if (!refused.has(entry.contribution)) {
          refused.add(entry.contribution);
          for (const local of Object.keys(entry.contribution.palette.providers ?? {})) {
            report({ provider: `${entry.id}:${local}`, message: 'the plugin\'s id is "host", which names the palette\'s own sources: its providers are not registered' });
          }
        }

        continue;
      }

      wanted.push(entry);
    }

    // A plugin that is gone, or no longer brings providers, leaves: the others keep their place.
    const live = new Set(wanted.map((entry) => entry.id));
    for (const plugin of [...registered.keys()]) {
      if (!live.has(plugin)) {
        withdraw(plugin);
      }
    }

    // From the first plugin whose registration is not the one the rail's order puts there, the plugins are registered again in that order. A plugin that arrives behind the others (the usual case) is the only one
    // registered; one that arrives ahead of others has them registered again after it, and their sections are asked once more.
    const order = [...registered.keys()];
    let kept = 0;
    for (const entry of wanted) {
      if (order[kept] !== entry.id || registered.get(entry.id) !== entry.contribution) {
        break;
      }

      kept += 1;
    }

    for (const plugin of order.slice(kept)) {
      withdraw(plugin);
    }

    for (const entry of wanted.slice(kept)) {
      const icon = rail.find((candidate) => candidate.id === entry.id)?.icon;
      const tell = (provider: string, message: string): void => {
        report({ provider, message });
      };

      for (const source of providersOf(entry, { icon, report: tell })) {
        const registration = store.registerProvider(source);
        if (!registration.ok) {
          report({ provider: source.id, message: registration.reason });
        }
      }

      registered.set(entry.id, entry.contribution);
    }
  };

  /** The route on screen, and the chips that narrow the search to the tab's own plugin and scope when that plugin is ready (ch16 S69). */
  const opening = (): OpenPalette => {
    const state = tabs.getSnapshot();
    const tab = state.active === null ? undefined : state.tabs[state.active];
    if (tab === undefined) {
      return { current: undefined, scope: [] };
    }

    const entries = plugins.getSnapshot();
    const current = tab.location.route.kind === 'extension-view' ? undefined : tab.location.route;
    const entry = entries.find((candidate) => candidate.id === tab.location.route.plugin);
    if (entry?.phase !== 'ready') {
      return { current, scope: [] };
    }

    const pluginIcon = railOf(entries).find((candidate) => candidate.id === entry.id)?.icon;
    const { scope } = tab.face;
    // The chips say the connection by its name; its key stays the chip's id, which is what a plugin's provider is asked with. With no name known the palette is narrowed to the plugin alone: a chip would have to say the key.
    const named = connectionNameOf(frames, current) ?? (scope === undefined || scope.label === '' ? undefined : scope.label);
    const chips = seedChips({ plugin: entry.id, pluginName: entry.contribution.plugin.name, pluginIcon, scope: scope === undefined ? undefined : { id: scope.id, label: named ?? scope.label } });
    return { current, scope: named === undefined ? chips.slice(0, 1) : chips };
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

    attached += 1;
    syncProviders();
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
        syncProviders();
        remember(activeRoute(tabs));
        refresh();
      }),
      nodes.subscribe(refresh),
      // A connection that connects, fails or appears while the palette is open changes its rows: the state each says.
      ...(deps.connections === undefined ? [] : [deps.connections.store.subscribe(refresh)]),
      ...(frames === undefined ? [] : [frames.subscribe(refresh)]),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }

      attached -= 1;
      if (attached === 0) {
        for (const plugin of [...registered.keys()]) {
          withdraw(plugin);
        }
      }

      // A palette that is open when the window goes is closed with it: nothing of it outlives the subscriptions that kept it current.
      store.close();
    };
  };

  return { store, announcer, opening, attach, run };
}
