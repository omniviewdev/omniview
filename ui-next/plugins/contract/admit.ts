import { isExtensionIdSegment } from '@omniviewdev/runtime/internal/extensions-v1';
import { ContractError } from '../loader/failure';
import { PALETTE_LIMITS } from './paletteRows';
import { dressed, dressProblems, readTarget } from './sidebarTargets';
import type { ContributionV1, SidebarNodeV1 } from './v1';

// Admission: what a bundle's exports must be before the host builds anything from them. A bundle is plugin code, and what it hands over is
// `unknown` until this says otherwise; the checks are the shape the host reads, not a style. Pure: no React, no registry, no I/O.
//
// What it cannot check, and who does: that an `icon` is a glyph the kit has (the kit exports no list of names, so a name from a newer kit renders
// nothing useful and its component throws: the sidebar's boundary contains it); that a hook behaves (the boundary around the page); that the types the
// plugin was compiled against are the types it runs with (the API report, strategy R11).

/** The export of contract v1 in a bundle. */
export const CONTRIBUTION_EXPORT_V1 = 'contributionV1';

/** The glyph colours the shell accepts (`ShellAccent`). */
const ACCENTS: Readonly<Record<string, true>> = { orange: true, green: true, blue: true, purple: true, pink: true, red: true, teal: true };

/** Enough problems to fix a bundle, few enough to read in a log line. */
const MAX_PROBLEMS = 8;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isFunction = (value: unknown): boolean => typeof value === 'function';

type Problems = string[];

/**
 * What an entry's count may be: absent, a number (as it always was), `null` (the entry has a count slot and no number yet) or an approximate count. Whether a number is a count (a whole number of at least zero) is not
 * checked: it never was, and the shell draws a number that is not one as an empty slot. A bundle written before the last two shapes is admitted; one that writes them is refused by a host that predates them, by this check's older words.
 */
function isCount(count: unknown): boolean {
  return count === undefined || count === null || typeof count === 'number' || (isRecord(count) && count.approximate === true && typeof count.value === 'number');
}

/** A leaf of the skeleton and the page it opens: the leaf's `id` unless it names another with `page`. A leaf that opens a connection opens no page, and is not here. */
type Leaf = { readonly id: string; readonly page: string };

function checkNodes(nodes: unknown, where: string, problems: Problems, seen: Set<string>, leaves: Leaf[]): void {
  if (!Array.isArray(nodes)) {
    problems.push(`${where} is not a list`);
    return;
  }

  nodes.forEach((node: unknown, index) => {
    const at = `${where}[${String(index)}]`;
    if (!isRecord(node)) {
      problems.push(`${at} is not an object`);
      return;
    }

    const id = node.id;
    if (!isText(id)) {
      problems.push(`${at}.id is not a non-empty string`);
    } else if (seen.has(id)) {
      problems.push(`${at}.id "${id}" is used twice`);
    } else {
      seen.add(id);
    }

    if (!isText(node.label)) {
      problems.push(`${at}.label is not a non-empty string`);
    }

    if (!isText(node.icon)) {
      problems.push(`${at}.icon is not a glyph name`);
    }

    if (!isCount(node.count)) {
      problems.push(`${at}.count is not a number, null, or { value, approximate: true }`);
    }

    // How a row is dressed (KL5): a badge and a colour the shell can draw. A group is dressed as an entry is.
    for (const problem of dressProblems(node as SidebarNodeV1)) {
      problems.push(`${at}.${problem}`);
    }

    const children = node.children;
    if (children === undefined) {
      // A leaf opens a page (its `id`'s, or the one `page` names, with the parameters it opens with) or a connection (KL5); a group opens nothing, whatever else it names.
      const read = readTarget(node as SidebarNodeV1);
      if ('problem' in read) {
        problems.push(`${at}.${read.problem}`);
      } else if (read.target.kind === 'page' && isText(id)) {
        leaves.push({ id, page: read.target.page });
      }
    } else {
      checkNodes(children, `${at}.children`, problems, seen, leaves);
    }
  });
}

/** A detail page: the page of one object. */
const isDetail = (page: unknown): boolean => isRecord(page) && page.kind === 'detail';

/** What draws a custom page's Body: a function (a component), or the object React makes of one (`memo`, `forwardRef`, `lazy`), which is no function and carries React's own symbol. */
const isComponent = (value: unknown): boolean => isFunction(value) || (isRecord(value) && typeof value.$$typeof === 'symbol');

/** What a page's tile must say: the glyph of its kind, before the heading. A detail page and an overview page have the same one. */
function checkTile(definition: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  const tile = definition.tile;
  if (!isRecord(tile) || !isText(tile.icon)) {
    problems.push(`${at}.tile needs an icon`);
  }
}

/** The in-page tabs of a page that has them (a detail page, an overview page): at least one, each with an id and a label, and no id twice. The page draws its strip from them before any data is read. */
function checkTabs(definition: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  const tabs = definition.tabs;
  if (!Array.isArray(tabs) || tabs.length === 0) {
    problems.push(`${at}.tabs is not a list with a tab in it`);
    return;
  }

  const seen = new Set<string>();
  tabs.forEach((tab: unknown, index) => {
    if (!isRecord(tab) || !isText(tab.id) || !isText(tab.label)) {
      problems.push(`${at}.tabs[${String(index)}] needs an id and a label`);
    } else if (seen.has(tab.id)) {
      problems.push(`${at}.tabs[${String(index)}].id "${tab.id}" is used twice`);
    } else {
      seen.add(tab.id);
    }
  });
}

/** What a detail page's static definition must say: the words and the identity the host draws its heading, its tab and its strip from, before any data is read. */
function checkDetailDefinition(definition: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  if (!isText(definition.kind)) {
    problems.push(`${at}.kind is not a non-empty string`);
  }

  checkTile(definition, at, problems);

  const identity = definition.identity;
  if (!isRecord(identity) || !isText(identity.name)) {
    problems.push(`${at}.identity needs a name: the route parameter that holds it`);
  } else if (identity.facets !== undefined && !(Array.isArray(identity.facets) && identity.facets.every(isText))) {
    problems.push(`${at}.identity.facets is not a list of parameter names`);
  }

  const list = definition.list;
  if (list !== undefined && !(isRecord(list) && isText(list.page) && isText(list.label))) {
    problems.push(`${at}.list needs a page and a label`);
  }

  checkTabs(definition, at, problems);
}

/** What an overview page's static definition must say: the page's name, its tile and its tabs. It has no identity and no list: it is the page of a scope, and nothing leads back above it. */
function checkOverviewDefinition(definition: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  if (!isText(definition.title)) {
    problems.push(`${at}.title is not a non-empty string`);
  }

  checkTile(definition, at, problems);
  checkTabs(definition, at, problems);
}

/** What a custom page must say: where it is read, its tab's words and glyph, who scrolls it (optional) and the component that draws it. It has no definition and no data hook: the plugin draws the whole page. */
function checkCustomPage(page: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  if (page.scope !== 'plugin' && page.scope !== 'connection') {
    problems.push(`${at}.scope is "${String(page.scope)}", and a custom page is read in the "plugin" or in a "connection"`);
  }

  if (!isText(page.title)) {
    problems.push(`${at}.title is not a non-empty string`);
  }

  if (!isText(page.icon)) {
    problems.push(`${at}.icon is not a glyph name`);
  }

  if (page.layout !== undefined && page.layout !== 'document' && page.layout !== 'pane') {
    problems.push(`${at}.layout is neither "document" nor "pane"`);
  }

  if (!isComponent(page.Body)) {
    problems.push(`${at}.Body is not a component`);
  }
}

/** A detail page's list is a list page of this contribution: its crumb and its sidebar entry would lead nowhere otherwise. */
function checkListOf(page: unknown, pages: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  if (!isDetail(page) || !isRecord(page) || !isRecord(page.definition) || !isRecord(page.definition.list)) {
    return;
  }

  const target = page.definition.list.page;
  const listed = typeof target === 'string' && Object.hasOwn(pages, target) ? pages[target] : undefined;
  if (isText(target) && !(isRecord(listed) && listed.kind === 'list')) {
    problems.push(`${at}.definition.list.page "${target}" is not a list page of this contribution`);
  }
}

/**
 * The landing is a custom page of scope `plugin`: the page the window opens when the plugin is opened and no connection is named, which is read in none. One sentence says what the key named instead. A page of a kind this version does not know, or of a scope it does not
 * know, has its own problem and is not said again here.
 */
function checkLanding(landing: unknown, pages: Readonly<Record<string, unknown>>, problems: Problems): void {
  const said = String(landing);
  if (typeof landing !== 'string' || !Object.hasOwn(pages, landing)) {
    problems.push(`landing "${said}" is not one of the pages`);
    return;
  }

  const page = pages[landing];
  if (!isRecord(page)) {
    return;
  }

  if (page.kind === 'list' || page.kind === 'detail' || page.kind === 'overview') {
    problems.push(`landing "${landing}" is ${page.kind === 'overview' ? 'an overview' : `a ${page.kind}`} page: a landing is a custom page of scope "plugin"`);
  } else if (page.kind === 'custom' && page.scope === 'connection') {
    problems.push(`landing "${landing}" is a custom page of scope "connection": a landing is read in no connection, so its scope is "plugin"`);
  }
}

function checkPage(page: unknown, at: string, problems: Problems): void {
  if (!isRecord(page)) {
    problems.push(`${at} is not an object`);
    return;
  }

  if (page.kind !== 'list' && page.kind !== 'detail' && page.kind !== 'overview' && page.kind !== 'custom') {
    problems.push(`${at}.kind is "${String(page.kind)}", and this version draws "list", "detail", "overview" and "custom" pages`);
  }

  if (page.kind === 'custom') {
    checkCustomPage(page, at, problems);
    return;
  }

  if (!isFunction(page.usePage)) {
    problems.push(`${at}.usePage is not a function`);
  }

  const definition = page.definition;
  if (!isRecord(definition)) {
    problems.push(`${at}.definition is not an object`);
    return;
  }

  if (page.kind === 'detail') {
    checkDetailDefinition(definition, `${at}.definition`, problems);
    return;
  }

  if (page.kind === 'overview') {
    checkOverviewDefinition(definition, `${at}.definition`, problems);
    return;
  }

  const nouns = definition.nouns;
  if (!isText(definition.title)) {
    problems.push(`${at}.definition.title is not a non-empty string`);
  }

  if (!isRecord(nouns) || !isText(nouns.one) || !isText(nouns.other)) {
    problems.push(`${at}.definition.nouns needs "one" and "other"`);
  }

  if (!Array.isArray(definition.columns) || definition.columns.length === 0) {
    problems.push(`${at}.definition.columns is not a list with a column in it`);
  }

  if (definition.lines !== 1 && definition.lines !== 2) {
    problems.push(`${at}.definition.lines is not 1 or 2`);
  }

  if (!isFunction(definition.getRowKey) || !isFunction(definition.searchText)) {
    problems.push(`${at}.definition needs getRowKey and searchText functions`);
  }
}

/** A plugin brings at most two tools of its own to the panel (ch16 S114: a plugin-specific tool needs the owner's approval and stays under this limit). */
const MAX_PLUGIN_TOOLS = 2;

/** What a tool of the plugin's own must say: its words, its glyph, its body, and optionally a place, a card and a way to start a session. */
function checkPanelTool(tool: unknown, at: string, problems: Problems): void {
  if (!isRecord(tool)) {
    problems.push(`${at} is not an object`);
    return;
  }

  if (!isText(tool.label)) {
    problems.push(`${at}.label is not a non-empty string`);
  }

  if (!isText(tool.icon)) {
    problems.push(`${at}.icon is not a glyph name`);
  }

  if (tool.order !== undefined && !(typeof tool.order === 'number' && Number.isFinite(tool.order))) {
    problems.push(`${at}.order is not a finite number`);
  }

  if (!isFunction(tool.Body)) {
    problems.push(`${at}.Body is not a function`);
  }

  if (tool.card !== undefined && !isFunction(tool.card)) {
    problems.push(`${at}.card is not a function`);
  }

  const fresh = tool.newSession;
  if (fresh !== undefined && !(isRecord(fresh) && isText(fresh.label) && isFunction(fresh.open))) {
    problems.push(`${at}.newSession needs a label and an open function`);
  }
}

/** What a plugin brings to the bottom panel: the shape the host draws it from. Absent is fine: most plugins bring nothing. */
function checkPanel(panel: unknown, problems: Problems): void {
  if (panel === undefined) {
    return;
  }

  if (!isRecord(panel)) {
    problems.push('panel is not an object');
    return;
  }

  const { tools, sessions } = panel;
  if (tools !== undefined) {
    if (!isRecord(tools)) {
      problems.push('panel.tools is not an object');
    } else {
      const ids = Object.keys(tools);
      if (ids.length > MAX_PLUGIN_TOOLS) {
        problems.push(`panel.tools has ${String(ids.length)} tools: a plugin brings at most ${String(MAX_PLUGIN_TOOLS)}`);
      }

      for (const id of ids) {
        if (id.trim() === '' || id.includes(':')) {
          // The host makes the id the panel knows a tool by from the plugin's id and this one, joined with a colon.
          problems.push(`panel.tools.${id} is not a tool id: no colon, not empty`);
          continue;
        }

        checkPanelTool(tools[id], `panel.tools.${id}`, problems);
      }
    }
  }

  if (sessions !== undefined) {
    if (!isRecord(sessions)) {
      problems.push('panel.sessions is not an object');
    } else {
      for (const [id, kind] of Object.entries(sessions)) {
        if (!isRecord(kind)) {
          problems.push(`panel.sessions.${id} is not an object`);
        } else {
          if (kind.card !== undefined && !isFunction(kind.card)) {
            problems.push(`panel.sessions.${id}.card is not a function`);
          }

          if (kind.useMenuOutlet !== undefined && (id !== 'terminal' || !isFunction(kind.useMenuOutlet))) {
            problems.push(`panel.sessions.${id}.useMenuOutlet must be a terminal session hook`);
          }
        }
      }
    }
  }
}

/** An id the host makes another id from, with the plugin's before it and a colon between (a tool's, a provider's, a command's): not empty, no colon, and bounded. */
const isLocalId = (id: string, size: number): boolean => id.trim() !== '' && !id.includes(':') && id.length <= size;

/** One provider of the palette's: how it answers, the heading of its section, and the optional filter and scope test. What it answers is read by `paletteRows.ts` while the palette runs. */
function checkPaletteProvider(provider: unknown, at: string, problems: Problems): void {
  if (!isRecord(provider)) {
    problems.push(`${at} is not an object`);
    return;
  }

  const { kind, section, filter, supports } = provider;
  if (kind !== 'match' && kind !== 'search') {
    problems.push(`${at}.kind is "${String(kind)}", and this version draws "match" and "search" providers`);
    return;
  }

  if (typeof section !== 'string' || section.trim() === '' || section.length > PALETTE_LIMITS.section) {
    problems.push(`${at}.section is not a non-empty string of at most ${String(PALETTE_LIMITS.section)} characters`);
  }

  if (filter !== undefined && filter !== 'goto' && filter !== 'commands') {
    problems.push(`${at}.filter is neither "goto" nor "commands"`);
  }

  if (supports !== undefined && !isFunction(supports)) {
    problems.push(`${at}.supports is not a function`);
  }

  const answers = kind === 'match' ? 'match' : 'search';
  const other = kind === 'match' ? 'search' : 'match';
  if (isFunction(provider[other])) {
    problems.push(`${at} has both match and search: a provider answers one way`);
  }

  if (!isFunction(provider[answers])) {
    problems.push(`${at}.${answers} is not a function`);
  }
}

/** What a plugin brings to the command palette: the shape the host registers its providers and runs its commands from. Absent is fine: most plugins bring nothing. */
function checkPalette(palette: unknown, problems: Problems): void {
  if (palette === undefined) {
    return;
  }

  if (!isRecord(palette)) {
    problems.push('palette is not an object');
    return;
  }

  const { providers, commands } = palette;
  if (providers !== undefined) {
    if (!isRecord(providers)) {
      problems.push('palette.providers is not an object');
    } else {
      const ids = Object.keys(providers);
      if (ids.length > PALETTE_LIMITS.providers) {
        problems.push(`palette.providers has ${String(ids.length)} providers: a plugin brings at most ${String(PALETTE_LIMITS.providers)}`);
      }

      for (const id of ids) {
        if (!isLocalId(id, PALETTE_LIMITS.providerId)) {
          // The host makes the id the palette knows a provider by from the plugin's id and this one, joined with a colon.
          problems.push(`palette.providers.${id} is not a provider id: no colon, not empty, at most ${String(PALETTE_LIMITS.providerId)} characters`);
          continue;
        }

        checkPaletteProvider(providers[id], `palette.providers.${id}`, problems);
      }
    }
  }

  if (commands !== undefined) {
    if (!isRecord(commands)) {
      problems.push('palette.commands is not an object');
    } else {
      for (const [id, command] of Object.entries(commands)) {
        if (!isLocalId(id, PALETTE_LIMITS.commandId)) {
          problems.push(`palette.commands.${id} is not a command id: no colon, not empty, at most ${String(PALETTE_LIMITS.commandId)} characters`);
        } else if (!isRecord(command)) {
          problems.push(`palette.commands.${id} is not an object`);
        } else if (!isFunction(command.run)) {
          problems.push(`palette.commands.${id}.run is not a function`);
        }
      }
    }
  }
}

function checkContribution(value: Readonly<Record<string, unknown>>): Problems {
  const problems: Problems = [];
  const plugin = value.plugin;
  if (!isRecord(plugin) || !isText(plugin.name)) {
    problems.push('plugin.name is not a non-empty string');
  } else if (plugin.accent !== undefined && !(typeof plugin.accent === 'string' && Object.hasOwn(ACCENTS, plugin.accent))) {
    problems.push(`plugin.accent "${typeof plugin.accent === 'string' ? plugin.accent : typeof plugin.accent}" is not one of the shell's colours`);
  }

  const rail = value.rail;
  if (rail !== undefined && rail !== true) {
    if (!isRecord(rail)) {
      problems.push('rail is neither absent, true, nor an entry');
    } else {
      if (!isText(rail.icon)) {
        problems.push('rail.icon is not a glyph name');
      }

      if (rail.label !== undefined && !isText(rail.label)) {
        problems.push('rail.label is not a non-empty string');
      }

      if (rail.order !== undefined && !(typeof rail.order === 'number' && Number.isFinite(rail.order))) {
        problems.push('rail.order is not a finite number');
      }
    }
  }

  checkPanel(value.panel, problems);
  checkPalette(value.palette, problems);

  const leaves: Leaf[] = [];
  const sidebar = value.sidebar;
  if (!isRecord(sidebar)) {
    problems.push('sidebar is not an object');
  } else {
    if (!isText(sidebar.label) || !isText(sidebar.title)) {
      problems.push('sidebar needs a label and a title');
    }

    if (sidebar.useNodes !== undefined && !isFunction(sidebar.useNodes)) {
      problems.push('sidebar.useNodes is not a function');
    }

    if (sidebar.outlet !== undefined && !isExtensionIdSegment(sidebar.outlet)) {
      problems.push('sidebar.outlet is not a local extension point ID');
    }

    // What the sidebar is called on a page that is read in no connection (KL7): each member that is given is a name, and one that is left out is the sidebar's own.
    const scoped = sidebar.pluginScope;
    if (scoped !== undefined && !isRecord(scoped)) {
      problems.push('sidebar.pluginScope is not an object');
    } else if (scoped !== undefined) {
      for (const member of ['label', 'title'] as const) {
        if (scoped[member] !== undefined && !isText(scoped[member])) {
          problems.push(`sidebar.pluginScope.${member} is not a non-empty string`);
        }
      }
    }

    checkNodes(sidebar.nodes, 'sidebar.nodes', problems, new Set<string>(), leaves);
  }

  const pages = value.pages;
  if (!isRecord(pages) || Object.keys(pages).length === 0) {
    problems.push('pages is not an object with a page in it');
  } else {
    for (const [id, page] of Object.entries(pages)) {
      checkPage(page, `pages.${id}`, problems);
      checkListOf(page, pages, `pages.${id}`, problems);
      if (id === '$home') {
        // The sentinel the host's route completion reads as "the plugin's home page" (`HOME_PAGE`): a page with this id could not be reached.
        problems.push('pages.$home is reserved for the home page of the plugin');
      }
    }

    for (const leaf of leaves) {
      if (!Object.hasOwn(pages, leaf.page)) {
        problems.push(leaf.page === leaf.id ? `the sidebar entry "${leaf.id}" opens no page` : `the sidebar entry "${leaf.id}" opens no page "${leaf.page}"`);
      } else if (isDetail(pages[leaf.page])) {
        problems.push(`the sidebar entry "${leaf.id}" opens a detail page, which needs an object`);
      }
    }

    if (typeof value.home !== 'string' || !Object.hasOwn(pages, value.home)) {
      problems.push(`home "${String(value.home)}" is not one of the pages`);
    } else if (isDetail(pages[value.home])) {
      problems.push(`home "${value.home}" is a detail page, which needs an object: the window could not open it`);
    }

    if (value.landing !== undefined) {
      checkLanding(value.landing, pages, problems);
    }
  }

  return problems.slice(0, MAX_PROBLEMS);
}

export type Admission =
  | { readonly ok: true; readonly contribution: ContributionV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The contribution a bundle's exports hold, if they hold one this version understands; else what is wrong. */
export function admit(exports: unknown): Admission {
  if (!isRecord(exports) || !(CONTRIBUTION_EXPORT_V1 in exports)) {
    return { ok: false, problems: [`the bundle exports no ${CONTRIBUTION_EXPORT_V1}`] };
  }

  const value = exports[CONTRIBUTION_EXPORT_V1];
  if (!isRecord(value)) {
    return { ok: false, problems: [`${CONTRIBUTION_EXPORT_V1} is not an object`] };
  }

  const problems = checkContribution(value);
  // Every check above is what makes `value` a ContributionV1: the cast is the one place the host takes the bundle's word for a type, after reading it.
  return problems.length === 0 ? { ok: true, contribution: value as unknown as ContributionV1 } : { ok: false, problems };
}

/** The contribution, or a `ContractError` carrying the problems. */
export function admitOrThrow(exports: unknown): ContributionV1 {
  const admission = admit(exports);
  if (!admission.ok) {
    throw new ContractError(admission.problems);
  }

  return admission.contribution;
}

/**
 * The nodes a hook answered that open something of this contribution, as the shell may draw them: a dynamic entry that opens nothing would be a stub, and a detail page opens nothing without an object. A leaf opens a page of the contribution (its `id`'s or
 * the one `page` names, with its `params`) or one of the plugin's connections (KL5); one that is not a valid way of saying so is left out (`sidebarTargets.ts`: a leaf opens one thing), and what a row is dressed with that the shell cannot draw (a `status` or a
 * `tone` that is not valid) is taken off it and costs the row nothing else. A group that is left with nothing to open is left out.
 */
export function openable(nodes: readonly SidebarNodeV1[], pages: Readonly<Record<string, unknown>>): readonly SidebarNodeV1[] {
  const keep = (node: SidebarNodeV1): SidebarNodeV1 | undefined => {
    if (node.children === undefined) {
      const read = readTarget(node);
      if (!('target' in read)) {
        return undefined;
      }

      const { target } = read;
      if (target.kind === 'page') {
        if (!Object.hasOwn(pages, target.page) || isDetail(pages[target.page])) {
          return undefined;
        }

        // Parameters that name nothing (an empty one) are the same place without them: the leaf is kept as the place it opens.
        return dressed(node.params !== undefined && node.params !== target.params ? { ...node, params: target.params } : node);
      }

      return dressed(node);
    }

    const children = node.children.map(keep).filter((child): child is SidebarNodeV1 => child !== undefined);
    return children.length === 0 ? undefined : dressed({ ...node, children });
  };

  return nodes.map(keep).filter((node): node is SidebarNodeV1 => node !== undefined);
}
