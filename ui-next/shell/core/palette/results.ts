import { isObject, strictJson } from '../tabs/json';
import { normaliseRoute } from '../tabs/route';
import { highlight, partsOf } from './match';
import { isOpener, isTone, LIMITS, type Availability, type Chip, type CommandRef, type Into, type Json, type Label, type Range, type ResultKind, type Route, type Row, type RowAction, type RowKind, type SectionId, type TabId, type Tone } from './types';

// A provider's candidate becomes a row only through here (ch16 S63, S68). What a plugin hands over is not trusted: a candidate that is not valid data is dropped (and counted by the
// caller), and what is kept is a frozen copy the plugin can no longer change, its route in canonical form and the argument of its command copied deep. A row is DATA: the label cut at
// what matched, the tile, the route or the command, what the row says of itself.

/** The provider a candidate came from, and where its rows go. */
export type Owner = {
  readonly provider: string;
  readonly plugin: string;
  readonly pluginName?: string | undefined;
  readonly pluginIcon?: string | undefined;
  readonly section: SectionId;
};

/** A candidate that has been read: every field present and valid. */
export type Cand = {
  /** `provider|id`. */
  readonly key: string;
  readonly id: string;
  readonly provider: string;
  readonly plugin: string;
  readonly section: SectionId;
  readonly kind: ResultKind;
  readonly title: string;
  readonly context: string;
  readonly matchContext: string | undefined;
  readonly keywords: string;
  readonly icon: string;
  readonly tone: Tone;
  readonly noun: string;
  readonly route: Route | undefined;
  readonly reveal: Json | undefined;
  readonly command: CommandRef | undefined;
  readonly tab: TabId | undefined;
  readonly into: Into | undefined;
  /** The reason the row cannot open or run; absent when it can. */
  readonly unavailable: string | undefined;
  readonly shortcut: string | undefined;
  readonly order: number | undefined;
};

export const AVAILABLE: Availability = Object.freeze({ state: 'available' });

export const NOUNS: Readonly<Record<RowKind, string>> = Object.freeze({
  tab: 'Tab',
  page: 'Page',
  home: 'Plugin home',
  scope: 'Scope',
  type: 'Resource type',
  resource: 'Resource',
  command: 'Command',
  setting: 'Setting',
  tool: 'Tool',
  more: 'More results',
  everywhere: 'Search everywhere',
  source: 'Source',
});

const RESULT_KINDS: readonly string[] = ['tab', 'page', 'home', 'scope', 'type', 'resource', 'command', 'setting', 'tool'];
const STEPS: readonly string[] = ['scope', 'type', 'resource'];

/** The text of a field that must be a non-empty string, trimmed; `undefined` when it is not one. */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const optional = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** `text` on one line, at most `size` characters: cut, and ended with an ellipsis. */
export function clip(text: string, size: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > size ? `${line.slice(0, size - 1).trimEnd()}…` : line;
}

/** `prod-eu` becomes `Prod eu`: how a plugin is named when it has no name of its own. */
export function sentenceCase(text: string): string {
  const spaced = text.replace(/[-_]+/g, ' ').trim();
  return spaced === '' ? '' : `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`;
}

function readCommand(raw: unknown): CommandRef | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const id = nonEmpty(raw.id);
  if (id === undefined) {
    return undefined;
  }

  const arg = raw.arg === undefined ? undefined : strictJson(raw.arg);
  const target = raw.target === undefined ? undefined : strictJson(raw.target);
  if ((raw.arg !== undefined && arg === undefined) || (raw.target !== undefined && target === undefined)) {
    return undefined;
  }

  return Object.freeze({ id, ...(arg === undefined ? {} : { arg }), ...(target === undefined ? {} : { target }), ...(raw.keepOpen === true ? { keepOpen: true } : {}) });
}

function readInto(raw: unknown): Into | undefined {
  if (!isObject(raw) || typeof raw.kind !== 'string' || !STEPS.includes(raw.kind)) {
    return undefined;
  }

  const id = nonEmpty(raw.id);
  const label = nonEmpty(raw.label);
  if (id === undefined || label === undefined) {
    return undefined;
  }

  const noun = nonEmpty(raw.noun);
  const icon = nonEmpty(raw.icon);
  return Object.freeze({ kind: raw.kind as Into['kind'], id, label, ...(noun === undefined ? {} : { noun }), ...(icon === undefined ? {} : { icon }) });
}

/** The candidate, read: or `undefined` when it is not valid data (the caller counts it against its provider). */
export function candidateOf(raw: unknown, owner: Owner): Cand | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const id = nonEmpty(raw.id);
  const title = nonEmpty(raw.title);
  if (id === undefined || title === undefined || typeof raw.kind !== 'string' || !RESULT_KINDS.includes(raw.kind)) {
    return undefined;
  }

  const kind = raw.kind as ResultKind;
  let route: Route | undefined;
  if (raw.route !== undefined) {
    route = normaliseRoute(raw.route);
    if (route === undefined) {
      return undefined;
    }
  }

  const reveal = raw.reveal === undefined ? undefined : strictJson(raw.reveal);
  if (raw.reveal !== undefined && reveal === undefined) {
    return undefined;
  }

  // What each kind needs to do what Enter says: a place has a route, a tab names the tab, a command and a tool name a registry command.
  const command = kind === 'command' || kind === 'tool' ? readCommand(raw.command) : undefined;
  const tab = kind === 'tab' ? nonEmpty(raw.tab) : undefined;
  if ((kind === 'command' || kind === 'tool') && command === undefined) {
    return undefined;
  }

  if (kind === 'tab' && tab === undefined) {
    return undefined;
  }

  if (isOpener(kind) && kind !== 'tab' && route === undefined) {
    return undefined;
  }

  const reason = raw.unavailable === true ? 'Unavailable' : nonEmpty(raw.unavailable);
  const keywords = optional(raw.keywords);
  const matchContext = typeof raw.matchContext === 'string' ? raw.matchContext : undefined;
  const shortcut = nonEmpty(raw.shortcut);
  return Object.freeze({
    key: `${owner.provider}|${id}`,
    id,
    provider: owner.provider,
    plugin: owner.plugin,
    section: owner.section,
    kind,
    title,
    context: optional(raw.context),
    matchContext,
    keywords,
    icon: nonEmpty(raw.icon) ?? owner.pluginIcon ?? '',
    tone: isTone(raw.tone) ? raw.tone : 'neutral',
    noun: nonEmpty(raw.noun) ?? NOUNS[kind],
    route,
    reveal,
    command,
    tab,
    into: kind === 'command' || kind === 'tool' ? undefined : readInto(raw.into),
    unavailable: reason,
    shortcut,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : undefined,
  });
}

/** The chip a step inward adds (S69), its label cut at 24 characters. */
export function chipOf(into: Into, plugin: string): Chip {
  return { kind: into.kind, id: into.id, label: clip(into.label, LIMITS.chipLabel), plugin, noun: into.noun ?? (into.kind === 'type' ? 'resource type' : into.kind), icon: into.icon ?? '' };
}

const WORD: Readonly<Record<Availability['state'], string>> = { available: '', degraded: 'Degraded', unavailable: 'Unavailable' };
export const wordOf = (availability: Availability): string => WORD[availability.state];

/** The accessible name of a row: `<kind>: <title>`, where it is, and what its state says. */
export function nameOf(noun: string, title: string, context: string, availability: Availability): string {
  let said = '';
  if (availability.state === 'unavailable') {
    said = availability.reason === '' ? 'Unavailable' : `Unavailable. ${availability.reason}`;
  } else if (availability.state === 'degraded') {
    said = 'Degraded';
  }

  return [`${noun}: ${title}`, context, said].filter((part) => part !== '').join(', ');
}

/** A text and the ranges of it a query matched, as the data a view draws. */
export function labelOf(text: string, ranges: readonly Range[]): Label {
  return Object.freeze({ text, ranges: Object.freeze(ranges.map((range): Range => Object.freeze([range[0], range[1]]))), parts: Object.freeze(partsOf(text, ranges).map((part) => Object.freeze(part))) });
}

export type RowOptions = {
  readonly section: SectionId;
  /** The words of the query, for the ranges. Empty: nothing is marked. */
  readonly words: readonly string[];
  /** What the host says of a route (S65): called once, and never for a row the provider already says is unavailable or one that has no route. */
  readonly availability: (route: Route) => Availability;
  readonly inert: boolean;
  readonly score: number;
};

function actionOf(cand: Cand): RowAction {
  if (cand.command !== undefined) {
    return { type: 'run', command: cand.command };
  }

  const destination = cand.route === undefined ? undefined : Object.freeze({ route: cand.route, ...(cand.reveal === undefined ? {} : { reveal: cand.reveal }) });
  if (cand.tab !== undefined) {
    return { type: 'activate', tab: cand.tab, destination };
  }

  return destination === undefined ? { type: 'none' } : { type: 'open', destination };
}

/** The row a candidate is, in a section, for the words of a query. */
export function rowFor(cand: Cand, options: RowOptions): Row {
  let availability: Availability = AVAILABLE;
  if (cand.unavailable !== undefined) {
    availability = Object.freeze({ state: 'unavailable', reason: cand.unavailable });
  } else if (cand.route !== undefined) {
    availability = options.availability(cand.route);
  }

  const marks = options.words.length === 0 ? { title: [], context: [] } : highlight(options.words, cand.title, cand.context);
  return Object.freeze({
    id: `${options.section}|${cand.key}`,
    key: cand.key,
    section: options.section,
    kind: cand.kind,
    noun: cand.noun,
    title: labelOf(cand.title, marks.title),
    context: labelOf(cand.context, marks.context),
    tile: cand.icon === '' ? undefined : Object.freeze({ icon: cand.icon, tone: cand.tone }),
    plugin: cand.plugin,
    route: cand.route,
    action: Object.freeze(actionOf(cand)),
    availability,
    word: wordOf(availability),
    inert: options.inert,
    // A row that cannot be entered is one a plugin that is failing or starting would answer nothing for (S65): only an available one opens inward.
    into: availability.state === 'available' ? cand.into : undefined,
    shortcut: cand.shortcut,
    name: nameOf(cand.noun, cand.title, cand.context, availability),
    score: options.score,
  });
}

/** A row the model makes for itself: Show all, Search everywhere, a source of the Sources list. */
export type OwnRow = {
  readonly id: string;
  readonly section: SectionId;
  readonly kind: 'more' | 'everywhere' | 'source';
  readonly title: string;
  readonly context: string;
  readonly icon: string;
  readonly action: RowAction;
  readonly availability: Availability;
  readonly word: string;
};

export function ownRow(fields: OwnRow): Row {
  return Object.freeze({
    id: fields.id,
    key: fields.id,
    section: fields.section,
    kind: fields.kind,
    noun: NOUNS[fields.kind],
    title: labelOf(fields.title, []),
    context: labelOf(fields.context, []),
    tile: Object.freeze({ icon: fields.icon, tone: 'neutral' as const }),
    plugin: '',
    route: undefined,
    action: Object.freeze(fields.action),
    availability: fields.availability,
    word: fields.word,
    inert: false,
    into: undefined,
    shortcut: undefined,
    name: nameOf(NOUNS[fields.kind], fields.title, fields.context, fields.availability),
    score: 0,
  });
}
