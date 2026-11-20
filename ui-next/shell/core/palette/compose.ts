import { contextOf, routeKey } from './recents';
import { rank, type RankSource } from './rank';
import { scoreCandidate } from './match';
import { AVAILABLE, candidateOf, ownRow, rowFor, type Cand, type Owner } from './results';
import type { Answer } from './runner';
import type { SyncReport } from './status';
import { ACTIONS, LIMITS, RECENT, SUGGEST, type Availability, type Candidate, type Chip, type Description, type ErrorHook, type Note, type PaletteKind, type Provider, type Recent, type Route, type Row, type Section, type SearchScope, type SectionRef } from './types';

// The list: what each provider offers, ranked, grouped, ordered and bounded (ch16 S68, S73, SE1). Static providers answer in the same call; what asynchronous providers said comes in as
// answers. Nothing here keeps state: the store gives it the world and gets sections back, and what is expensive (ranking ten thousand candidates) is a function of the query, the kind and
// the chips alone, so the store can keep it while only an asynchronous answer changes.

/** A provider as the palette registered it. */
export type Entry = {
  readonly provider: Provider;
  /** The place in the order of registration: the order of equal sections (SE1) and of the sections a plugin brings. */
  readonly index: number;
  readonly mode: 'match' | 'search';
  readonly ref: SectionRef;
  readonly owner: Owner;
  readonly pluginName: string;
  readonly title: string;
  readonly limit: number;
};

export type Seam = {
  readonly availability: (route: Route) => Availability;
  readonly describe: (route: Route) => Description | undefined;
  readonly onError: ErrorHook;
};

export type ComposeInput = {
  /** As typed: the providers are given it trimmed. */
  readonly query: string;
  readonly words: readonly string[];
  readonly kind: PaletteKind;
  readonly chips: readonly Chip[];
  readonly scope: SearchScope;
  readonly entries: readonly Entry[];
  readonly recents: readonly Recent[];
  readonly current: Route | undefined;
  readonly seam: Seam;
};

export type StaticResult = { readonly sections: readonly Section[]; readonly reports: ReadonlyMap<string, SyncReport> };

/** The order sections lead in when they match equally well (SE1); a section of a plugin's own comes after, in the order its provider registered. */
const ORDER: Readonly<Record<string, number>> = { [ACTIONS]: -1, [RECENT]: 0, tabs: 1, goto: 2, commands: 3, settings: 4, [SUGGEST]: 5 };
const CUSTOM = 100;

export const TITLES: Readonly<Record<string, string>> = { [RECENT]: 'Recent', tabs: 'Tabs', goto: 'Go to', commands: 'Commands', settings: 'Settings', [SUGGEST]: 'Suggestions' };

/** Rows kept from a section in All, and in the kind that shows only it (S68, the mock's caps). */
const CAP_ALL: Readonly<Record<string, number>> = { [RECENT]: 8, tabs: 5, goto: 8, commands: 6, settings: 5, source: 5, [SUGGEST]: 8 };
const CAP_ONE: Readonly<Record<string, number>> = { tabs: 30, goto: 30, commands: 40, settings: 40, source: 20, [SUGGEST]: 30 };

const builtin = (id: string): boolean => Object.hasOwn(ORDER, id);

function capOf(id: string, kind: PaletteKind): number {
  const key = builtin(id) ? id : 'source';
  return (kind === 'all' ? CAP_ALL[key] : (CAP_ONE[key] ?? CAP_ALL[key])) ?? LIMITS.rowsPerProvider;
}

const shows = (section: SectionRef['kind'], kind: PaletteKind): boolean => kind === 'all' || section === kind;

/** A provider is asked when the palette is not narrowed to another plugin: the host's are always asked (S69). Its own `supports` may say it has nothing to say here. */
export function participates(entry: Entry, scope: SearchScope, onError: ErrorHook): boolean {
  if (scope.plugin !== null && entry.provider.plugin !== scope.plugin && entry.provider.plugin !== 'host') {
    return false;
  }

  try {
    return entry.provider.supports?.(scope) !== false;
  } catch (error) {
    onError(error, `supports() of ${entry.provider.id}`);
    return true;
  }
}

function section(id: string, title: string, rows: readonly Row[], more: number, to: Section['to'], source?: string): Section {
  return { id, title, rows, more, to, source };
}

const defaultOrder = (id: string, entries: readonly Entry[]): number => {
  if (builtin(id)) {
    return ORDER[id] ?? CUSTOM;
  }

  return CUSTOM + (entries.find((entry) => entry.ref.id === id)?.index ?? 0);
};

const toOf = (id: string, ref: SectionRef | undefined): Section['to'] => {
  if (id === RECENT || id === SUGGEST) {
    return undefined;
  }

  return builtin(id) ? (id as PaletteKind) : ref?.kind;
};

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== '' ? error.message : 'It did not answer.');

/** What a synchronous provider offers for a query, contained: a provider that throws or answers what is not a list is reported, and offers nothing. */
function callMatch(entry: Entry, query: string, input: ComposeInput, reports: Map<string, SyncReport>): readonly Candidate[] {
  try {
    const result: unknown = entry.provider.match?.(query, input.scope);
    if (!Array.isArray(result)) {
      throw new TypeError('A match() must answer with a list of candidates.');
    }

    const list = result as readonly Candidate[];
    const report = reports.get(entry.provider.id) ?? { error: '', invalid: 0, limited: 0 };
    reports.set(entry.provider.id, { ...report, limited: Math.max(report.limited, list.length > LIMITS.candidates ? list.length : 0) });
    return list.length > LIMITS.candidates ? list.slice(0, LIMITS.candidates) : list;
  } catch (error) {
    input.seam.onError(error, `match() of ${entry.provider.id}`);
    reports.set(entry.provider.id, { error: messageOf(error), invalid: 0, limited: 0 });
    return [];
  }
}

/** A provider offered candidates that were not valid data: said once for each. */
const tally = (reports: Map<string, SyncReport>, id: string, invalid: number): void => {
  if (invalid > 0) {
    const report = reports.get(id) ?? { error: '', invalid: 0, limited: 0 };
    reports.set(id, { ...report, invalid: report.invalid + invalid });
  }
};

/** The candidates of the entries that answer, in a section, ranked for the words of the query: the best `cap` of them, as rows. */
function ranked(input: ComposeInput, id: string, entries: readonly Entry[], reports: Map<string, SyncReport>): Section {
  const sources: RankSource[] = entries.map((entry) => ({ owner: entry.provider.id, candidates: callMatch(entry, input.query.trim(), input, reports) }));
  const { hits, total, invalid } = rank(sources, input.words, capOf(id, input.kind));
  for (const [owner, count] of invalid) {
    tally(reports, owner, count);
  }

  const owners = new Map(entries.map((entry) => [entry.provider.id, entry.owner]));
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const owner = owners.get(hit.owner);
    const cand = owner === undefined ? undefined : candidateOf(hit.candidate, owner);
    if (cand === undefined) {
      tally(reports, hit.owner, 1);
    } else if (!seen.has(cand.key)) {
      seen.add(cand.key);
      rows.push(rowFor(cand, { section: id, words: input.words, availability: input.seam.availability, inert: false, score: hit.score }));
    }
  }

  const head = entries[0];
  return section(id, head?.ref.title ?? '', rows, Math.max(0, total - rows.length), toOf(id, head?.ref));
}

type Listing = { readonly cap: number; readonly homesOnly: boolean };

/** What a kind holds before anything is typed: the candidates as the providers gave them, in order, and not the ones that cannot open (S73: they never lead before a query matches them). */
function listed(input: ComposeInput, id: string, entries: readonly Entry[], reports: Map<string, SyncReport>, listing: Listing): Section {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let count = 0;
  let scanned = 0;
  for (const entry of entries) {
    const list = callMatch(entry, '', input, reports);
    count += list.length;
    let index = 0;
    for (; index < list.length && rows.length < listing.cap; index += 1) {
      const cand = candidateOf(list[index], entry.owner);
      if (cand === undefined) {
        tally(reports, entry.provider.id, 1);
      } else if (!(listing.homesOnly && cand.kind !== 'home') && !seen.has(cand.key)) {
        seen.add(cand.key);
        const row = rowFor(cand, { section: id, words: [], availability: input.seam.availability, inert: false, score: 0 });
        if (row.availability.state !== 'unavailable') {
          rows.push(row);
        }
      }
    }

    scanned += index;
    if (rows.length >= listing.cap) {
      break;
    }
  }

  const head = entries[0];
  return section(id, head?.ref.title ?? TITLES[id] ?? '', rows, rows.length >= listing.cap ? Math.max(0, count - scanned) : 0, toOf(id, head?.ref));
}

/** The recent destinations (S73): newest first, not the place the user is on, not one that cannot open now; described again by its plugin when it says something. */
function recentSection(input: ComposeInput): Section | undefined {
  const plugin = input.scope.plugin;
  const here = input.current === undefined ? undefined : routeKey(input.current);
  const cap = capOf(RECENT, 'all');
  const rows: Row[] = [];
  let eligible = 0;
  for (const recent of input.recents) {
    if ((plugin !== null && recent.route.plugin !== plugin) || recent.key === here) {
      continue;
    }

    const availability = input.seam.availability(recent.route);
    if (availability.state === 'unavailable') {
      continue;
    }

    eligible += 1;
    if (rows.length < cap) {
      const description = input.seam.describe(recent.route);
      const said = description !== undefined && description.provisional !== true ? description : undefined;
      const cand: Cand = {
        key: `${RECENT}|${recent.key}`,
        id: recent.key,
        provider: RECENT,
        plugin: recent.route.plugin,
        section: RECENT,
        kind: recent.kind,
        title: said?.title ?? recent.title,
        context: said === undefined ? recent.context : contextOf(said),
        matchContext: undefined,
        keywords: '',
        icon: said?.icon ?? recent.icon,
        tone: recent.tone,
        noun: recent.noun,
        route: recent.route,
        reveal: undefined,
        command: undefined,
        tab: undefined,
        into: undefined,
        unavailable: undefined,
        shortcut: undefined,
        order: undefined,
      };
      rows.push(rowFor(cand, { section: RECENT, words: [], availability: () => availability, inert: false, score: 0 }));
    }
  }

  return rows.length === 0 ? undefined : section(RECENT, TITLES[RECENT] ?? '', rows, eligible - rows.length, undefined);
}

/** The places the plugins offer before anything is typed: the plugin homes, or when narrowed to a plugin, its own suggestions for the scope (S73). */
function places(input: ComposeInput, id: string, reports: Map<string, SyncReport>, cap: number): Section {
  const entries = input.entries.filter((entry) => entry.mode === 'match' && entry.ref.kind === 'goto' && participates(entry, input.scope, input.seam.onError));
  const made = listed(input, id, entries, reports, { cap, homesOnly: input.scope.plugin === null });
  return { ...made, id, title: TITLES[id] ?? '', to: id === 'goto' ? 'goto' : undefined };
}

/** Everything the static providers offer for the query, the kind and the chips: the sections, and what became of each provider. */
export function composeStatic(input: ComposeInput): StaticResult {
  const reports = new Map<string, SyncReport>();
  const sections: Section[] = [];
  const empty = input.words.length === 0;
  if (empty && input.kind === 'all') {
    const recent = recentSection(input);
    if (recent !== undefined) {
      sections.push(recent);
    }

    const scoped = input.chips.length > 0;
    const around = places(input, scoped ? SUGGEST : 'goto', reports, capOf(scoped ? SUGGEST : 'goto', 'all'));
    if (around.rows.length > 0) {
      sections.push(around);
    }

    return { sections, reports };
  }

  const groups = new Map<string, Entry[]>();
  for (const entry of input.entries) {
    if (entry.mode === 'match' && shows(entry.ref.kind, input.kind) && participates(entry, input.scope, input.seam.onError)) {
      groups.set(entry.ref.id, [...(groups.get(entry.ref.id) ?? []), entry]);
    }
  }

  for (const [id, entries] of groups) {
    const made = empty ? listed(input, id, entries, reports, { cap: capOf(id, input.kind), homesOnly: false }) : ranked(input, id, entries, reports);
    if (made.rows.length > 0) {
      sections.push(made);
    }
  }

  return { sections, reports };
}

/** What the asynchronous providers said, as sections: a source's rows are held (pending, inert) until it answers the new query (S71). */
export function composeAsync(input: ComposeInput, answers: readonly Answer[]): Section[] {
  const entries = new Map(input.entries.map((entry) => [entry.provider.id, entry]));
  const groups = new Map<string, { readonly entry: Entry; readonly cands: Array<{ readonly cand: Cand; readonly inert: boolean }>; readonly source: string }>();
  for (const answer of answers) {
    const entry = entries.get(answer.id);
    if (entry === undefined || answer.state === 'error' || answer.state === 'timeout' || answer.state === 'idle') {
      continue;
    }

    const group = groups.get(entry.ref.id) ?? { entry, cands: [], source: answer.id };
    groups.set(entry.ref.id, group);
    for (const cand of answer.rows) {
      if (input.kind !== 'commands' || cand.kind === 'command') {
        group.cands.push({ cand, inert: answer.state === 'pending' });
      }
    }
  }

  const out: Section[] = [];
  for (const [id, group] of groups) {
    const cap = capOf(id, input.kind);
    const rows = group.cands.slice(0, cap).map(({ cand, inert }) => rowFor(cand, { section: id, words: input.words, availability: input.seam.availability, inert, score: scoreCandidate(input.words, cand) ?? 0 }));
    if (rows.length > 0) {
      out.push(section(id, group.entry.ref.title, rows, group.cands.length - rows.length, input.kind === 'commands' ? 'commands' : group.entry.ref.kind, group.source));
    }
  }

  return out;
}

export type Arranged = { readonly sections: readonly Section[]; readonly note: Note | undefined; readonly total: number };

type Draft = { id: string; title: string; rows: Row[]; more: number; to: Section['to']; source: string | undefined };

const best = (rows: readonly Row[]): number => rows.reduce((top, row) => (row.inert ? top : Math.max(top, row.score)), 0);

/**
 * The sections in their order, bounded to 50 rows, with the "N more" rows, and what an empty or a failed search shows. With a query the section that holds the best match leads (SE1); a
 * section that only holds rows of an earlier query does not lead, and equal sections keep the default order, so a source that answers late never passes one that matches as well.
 * `pinned` is the order the user has the list in: once they have moved to a row it is kept, and a section that is new comes after them (S71: the list does not move under the cursor).
 */
export function arrange(input: ComposeInput, fixed: readonly Section[], dynamic: readonly Section[], options: { readonly pending: number; readonly pinned: readonly string[] | undefined }): Arranged {
  const groups = [...fixed, ...dynamic].filter((made) => made.rows.length > 0);
  const lead = new Map(groups.map((made) => [made.id, input.words.length === 0 ? 0 : best(made.rows)]));
  const { pinned } = options;
  const compare = (a: Section, b: Section): number => (lead.get(b.id) ?? 0) - (lead.get(a.id) ?? 0) || defaultOrder(a.id, input.entries) - defaultOrder(b.id, input.entries);
  groups.sort((a, b) => {
    const [pa, pb] = [pinned?.indexOf(a.id) ?? -1, pinned?.indexOf(b.id) ?? -1];
    return pa >= 0 || pb >= 0 ? (pa < 0 ? Number.POSITIVE_INFINITY : pa) - (pb < 0 ? Number.POSITIVE_INFINITY : pb) || compare(a, b) : compare(a, b);
  });

  // The whole list is at most 50 rows: the longest section gives one up at a time, so no source crowds out the rest.
  const drafts: Draft[] = groups.map((made) => ({ ...made, rows: [...made.rows] }));
  let count = drafts.reduce((sum, made) => sum + made.rows.length, 0);
  while (count > LIMITS.rows) {
    let longest: Draft | undefined;
    for (const made of drafts) {
      if (longest === undefined || made.rows.length > longest.rows.length) {
        longest = made;
      }
    }

    if (longest === undefined) {
      break;
    }

    longest.rows.pop();
    longest.more += 1;
    count -= 1;
  }

  const counted = count;
  const out: Section[] = drafts.map((made) => {
    if (input.kind === 'all' && made.more > 0 && made.to !== undefined) {
      const more = ownRow({ id: `${made.id}|more`, section: made.id, kind: 'more', title: `${String(made.more)} more in ${made.title}`, context: '', icon: 'ellipsis', action: { type: 'kind', kind: made.to }, availability: AVAILABLE, word: '' });
      return { ...made, rows: [...made.rows, more] };
    }

    return made;
  });

  let summary: Note | undefined;
  if (counted === 0 && options.pending === 0) {
    summary = input.query.trim() === '' ? { type: 'nothing' } : { type: 'no-results', query: input.query.trim() };
    if (input.chips.length > 0) {
      const everywhere = ownRow({ id: `${ACTIONS}|everywhere`, section: ACTIONS, kind: 'everywhere', title: 'Search everywhere', context: 'Remove the scope', icon: 'globe', action: { type: 'everywhere' }, availability: AVAILABLE, word: '' });
      out.unshift(section(ACTIONS, '', [everywhere], 0, undefined));
    }

    // An empty state is somewhere to go from: the plugin's suggestions when narrowed, the plugin homes otherwise.
    const around = places(input, SUGGEST, new Map(), 5);
    if (around.rows.length > 0) {
      out.push(around);
    }
  }

  return { sections: out, note: summary, total: counted };
}
