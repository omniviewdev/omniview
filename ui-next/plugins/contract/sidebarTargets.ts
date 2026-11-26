import { DATA_COLORS, type DataColor, type StatusRole } from '@omniviewdev/kit';
import type { ShellRowStatus } from '../../shell';
import type { SidebarNodeV1 } from './v1';

// What a sidebar leaf opens, which leaf is the page on screen, and what of its row the shell draws (KL5). A node is plugin data, and so is every answer of the sidebar's hook: the host's gate for those answers (`openable`, `admit.ts`), the admission of the
// skeleton (`checkNodes`), the palette's rows (`host/palette.ts`) and what a press does (`host/PluginHost.tsx`) all read a leaf's members through these functions, so that they cannot disagree about what a leaf is. Nothing here trusts a type or throws: a
// member that is not valid is a problem that names it. Pure: no React, no registry, no I/O.

/** The route parameters of a place, as text. */
export type Params = Readonly<Record<string, string>>;

/** What a leaf opens: a page with the parameters it opens with (a place of the plugin), or one of the plugin's connections. */
export type LeafTarget =
  | { readonly kind: 'page'; readonly page: string; readonly params: Params }
  | { readonly kind: 'connection'; readonly key: string };

/** What a leaf opens, or the problem with how it says so (a sentence that starts with the member, as admission's do). */
export type TargetRead = { readonly target: LeafTarget } | { readonly problem: string };

const NO_PARAMS: Params = Object.freeze({});

/** What a node is read for: every member is `unknown` until this module has read it, whatever the contract's types say. */
type Fields = {
  readonly id?: unknown;
  readonly page?: unknown;
  readonly params?: unknown;
  readonly connection?: unknown;
  readonly status?: unknown;
  readonly tone?: unknown;
};

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** The roles of the kit's `Status`, as a table the compiler holds complete: a role the kit gains is a type error here until it is listed. */
const ROLES: Readonly<Record<StatusRole, true>> = { healthy: true, running: true, progress: true, attention: true, error: true, stopped: true, info: true };

const BAD_PARAMS = 'params is not an object of text values';

/** The parameters a leaf opens its page with: text, with the empty ones left out (an empty parameter names nothing, as the tab model has it), or the problem. The object the plugin gave when there is nothing to leave out. */
function paramsOf(params: unknown): Params | string {
  if (params === undefined) {
    return NO_PARAMS;
  }

  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return BAD_PARAMS;
  }

  const entries = Object.entries(params);
  const kept: Array<readonly [string, string]> = [];
  for (const [name, value] of entries) {
    if (typeof value !== 'string') {
      return BAD_PARAMS;
    }

    if (name === 'connection') {
      return 'params holds "connection", which is not a parameter: a leaf opens a connection with its connection member';
    }

    if (value !== '') {
      kept.push([name, value]);
    }
  }

  return kept.length === entries.length ? (params as Params) : Object.freeze(Object.fromEntries(kept));
}

/**
 * What a leaf opens. A leaf that names no new member opens the page its `id` names, with no parameters, as it always did; `page` names another page, `params` the parameters it opens with, and `connection` one of the plugin's connections instead
 * of a page. A leaf opens one thing: a connection together with a page or parameters is a problem. The node is read as plugin data and never throws.
 */
export function readTarget(node: SidebarNodeV1): TargetRead {
  const { id, page, params, connection } = node as Fields;
  if (connection !== undefined) {
    if (!isText(connection)) {
      return { problem: 'connection is not a non-empty string' };
    }

    return page !== undefined || params !== undefined ? { problem: 'connection is given with page or params: a leaf opens a page or a connection, not both' } : { target: { kind: 'connection', key: connection } };
  }

  if (page !== undefined && !isText(page)) {
    return { problem: 'page is not a non-empty string' };
  }

  const read = paramsOf(params);
  if (typeof read === 'string') {
    return { problem: read };
  }

  return { target: { kind: 'page', page: typeof page === 'string' ? page : String(id), params: read } };
}

function validStatus(status: unknown): status is ShellRowStatus {
  if (typeof status !== 'object' || status === null) {
    return false;
  }

  const { role, label } = status as { readonly role?: unknown; readonly label?: unknown };
  return typeof role === 'string' && Object.hasOwn(ROLES, role) && isText(label);
}

const validTone = (tone: unknown): tone is DataColor => typeof tone === 'string' && (DATA_COLORS as readonly string[]).includes(tone);

/** What is not valid in how a row is dressed (its `status` and its `tone`), in the sentences admission uses: each starts with the member. */
export function dressProblems(node: SidebarNodeV1): readonly string[] {
  const { status, tone } = node as Fields;
  return [
    ...(status === undefined || validStatus(status) ? [] : ['status is not { role, label }: a role of the kit\'s Status and a label']),
    ...(tone === undefined || validTone(tone) ? [] : [`tone is not a colour of the kit's data palette: ${DATA_COLORS.join(', ')}`]),
  ];
}

/** The node as the shell may draw it: without a `status` or a `tone` that is not valid, which cost the row that member and nothing else (the shell draws only what it can). The node itself when both are fine. */
export function dressed(node: SidebarNodeV1): SidebarNodeV1 {
  const { status, tone } = node as Fields;
  const badStatus = status !== undefined && !validStatus(status);
  const badTone = tone !== undefined && !validTone(tone);
  if (!badStatus && !badTone) {
    return node;
  }

  const copy = { ...node };
  if (badStatus) {
    Reflect.deleteProperty(copy, 'status');
  }

  if (badTone) {
    Reflect.deleteProperty(copy, 'tone');
  }

  return copy;
}

/** The leaf of a tree with this id: `undefined` for a group and for an id the tree does not hold. */
export function leafOf(nodes: readonly SidebarNodeV1[], id: string): SidebarNodeV1 | undefined {
  for (const node of nodes) {
    if (node.children === undefined) {
      if (node.id === id) {
        return node;
      }
    } else {
      const inside = leafOf(node.children, id);
      if (inside !== undefined) {
        return inside;
      }
    }
  }

  return undefined;
}

const sameParams = (a: Params, b: Params): boolean => {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => Object.hasOwn(b, name) && a[name] === b[name]);
};

/**
 * The leaf that is the page on screen, by its id: the leaf that opens this page with these very parameters; where none does, the leaf of the page that names no parameters (a page opened with a parameter nobody listed, and a list under an
 * object's page, whose own parameters are the object's); else none. A leaf that opens a connection is never the page on screen, and neither is one that opens nothing. The first of the leaves that fit, in the order the tree draws them.
 */
export function currentOf(nodes: readonly SidebarNodeV1[], page: string, params: Params): string | undefined {
  let plain: string | undefined;
  const visit = (siblings: readonly SidebarNodeV1[]): string | undefined => {
    for (const node of siblings) {
      if (node.children !== undefined) {
        const inside = visit(node.children);
        if (inside !== undefined) {
          return inside;
        }

        continue;
      }

      const read = readTarget(node);
      if (!('target' in read) || read.target.kind !== 'page' || read.target.page !== page) {
        continue;
      }

      if (sameParams(read.target.params, params)) {
        return node.id;
      }

      if (plain === undefined && Object.keys(read.target.params).length === 0) {
        plain = node.id;
      }
    }

    return undefined;
  };

  return visit(nodes) ?? plain;
}
