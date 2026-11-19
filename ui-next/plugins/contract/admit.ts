import { ContractError } from '../loader/failure';
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

function checkNodes(nodes: unknown, where: string, problems: Problems, seen: Set<string>, leaves: string[]): void {
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

    if (node.count !== undefined && typeof node.count !== 'number') {
      problems.push(`${at}.count is not a number`);
    }

    const children = node.children;
    if (children === undefined) {
      if (isText(id)) {
        leaves.push(id);
      }
    } else {
      checkNodes(children, `${at}.children`, problems, seen, leaves);
    }
  });
}

/** A detail page: the page of one object. */
const isDetail = (page: unknown): boolean => isRecord(page) && page.kind === 'detail';

/** What a detail page's static definition must say: the words and the identity the host draws its heading, its tab and its strip from, before any data is read. */
function checkDetailDefinition(definition: Readonly<Record<string, unknown>>, at: string, problems: Problems): void {
  if (!isText(definition.kind)) {
    problems.push(`${at}.kind is not a non-empty string`);
  }

  const tile = definition.tile;
  if (!isRecord(tile) || !isText(tile.icon)) {
    problems.push(`${at}.tile needs an icon`);
  }

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

function checkPage(page: unknown, at: string, problems: Problems): void {
  if (!isRecord(page)) {
    problems.push(`${at} is not an object`);
    return;
  }

  if (page.kind !== 'list' && page.kind !== 'detail') {
    problems.push(`${at}.kind is "${String(page.kind)}", and this version draws "list" and "detail" pages`);
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
        } else if (kind.card !== undefined && !isFunction(kind.card)) {
          problems.push(`panel.sessions.${id}.card is not a function`);
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

  const leaves: string[] = [];
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
      if (!Object.hasOwn(pages, leaf)) {
        problems.push(`the sidebar entry "${leaf}" opens no page`);
      } else if (isDetail(pages[leaf])) {
        problems.push(`the sidebar entry "${leaf}" opens a detail page, which needs an object`);
      }
    }

    if (typeof value.home !== 'string' || !Object.hasOwn(pages, value.home)) {
      problems.push(`home "${String(value.home)}" is not one of the pages`);
    } else if (isDetail(pages[value.home])) {
      problems.push(`home "${value.home}" is a detail page, which needs an object: the window could not open it`);
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

/** The nodes a hook answered that open a page of this contribution: a dynamic entry that opens nothing would be a stub, and a detail page opens nothing without an object. */
export function openable(nodes: readonly SidebarNodeV1[], pages: Readonly<Record<string, unknown>>): readonly SidebarNodeV1[] {
  const keep = (node: SidebarNodeV1): SidebarNodeV1 | undefined => {
    if (node.children === undefined) {
      return Object.hasOwn(pages, node.id) && !isDetail(pages[node.id]) ? node : undefined;
    }

    const children = node.children.map(keep).filter((child): child is SidebarNodeV1 => child !== undefined);
    return children.length === 0 ? undefined : { ...node, children };
  };

  return nodes.map(keep).filter((node): node is SidebarNodeV1 => node !== undefined);
}
