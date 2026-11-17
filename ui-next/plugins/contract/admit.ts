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

function checkPage(page: unknown, at: string, problems: Problems): void {
  if (!isRecord(page)) {
    problems.push(`${at} is not an object`);
    return;
  }

  if (page.kind !== 'list') {
    problems.push(`${at}.kind is "${String(page.kind)}", and this version draws "list" pages`);
  }

  if (!isFunction(page.usePage)) {
    problems.push(`${at}.usePage is not a function`);
  }

  const definition = page.definition;
  if (!isRecord(definition)) {
    problems.push(`${at}.definition is not an object`);
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

function checkContribution(value: Readonly<Record<string, unknown>>): Problems {
  const problems: Problems = [];
  const plugin = value.plugin;
  if (!isRecord(plugin) || !isText(plugin.name)) {
    problems.push('plugin.name is not a non-empty string');
  } else if (plugin.accent !== undefined && !(typeof plugin.accent === 'string' && Object.hasOwn(ACCENTS, plugin.accent))) {
    problems.push(`plugin.accent "${typeof plugin.accent === 'string' ? plugin.accent : typeof plugin.accent}" is not one of the shell's colours`);
  }

  if (value.rail !== undefined && value.rail !== true) {
    problems.push('rail is neither absent nor true');
  }

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
    }

    for (const leaf of leaves) {
      if (!Object.hasOwn(pages, leaf)) {
        problems.push(`the sidebar entry "${leaf}" opens no page`);
      }
    }

    if (typeof value.home !== 'string' || !Object.hasOwn(pages, value.home)) {
      problems.push(`home "${String(value.home)}" is not one of the pages`);
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

/** The nodes a hook answered that open a page of this contribution: a dynamic entry that opens nothing would be a stub. */
export function openable(nodes: readonly SidebarNodeV1[], pages: Readonly<Record<string, unknown>>): readonly SidebarNodeV1[] {
  const keep = (node: SidebarNodeV1): SidebarNodeV1 | undefined => {
    if (node.children === undefined) {
      return Object.hasOwn(pages, node.id) ? node : undefined;
    }

    const children = node.children.map(keep).filter((child): child is SidebarNodeV1 => child !== undefined);
    return children.length === 0 ? undefined : { ...node, children };
  };

  return nodes.map(keep).filter((node): node is SidebarNodeV1 => node !== undefined);
}
