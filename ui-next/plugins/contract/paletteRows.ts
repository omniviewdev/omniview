import { isIconName, type IconName } from '@omniviewdev/kit';
import type { PaletteJsonV1, RouteV1 } from './v1';

// Admission of what a plugin's palette provider answers (C1c). A provider is plugin code and what it answers is `unknown` until this says otherwise: each row is read once, member by member, and becomes a clean copy
// the plugin can no longer change, or a problem that names the row and the rule it broke. Nothing here throws on what a plugin hands over, and a row that is not valid costs the answer that row and no other. Pure: no
// React, no registry, no I/O. What it cannot check, and who does: that the page a route names draws (the page's own boundary), and that a command does what its row says (the command's).

/**
 * The bounds of the palette contract, in characters unless said otherwise. The declaration's (providers, ids, section) are read by `admit.ts` when a bundle loads; the rest by `admitRow` when a provider answers.
 * `matchRows` is how many rows are read from one `match` answer (a set larger than that is a `search` provider: the palette says it was cut), and `scanRows` how many of a `search` answer are looked at in all,
 * whatever it holds: the palette keeps 20 rows of an answer (the model's bound) and looking at five times that many leaves room for a few that are not valid.
 */
export const PALETTE_LIMITS = Object.freeze({
  providers: 4,
  providerId: 64,
  section: 40,
  commandId: 64,
  id: 256,
  label: 120,
  secondary: 160,
  keywords: 200,
  connection: 256,
  params: 8,
  paramName: 64,
  paramValue: 256,
  arg: 1024,
  message: 160,
  matchRows: 1000,
  scanRows: 100,
  /** The rows the palette keeps of one `search` answer: the model's own bound (`LIMITS.rowsPerProvider`), which a test holds this equal to. */
  answerRows: 20,
});

/** Text longer than this is not read, whatever the field: a bound on the work, before the bound on the words. */
const MAX_RAW = 4096;
/** The deepest a command's argument may nest. */
const MAX_DEPTH = 8;
/** The problems one answer reports: the first seven, and then the number of the rest. */
const MAX_PROBLEMS = 8;

/** What a row is checked against: what the plugin has. */
export type RowRules = {
  /** The plugin's pages by id: a route belongs to the plugin when it names one of them. */
  readonly pages: Readonly<Record<string, unknown>>;
  /** The plugin's commands by id (`palette.commands`): a command row names one of them. */
  readonly commands: Readonly<Record<string, unknown>>;
};

type AdmittedBase = {
  readonly id: string;
  readonly label: string;
  /** Empty when the row has none. */
  readonly secondary: string;
  /** Empty when the row has none. */
  readonly keywords: string;
  readonly icon: IconName;
};

/** A row that was read: every member present and valid, text on one line, the route and the argument copies. It opens one of two things: a page of the plugin with its connection and parameters, or one of its commands. */
export type AdmittedRow = AdmittedBase & (
  | { readonly route: RouteV1; readonly command?: undefined }
  | { readonly command: { readonly id: string; readonly arg: PaletteJsonV1 | undefined }; readonly route?: undefined }
);

export type RowAdmission = { readonly ok: true; readonly row: AdmittedRow } | { readonly ok: false; readonly problem: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The text of a field that must be a string: on one line (white space of any kind, a new line included, is one space, and the ends are trimmed) and at most `size` characters. `undefined` when it is not. */
export function oneLine(value: unknown, size: number): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_RAW) {
    return undefined;
  }

  const one = value.replace(/\s+/g, ' ').trim();
  return one.length <= size ? one : undefined;
}

/** Names that are the prototype's: no key of a parameter or of an argument may be one. */
const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** A deep copy of JSON the plugin handed over, or `undefined` when it is not JSON: a function, a symbol, `undefined`, a number that is not finite, a class instance, a key that names the prototype, a cycle (the depth stops it). */
function copyJson(value: unknown, depth = 0): PaletteJsonV1 | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (depth >= MAX_DEPTH || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items: PaletteJsonV1[] = [];
    for (const item of value as unknown[]) {
      const copy = copyJson(item, depth + 1);
      if (copy === undefined) {
        return undefined;
      }

      items.push(copy);
    }

    return items;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }

  const members: Record<string, PaletteJsonV1> = {};
  for (const [key, member] of Object.entries(value)) {
    const copy = FORBIDDEN_KEYS.includes(key) ? undefined : copyJson(member, depth + 1);
    if (copy === undefined) {
      return undefined;
    }

    members[key] = copy;
  }

  return members;
}

/** The first member of a row that holds a function, read without calling a getter: a row is data, and a function that draws (or runs) is not. */
function functionIn(raw: Readonly<Record<string, unknown>>): string | undefined {
  return Object.keys(raw).find((key) => typeof Object.getOwnPropertyDescriptor(raw, key)?.value === 'function');
}

type Route = NonNullable<AdmittedRow['route']>;

/** The route of a row, or the problem with it. `at` is how the row is named in a problem. */
function routeOf(raw: unknown, rules: RowRules, at: string): Route | string {
  if (!isRecord(raw)) {
    return `${at}: route is not an object`;
  }

  const { page, connection, params } = raw;
  if (typeof page !== 'string' || page.trim() === '') {
    return `${at}: route.page is not text`;
  }

  const found = Object.hasOwn(rules.pages, page) ? rules.pages[page] : undefined;
  if (found === undefined) {
    return `${at}: route.page "${page}" is not one of the plugin's pages`;
  }

  if (connection !== undefined && oneLine(connection, PALETTE_LIMITS.connection) === undefined) {
    return `${at}: route.connection is not a string of at most ${String(PALETTE_LIMITS.connection)} characters`;
  }

  if (!isRecord(params)) {
    return `${at}: route.params is not an object`;
  }

  const names = Object.keys(params);
  const shape = isRecord(found) ? found : undefined;
  if (shape?.kind !== 'detail' && names.length > 0) {
    return `${at}: route.page "${page}" is a list page and takes no parameters`;
  }

  if (names.length > PALETTE_LIMITS.params) {
    return `${at}: route.params has ${String(names.length)} parameters, at most ${String(PALETTE_LIMITS.params)}`;
  }

  const copy: Record<string, string> = {};
  for (const name of names) {
    if (name.length > PALETTE_LIMITS.paramName) {
      return `${at}: route.params has a name of more than ${String(PALETTE_LIMITS.paramName)} characters`;
    }

    if (name === 'connection') {
      return `${at}: route.params holds "connection": it is the route's own member`;
    }

    const value = oneLine(params[name], PALETTE_LIMITS.paramValue);
    if (value === undefined) {
      return `${at}: route.params.${name} is not a string of at most ${String(PALETTE_LIMITS.paramValue)} characters`;
    }

    if (FORBIDDEN_KEYS.includes(name)) {
      return `${at}: route.params has a name the host does not take: "${name}"`;
    }

    copy[name] = value;
  }

  // A detail page is the page of one object, and the route names it by the parameter its definition says holds it: a route without it opens a page of nothing.
  const definition = isRecord(shape?.definition) ? shape.definition : undefined;
  const identity = isRecord(definition?.identity) && typeof definition.identity.name === 'string' ? definition.identity.name : undefined;
  if (shape?.kind === 'detail' && identity !== undefined && (copy[identity] ?? '') === '') {
    return `${at}: route.page "${page}" is a detail page and needs the parameter "${identity}"`;
  }

  const one = connection === undefined ? '' : (oneLine(connection, PALETTE_LIMITS.connection) ?? '');
  return { page, ...(one === '' ? {} : { connection: one }), params: copy };
}

/** The command of a row, or the problem with it. */
function commandOf(raw: unknown, rules: RowRules, at: string): NonNullable<AdmittedRow['command']> | string {
  if (!isRecord(raw)) {
    return `${at}: command is not an object`;
  }

  const { id, arg } = raw;
  if (typeof id !== 'string' || !Object.hasOwn(rules.commands, id)) {
    return `${at}: command.id "${typeof id === 'string' ? id : typeof id}" is not one of the plugin's commands`;
  }

  if (arg === undefined) {
    return { id, arg: undefined };
  }

  const copy = copyJson(arg);
  if (copy === undefined || JSON.stringify(copy).length >= PALETTE_LIMITS.arg) {
    return `${at}: command.arg is not JSON of at most ${String(PALETTE_LIMITS.arg)} characters`;
  }

  return { id, arg: copy };
}

/**
 * Reads one row. `index` is the row's place in the answer: it names a row that has no usable id of its own. The checks run in the order a person would read the row (its words, its glyph, what it opens), and the first
 * that fails is the problem: one problem for a row, in the plugin author's words, naming the member.
 */
export function admitRow(raw: unknown, rules: RowRules, index: number): RowAdmission {
  if (!isRecord(raw)) {
    return { ok: false, problem: `row ${String(index)} is not an object` };
  }

  // Each member is read once: a getter that answers differently the second time is not what was checked.
  const { id, label, secondary, keywords, icon, route, command } = raw;
  const named = oneLine(id, PALETTE_LIMITS.id);
  if (named === undefined || named === '') {
    return { ok: false, problem: `row ${String(index)}: id is not a non-empty string of at most ${String(PALETTE_LIMITS.id)} characters` };
  }

  const at = `row "${named}"`;
  const words = oneLine(label, PALETTE_LIMITS.label);
  if (words === undefined || words === '') {
    return { ok: false, problem: `${at}: label is not a non-empty string of at most ${String(PALETTE_LIMITS.label)} characters` };
  }

  const context = secondary === undefined ? '' : oneLine(secondary, PALETTE_LIMITS.secondary);
  if (context === undefined) {
    return { ok: false, problem: `${at}: secondary is not a string of at most ${String(PALETTE_LIMITS.secondary)} characters` };
  }

  const found = keywords === undefined ? '' : oneLine(keywords, PALETTE_LIMITS.keywords);
  if (found === undefined) {
    return { ok: false, problem: `${at}: keywords is not a string of at most ${String(PALETTE_LIMITS.keywords)} characters` };
  }

  if (typeof icon !== 'string') {
    return { ok: false, problem: `${at}: icon is not a glyph name` };
  }

  if (!isIconName(icon)) {
    return { ok: false, problem: `${at}: the glyph "${icon}" is not one the kit has` };
  }

  const code = functionIn(raw);
  if (code !== undefined) {
    return { ok: false, problem: `${at}: "${code}" is a function, and a row is data` };
  }

  if (route === undefined && command === undefined) {
    return { ok: false, problem: `${at}: it opens neither a route nor a command` };
  }

  if (route !== undefined && command !== undefined) {
    return { ok: false, problem: `${at}: it names both a route and a command: it opens one thing` };
  }

  if (route !== undefined) {
    const made = routeOf(route, rules, at);
    return typeof made === 'string' ? { ok: false, problem: made } : { ok: true, row: { id: named, label: words, secondary: context, keywords: found, icon, route: made, command: undefined } };
  }

  const made = commandOf(command, rules, at);
  return typeof made === 'string' ? { ok: false, problem: made } : { ok: true, row: { id: named, label: words, secondary: context, keywords: found, icon, route: undefined, command: made } };
}

/** What an answer's rows came to. */
export type RowsRead = {
  readonly rows: readonly AdmittedRow[];
  /** What was left out and why: at most eight lines (seven, and the count of the rest). */
  readonly problems: readonly string[];
  /** How many of the answer's entries were looked at: the rest were not read. */
  readonly read: number;
};

/**
 * Reads the rows of an answer in order, keeping the valid ones until `keep` are kept or `scan` entries have been looked at, whichever comes first: an answer of five thousand rows costs a hundred reads at most, and
 * the rows after the last one looked at are the provider's to count (`read` says where it stopped). A second row with an id already read is left out, with a problem.
 */
export function admitRows(raw: readonly unknown[], rules: RowRules, options: { readonly keep: number; readonly scan: number }): RowsRead {
  const rows: AdmittedRow[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  let bad = 0;
  let read = 0;
  const left = (problem: string): void => {
    bad += 1;
    problems.push(problem);
  };

  while (read < raw.length && read < options.scan && rows.length < options.keep) {
    const admission = admitRow(raw[read], rules, read);
    read += 1;
    if (!admission.ok) {
      left(admission.problem);
    } else if (seen.has(admission.row.id)) {
      left(`row "${admission.row.id}": the id is used twice in one answer`);
    } else {
      seen.add(admission.row.id);
      rows.push(admission.row);
    }
  }

  const said = bad <= MAX_PROBLEMS ? problems : [...problems.slice(0, MAX_PROBLEMS - 1), `and ${String(bad - (MAX_PROBLEMS - 1))} more rows that are not valid`];
  return { rows, problems: said, read };
}
