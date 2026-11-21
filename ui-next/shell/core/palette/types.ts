import type { Availability, Description, Destination, Json, ModifierEvent, OpenHow, OpenOptions, OpenResult, Route, RouteInput, TabId, TabResult } from '../tabs/types';

// The command palette's model: its data, and the seam it calls through (ch16 section D, SE1; design lab `shell-search.js`). Plain data only: no React, no DOM, nothing a
// plugin owns. A provider hands the model CANDIDATES; the model hands the view ROWS, which are data: label parts with the ranges that matched, a tile, a route or a command,
// and what the row says about itself (its availability, whether it is inert). The view decides nothing about ranking, order, focus or what a key does.

/** What a result is (S68). `tool` and `command` run something; the others are places. */
export type ResultKind = 'tab' | 'page' | 'home' | 'scope' | 'type' | 'resource' | 'command' | 'setting' | 'tool';

/** The kinds of result that open a page through the tab model (S64). A command and a tool are not places: they run on Enter and ignore the modifiers. */
export const OPENER_KINDS: readonly ResultKind[] = ['tab', 'page', 'home', 'scope', 'type', 'resource', 'setting'];
export const isOpener = (kind: string): boolean => (OPENER_KINDS as readonly string[]).includes(kind);

/** The rows the model makes for itself, beside the results of the providers. */
export type RowKind = ResultKind | 'more' | 'everywhere' | 'source';

/** The five filters under the input (S67). In the design they are the palette's "scopes"; here a scope is the chain of chips (S69), and this is the KIND filter. */
export type PaletteKind = 'all' | 'goto' | 'tabs' | 'commands' | 'settings';

export type KindInfo = {
  readonly id: PaletteKind;
  readonly label: string;
  /** The first character that selects the kind when it is typed into an empty input (S67; `#` is an addition of the mock). */
  readonly prefix: string | undefined;
  readonly placeholder: string;
};

export const KINDS: readonly KindInfo[] = Object.freeze<KindInfo[]>([
  Object.freeze({ id: 'all', label: 'All', prefix: undefined, placeholder: 'Search pages, resources, commands and settings' }),
  Object.freeze({ id: 'goto', label: 'Go to', prefix: '#', placeholder: 'Search pages and resources' }),
  Object.freeze({ id: 'tabs', label: 'Tabs', prefix: '@', placeholder: 'Search tabs' }),
  Object.freeze({ id: 'commands', label: 'Commands', prefix: '>', placeholder: 'Search commands' }),
  Object.freeze({ id: 'settings', label: 'Settings', prefix: '/', placeholder: 'Search settings' }),
]);

/** The kind a typed prefix selects, or `undefined`. */
export const kindOfPrefix = (character: string): PaletteKind | undefined => KINDS.find((kind) => kind.prefix === character)?.id;

/** The sections the host owns, in the order they lead when they match equally well (SE1: Recent, Tabs, Go to, Commands, Settings, then one section per plugin source). */
export type BuiltinSection = 'tabs' | 'goto' | 'commands' | 'settings';

/** A section of a plugin's own: one heading and its rows. A provider that answers asynchronously always has one (S68: a late answer must not move an actionable row). */
export type CustomSection = {
  /** Unique within the plugin; the model prefixes it with the plugin's id, so two plugins never share a section. */
  readonly id: string;
  /** The heading, 12 px muted, sentence case. */
  readonly title: string;
  /** Which kind filter shows it besides All. Default `goto`. */
  readonly kind?: 'goto' | 'commands' | undefined;
};

export type SectionId = string;

export const RECENT = 'recent';
export const SUGGEST = 'suggest';
export const ACTIONS = 'actions';
export const SOURCES = 'sources';

/** A tone of the kit's `KindTile`: the colour of a kind's glyph. The model knows no kind; the provider says which. */
export type Tone = 'neutral' | 'orange' | 'green' | 'blue' | 'purple' | 'pink' | 'red' | 'teal';
export const TONE_NAMES: readonly Tone[] = ['neutral', 'orange', 'green', 'blue', 'purple', 'pink', 'red', 'teal'];
export const isTone = (value: unknown): value is Tone => typeof value === 'string' && (TONE_NAMES as readonly string[]).includes(value);

/** What draws before a label: a glyph from the kit's registry in a tone (the `KindTile`). A name the kit does not have draws the host's own glyph, as a tab's does. */
export type Tile = { readonly icon: string; readonly tone: Tone };

/** The command a row runs: a registry id, never supplied code (S68). `arg` and `target` are plain data, copied and frozen. */
export type CommandRef = {
  readonly id: string;
  readonly arg?: Json | undefined;
  readonly target?: Json | undefined;
  /** The palette stays open after it ran. */
  readonly keepOpen?: boolean | undefined;
};

/** A step inward (S69): what the chip it adds says. */
export type Into = {
  readonly kind: 'scope' | 'type' | 'resource';
  readonly id: string;
  readonly label: string;
  /** What the chip is, for its accessible name: "scope", "resource type". */
  readonly noun?: string | undefined;
  readonly icon?: string | undefined;
};

/** One chip of the chain that narrows a search (S69): the plugin, then the plugin's own depth. At most `LIMITS.chips`. */
export type Chip = {
  readonly kind: 'plugin' | 'scope' | 'type' | 'resource';
  readonly id: string;
  /** At most 24 characters. */
  readonly label: string;
  readonly plugin: string;
  readonly noun: string;
  readonly icon: string;
};

/** What a provider is asked in: the plugin the palette is narrowed to, the chips under it, and the kind filter. */
export type SearchScope = {
  /** The plugin of the first chip, or `null` when the search is everywhere. */
  readonly plugin: string | null;
  /** The chips under the plugin's: scope, type, resource. */
  readonly chips: readonly Chip[];
  /** The first of them (the connection, the account), for the common case. */
  readonly scope: Chip | null;
  readonly kind: PaletteKind;
};

/** One thing a provider offers. Everything but `id`, `kind` and `title` is optional; a place has a `route`, a command has a `command`, a tab names its `tab`. */
export type Candidate = {
  /** Unique within the provider and stable from one call to the next: it is what keeps a row focused while the list changes. */
  readonly id: string;
  readonly kind: ResultKind;
  readonly title: string;
  /** The muted words after the title: where it is. A place a title does not name says it here once (a path, a scope). */
  readonly context?: string | undefined;
  /** Words that match but are never drawn. They match whole words; the title also matches loosely. */
  readonly keywords?: string | undefined;
  /**
   * Other names the row is known by, apart by spaces: the short name a tool gives the thing (`ws` for Workshops), which the title does not hold. A word of the query that is a whole alias ranks as an exact title
   * match, and one an alias begins with as a prefix of a title (ch16 SE1: an exact or prefix match on a name outranks a substring or loose match in a title); any other match of an alias is a keyword's. Never drawn.
   */
  readonly aliases?: string | undefined;
  /** What the context is matched by when it says more than should be matched: a tab's window name is drawn and never matched (S68). */
  readonly matchContext?: string | undefined;
  readonly icon?: string | undefined;
  readonly tone?: Tone | undefined;
  /** What the kind is called in the row's accessible name ("Resource", "Workload"). Default: the kind's own word. */
  readonly noun?: string | undefined;
  readonly route?: RouteInput | undefined;
  /** What the page is asked to show once it draws (a row of Settings, an object of a list): never part of the route (ch16 K1). */
  readonly reveal?: Json | undefined;
  readonly command?: CommandRef | undefined;
  readonly tab?: TabId | undefined;
  readonly into?: Into | undefined;
  /** The reason the row cannot open or run now. It stays in the list, with the reason, and does nothing (S65). */
  readonly unavailable?: string | true | undefined;
  /** The chord the command is bound to, as the host's keymap says it. The model never invents one (A9). */
  readonly shortcut?: string | undefined;
  /** Breaks a tie between equal scores, lowest first. Default: the candidate's place in the provider's list. */
  readonly order?: number | undefined;
};

/** What an asynchronous provider answers: the candidates, in its own order, and what it knows about what it did not return. */
export type ProviderAnswer = {
  readonly rows: readonly Candidate[];
  /** The provider has more than it returned: how many in all. */
  readonly limited?: number | undefined;
  /** A part of the source did not answer; these are the results of the rest. */
  readonly partial?: boolean | undefined;
  /** Its results do not refresh until live updates resume. */
  readonly live?: boolean | undefined;
  readonly message?: string | undefined;
};

/**
 * A source of results, registered by the host (`plugin: 'host'`) or by a plugin. It has exactly one of the two ways to answer:
 *
 * - `match(query, scope)`: SYNCHRONOUS, for a small set that is already in memory (open tabs, a plugin's pages, commands, settings). It returns the candidates that could answer the
 *   query; the model scores, filters and ranks them, so a provider may return its whole list and ignore the query. It runs on every keystroke and must be cheap.
 * - `search(query, scope, signal)`: ASYNCHRONOUS and cancellable, for a set that is too large to hold or that lives elsewhere (the objects of a connection). The provider does its own
 *   matching and returns the best candidates in order. The model debounces it, aborts it when the query changes, bounds what it returns, and contains its failures.
 */
export type Provider = {
  /** Unique in the palette. A plugin's providers are `<plugin id>:<name>`. */
  readonly id: string;
  /** The owner; `host` for the host's own. A plugin that leaves takes its providers with it. */
  readonly plugin: string;
  /** How a chip and a source name the plugin. Default: its id. */
  readonly pluginName?: string | undefined;
  readonly pluginIcon?: string | undefined;
  /** What the source is called in a status run and in the Sources list ("Resources"). Default: its id. */
  readonly title?: string | undefined;
  readonly section: BuiltinSection | CustomSection;
  readonly match?: ((query: string, scope: SearchScope) => readonly Candidate[]) | undefined;
  readonly search?: ((query: string, scope: SearchScope, signal: AbortSignal) => Promise<readonly Candidate[] | ProviderAnswer>) | undefined;
  /** An asynchronous provider's rows at most; never above `LIMITS.rowsPerProvider`. */
  readonly limit?: number | undefined;
  /** False: the provider has nothing to say in this scope and is not asked (S69). */
  readonly supports?: ((scope: SearchScope) => boolean) | undefined;
};

/** Where a provider's rows go: the section's id, heading and kind filter. */
export type SectionRef = { readonly id: SectionId; readonly title: string; readonly kind: 'tabs' | 'goto' | 'commands' | 'settings' };

export const LIMITS = Object.freeze({
  /** The input's `maxlength`. */
  query: 256,
  /** Words of a query that count; the rest are ignored. */
  words: 8,
  /** Destinations remembered (S73). */
  recents: 8,
  /** The plugin's chip and three under it (S69). */
  chips: 4,
  /** A chip's label (ch16 S10). */
  chipLabel: 24,
  /** Asynchronous providers asked for one query (S71); the rest are named by the Source limit run. */
  providers: 8,
  /** Asynchronous searches in flight at once (S71). */
  inFlight: 4,
  /** Rows kept from one asynchronous provider (S71). */
  rowsPerProvider: 20,
  /** Candidates read from one synchronous provider. A provider with more is a `search`, and the source says it was limited. */
  candidates: 50_000,
  /** Rows in the whole list (S68). */
  rows: 50,
  /** PageUp and PageDown (the mock). */
  page: 8,
  /** Status runs the band shows before it folds the rest into `+N` (S72). */
  runs: 3,
});

export const TIMING = Object.freeze({
  /** Quiet time after the last keystroke before the asynchronous providers are asked (S71). */
  debounce: 150,
  /** An asynchronous provider that has not answered by then has failed (S71). */
  timeout: 5000,
  /** The loader appears after this long (ch 05: progress is shown only for work that lasts more than a second). */
  loader: 1000,
  /** The result sentence is announced once the results have been still this long (S86). */
  announce: 450,
});

/** A range of a text, by the index of its first character and the index after its last. */
export type Range = readonly [start: number, end: number];

export type LabelPart = { readonly text: string; readonly match: boolean };

/** A label as data: its text, the ranges of it that matched the query, and the text cut at them. The view draws the matched parts in weight 600, never in colour alone. */
export type Label = { readonly text: string; readonly ranges: readonly Range[]; readonly parts: readonly LabelPart[] };

/** What `Enter` (or a click) does with a row. A view reads this and nothing else. */
export type RowAction =
  | { readonly type: 'open'; readonly destination: Destination }
  | { readonly type: 'activate'; readonly tab: TabId; readonly destination: Destination | undefined }
  | { readonly type: 'run'; readonly command: CommandRef }
  | { readonly type: 'kind'; readonly kind: PaletteKind }
  | { readonly type: 'everywhere' }
  | { readonly type: 'retry'; readonly source: string }
  | { readonly type: 'none' };

export type Row = {
  /** `section|key`: unique in a snapshot, and the same from one snapshot to the next while the result is the same. It is what keeps the focus. */
  readonly id: string;
  /** The result's identity: `provider|candidate id`. */
  readonly key: string;
  readonly section: SectionId;
  readonly kind: RowKind;
  /** The kind in words ("Resource"), for the accessible name. */
  readonly noun: string;
  readonly title: Label;
  readonly context: Label;
  readonly tile: Tile | undefined;
  readonly plugin: string;
  /** The canonical route a place opens, for its address and for the recent list. */
  readonly route: Route | undefined;
  readonly action: RowAction;
  /** S65: available; degraded (it opens a recovery page: show the state and the word); unavailable (`aria-disabled`, still focusable, the reason as its tooltip and in the footer). */
  readonly availability: Availability;
  /** What the trailing slot says of the state: `Unavailable`, `Degraded`, or for a source `Searching…`, `Timed out`; empty for a row that is available. */
  readonly word: string;
  /** The row answers an earlier query and its source has not answered this one: it stays where it is, undimmed, and does nothing until the answer comes (S71). */
  readonly inert: boolean;
  /** The step `→` and the row's `›` take inward (S69); absent for a row that cannot be searched inside, and for one that cannot open. */
  readonly into: Into | undefined;
  readonly shortcut: string | undefined;
  /** `<noun>: <title>, <context>, <what the state says>`. */
  readonly name: string;
  /** The rank score of this row for the query, `0` for an unranked row. For tests and diagnostics: a view does not read it. */
  readonly score: number;
};

export type Section = {
  readonly id: SectionId;
  readonly title: string;
  readonly rows: readonly Row[];
  /** Matches that are not in `rows` (a cap, or the whole list's bound). */
  readonly more: number;
  /** The kind filter that shows this section whole: where "N more in X" leads. Absent for a section that has none (Recent, Suggestions). */
  readonly to: PaletteKind | undefined;
  /** The source of an asynchronous section. */
  readonly source: string | undefined;
};

export type SourceState = 'idle' | 'pending' | 'ready' | 'partial' | 'limited' | 'error' | 'timeout';

/** What the model knows of one provider for the current search (S72). */
export type Source = {
  readonly id: string;
  readonly plugin: string;
  readonly pluginName: string;
  readonly title: string;
  readonly mode: 'match' | 'search';
  readonly state: SourceState;
  /** Rows it holds now (`0` while it has none). */
  readonly rows: number;
  /** How many results the provider says it has in all, when it returned fewer. */
  readonly limited: number;
  readonly attempts: number;
  /** The cause, for an error or a timeout; the provider's own message otherwise. */
  readonly message: string;
  /** How long its last answer took, in milliseconds. */
  readonly ms: number;
  readonly live: boolean;
  /** Candidates and results the model dropped because they were not valid data. */
  readonly invalid: number;
};

export type RunTone = 'error' | 'warning' | 'info';

/** One thing the status band says (S72): a source that did not answer, answered in part or was limited, live updates that stopped, the sources that were left out. */
export type Run = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly tone: RunTone;
  /** The run has a Retry. */
  readonly retry: boolean;
  readonly message: string;
};

/** One key of the footer line (S70, A5): the chord as `Mod+Shift+Enter`, and what it does. The view draws it with the platform's own glyphs. */
export type Hint = { readonly keys: string; readonly label: string };

/** What a chip was entered from, restored when it is removed (S69). */
export type Memo = { readonly query: string; readonly kind: PaletteKind; readonly active: string };

export type Note =
  /** A query that matched nothing: `No results for "…"`. */
  | { readonly type: 'no-results'; readonly query: string }
  /** An empty query with nothing to offer yet. */
  | { readonly type: 'nothing' };

/** A destination the user opened (S73): what draws it before its plugin has loaded, and what opens it again. */
export type Recent = {
  readonly key: string;
  readonly route: Route;
  /** Which kind of row it comes back as. */
  readonly kind: 'page' | 'home' | 'scope' | 'type' | 'resource' | 'setting';
  readonly noun: string;
  readonly title: string;
  readonly context: string;
  readonly icon: string;
  readonly tone: Tone;
};

export const PALETTE_VERSION = 1;

/** What the session saves of a recent: everything but the key, which is made from the route. */
export type PersistedRecent = Omit<Recent, 'key'>;

/** What the session saves of the palette: the version first, then the recents, newest first. Nothing else is remembered: a query, the chips and the kind mean "now". */
export type PersistedPalette = { readonly version: typeof PALETTE_VERSION; readonly recents: readonly PersistedRecent[] };

export type PaletteState = {
  readonly version: typeof PALETTE_VERSION;
  readonly open: boolean;
  /** What the input shows. A typed prefix is consumed: it is in `kind`. */
  readonly query: string;
  readonly kind: PaletteKind;
  readonly view: 'results' | 'sources';
  readonly chips: readonly Chip[];
  readonly memo: readonly Memo[];
  /** The chip that is selected, for the keyboard (`←` from the input), or `-1`. */
  readonly chip: number;
  readonly composing: boolean;
  /** The sections in order, and their rows flat; each row is in both. */
  readonly sections: readonly Section[];
  readonly rows: readonly Row[];
  /** The row `Enter` acts on: the id, its place in `rows` and the row, or `''`, `-1` and `undefined` when there is none. */
  readonly active: string;
  readonly activeIndex: number;
  /** The user moved to the active row (an arrow key, the pointer). It is then kept by id while the list changes and nothing above it moves; until then it is the first row that can be opened. */
  readonly focused: boolean;
  readonly note: Note | undefined;
  /** Results counted for the sentence: the rows that are results, not the rows the model made. */
  readonly total: number;
  /** A source has not answered. */
  readonly searching: boolean;
  /** A source has been pending for the loader's time (1 s). */
  readonly slow: boolean;
  /** The runs beyond the three the status band shows: they fold into one `+N` that opens the Sources list (S72). */
  readonly folded: number;
  readonly sources: readonly Source[];
  readonly runs: readonly Run[];
  readonly hints: readonly Hint[];
  /** "12 results", "No results. 1 source didn't answer": what a live region says about the list as it stands. The model tells `PaletteSeam.announce` once, when the results have settled. */
  readonly sentence: string;
  /** What the last refusal said ("Stack: needs an update"), until the next change. */
  readonly notice: string;
  /** The id of the row whose command is running; one command at a time. */
  readonly running: string;
  readonly recents: readonly Recent[];
};

/** What a command answers. `false` or `{ ok: false }` refuses (the palette stays open and says why). */
export type CommandOutcome = boolean | void | { readonly ok?: boolean | undefined; readonly reason?: string | undefined; readonly keepOpen?: boolean | undefined; readonly refresh?: boolean | undefined };

export type ActivateResult =
  /** A place went through the tab model; the palette closed unless the model refused. */
  | { readonly status: 'opened'; readonly result: OpenResult | TabResult }
  | { readonly status: 'ran'; readonly outcome: 'done' | 'refused' | 'pending'; readonly done: Promise<CommandOutcome> | undefined }
  /** The row changed the palette itself: a kind, the scope, a retry. */
  | { readonly status: 'changed' }
  | { readonly status: 'refused'; readonly reason: 'none' | 'inert' | 'unavailable' | 'closed' | 'busy' | 'invalid'; readonly message: string };

export type Focus = { readonly target: 'input'; readonly caret: 'start' | 'end' } | { readonly target: 'chip'; readonly index: number };

export type KeyInput = ModifierEvent & {
  readonly key: string;
  /** An IME composition is in progress. */
  readonly isComposing?: boolean | undefined;
  readonly repeat?: boolean | undefined;
  /** Where the key went: the input, or a chip. */
  readonly target?: 'input' | 'chip' | undefined;
  /** The chip, when the target is one. */
  readonly index?: number | undefined;
  /** Where the caret is in the input. */
  readonly caret?: { readonly atStart: boolean; readonly atEnd: boolean } | undefined;
};

/** What a key did: whether the model took it (the view calls `preventDefault`), and where the focus goes next. */
export type KeyOutcome = { readonly handled: boolean; readonly focus?: Focus | undefined; readonly result?: ActivateResult | undefined };

/** What the palette needs of the host. Every member but `tabs` is optional. */
export type PaletteSeam = {
  /** Places open through the tab model (S64): `open` with `source: 'search'`, and `activate` for a tab's own row. */
  readonly open: (destination: Destination, options: OpenOptions) => OpenResult;
  readonly activate?: ((id: TabId) => TabResult) | undefined;
  /** Runs a command of the host's registry. Revalidated by the host immediately before it runs. */
  readonly run?: ((command: CommandRef, context: { readonly source: 'palette' }) => CommandOutcome | Promise<CommandOutcome>) | undefined;
  /** Whether a route can open (S65). The tab model's own `Contributions.availability`. Absent: every route is available. */
  readonly availability?: ((route: Route) => Availability) | undefined;
  /** What a plugin says about a route now; the recent list is described again with it (title, glyph, path). */
  readonly describe?: ((route: Route) => Description | undefined) | undefined;
  /** Where a live region is told something: a refusal, and the result sentence once it has settled. */
  readonly announce?: ((text: string) => void) | undefined;
};

export type OpenPalette = {
  readonly query?: string | undefined;
  readonly kind?: PaletteKind | undefined;
  /** The chips to start with: `[]` or absent for none (S69). `seedChips` builds the pair for the tab on screen. */
  readonly scope?: readonly Chip[] | undefined;
  /** The route on screen: it is left out of the recent list, so the first recent is where the user was before (S73). */
  readonly current?: Route | undefined;
};

/** A destination to remember, by what the caller knows of it: what the plugin says about the route fills in the rest. */
export type RecordInput = {
  readonly route: RouteInput;
  readonly kind?: Recent['kind'] | undefined;
  readonly title?: string | undefined;
  readonly context?: string | undefined;
  readonly icon?: string | undefined;
  readonly tone?: Tone | undefined;
  readonly noun?: string | undefined;
};

export type Registration = {
  readonly ok: boolean;
  /** Why a provider was refused. Empty when it was taken. */
  readonly reason: string;
  /** Withdraws the provider (and what it had answered). Does nothing for a refused one. */
  readonly remove: () => void;
};

export type Scheduler = {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type ErrorHook = (error: unknown, where: string) => void;

export type { Availability, Description, Destination, Json, ModifierEvent, OpenHow, OpenOptions, OpenResult, Route, RouteInput, TabId, TabResult };
