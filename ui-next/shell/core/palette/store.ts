import { dispositionOf } from '../tabs/disposition';
import { isObject } from '../tabs/json';
import { arrange, composeAsync, composeStatic, participates, TITLES, type ComposeInput, type Entry, type Seam, type StaticResult } from './compose';
import { wordsOf } from './match';
import { record, recentOf, routeKey, serialiseRecents } from './recents';
import { AVAILABLE, chipOf, clip, ownRow, sentenceCase } from './results';
import { createRunner, type AsyncSource, type Runner } from './runner';
import { failedCount, hintsOf, plural, runsOf, sentenceOf, sourcesOf, type Named, type SyncReport } from './status';
import {
  kindOfPrefix,
  LIMITS,
  PALETTE_VERSION,
  SOURCES,
  TIMING,
  type ActivateResult,
  type Availability,
  type Chip,
  type CommandOutcome,
  type CommandRef,
  type Description,
  type ErrorHook,
  type Focus,
  type KeyInput,
  type KeyOutcome,
  type Memo,
  type ModifierEvent,
  type Note,
  type OpenHow,
  type OpenPalette,
  type PaletteKind,
  type PaletteSeam,
  type PaletteState,
  type PersistedPalette,
  type Provider,
  type RecordInput,
  type Recent,
  type Registration,
  type Route,
  type Row,
  type Scheduler,
  type SearchScope,
  type Section,
  type SectionRef,
} from './types';

// The store: one immutable snapshot, `subscribe`, and the operations. It is the shape `useSyncExternalStore` wants (`getSnapshot` and `subscribe`), and nothing in it knows React. The
// tab model's store (../tabs/store.ts) is the pattern. The snapshot is the whole palette as data (rows, sections, the active row, the status runs, the keys of the footer, the sentence);
// the view draws it and calls the operations. What a key does, what a row does when it is chosen, and the order of everything, are decided here.

export type PaletteOptions = PaletteSeam & {
  /** The recents to start with: what `restoreRecents` read. */
  readonly initial?: readonly Recent[] | undefined;
  /** Timers and the clock. Default: the platform's. A test drives its own. */
  readonly scheduler?: Scheduler | undefined;
  /** Which key is the command key: Command on macOS, Control elsewhere (S64). Default `other`. */
  readonly platform?: 'mac' | 'other' | undefined;
  /** Hears every failure of a plugin's code. Default: the console. */
  readonly onError?: ErrorHook | undefined;
  /** Whether the host can open a window of its own (Shift+Enter, S64). Default `false`: the footer does not say New window and the key is refused with the reason, until a host that can says so. */
  readonly windows?: boolean | undefined;
  /** Whether choosing a row records its own route as a recent. Default `true`. A host that records what its tab model made of the open (the route with the connection the tab was given) turns it off and does. */
  readonly recordOpens?: boolean | undefined;
};

export type PaletteStore = {
  readonly getSnapshot: () => PaletteState;
  /** Called after every change of the snapshot, and never for an operation that changed nothing. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Called with the new value when what `select` reads changed by `equals` (default `Object.is`). */
  readonly subscribeTo: <T>(select: (state: PaletteState) => T, listener: (value: T, previous: T) => void, equals?: (a: T, b: T) => boolean) => () => void;

  /** Registers a source of results (the host's, `plugin: 'host'`, or a plugin's). A provider that is not valid is refused, with the reason. Registered again under its id it replaces the one before. */
  readonly registerProvider: (provider: Provider) => Registration;
  /** A plugin left (PO1): its providers, its pending requests and its rows go in one change, and so do the chips that narrowed the search to it. */
  readonly removePlugin: (plugin: string) => boolean;
  /**
   * What the static providers say changed (a tab opened, a command became unavailable): the list is made again. `moved`: the shell went somewhere else while the palette was open, and Recent leaves out the place the
   * user is on, so it is the new one; the query and the chips stay.
   */
  readonly refresh: (moved?: { readonly route: Route | undefined }) => void;

  readonly open: (options?: OpenPalette) => boolean;
  readonly close: () => boolean;
  readonly toggle: (options?: OpenPalette) => boolean;

  /** What the input holds. A first character that names a kind is taken into the kind (S67). */
  readonly setQuery: (text: string) => void;
  readonly compositionStart: () => void;
  /** The IME finished with `text`: only now is it searched. */
  readonly compositionEnd: (text: string) => void;
  readonly setKind: (kind: PaletteKind) => boolean;
  readonly showSources: () => boolean;
  readonly showResults: () => boolean;

  /** `→`, or a row's `›`: search inside the row (the active one by default). */
  readonly enter: (id?: string) => boolean;
  readonly removeChip: (index: number) => boolean;
  readonly selectChip: (index: number) => boolean;
  /** Search everywhere: the chips go, the query stays. */
  readonly clearChips: () => boolean;

  readonly move: (delta: number, options?: { readonly wrap?: boolean | undefined }) => boolean;
  /** The pointer moved to a row: it is the active row, and the user's. */
  readonly focus: (id: string) => boolean;
  /** Enter, or a click, on a row (the active one by default). A disposition is a modifier event, or one of the five. */
  readonly activate: (id?: string, how?: ModifierEvent | OpenHow) => ActivateResult;
  /** A key pressed in the input or on a chip: what it did, and where the focus goes. */
  readonly key: (input: KeyInput) => KeyOutcome;

  readonly retry: (source: string) => boolean;
  readonly retryAll: () => number;

  /** Remembers a place the user went to (a tab they switched to, a page they opened another way). */
  readonly record: (input: RecordInput) => boolean;
  readonly clearRecents: () => boolean;
  /** What the session saves; see `restoreRecents` for the way back and `createPaletteSaver` for the writing. */
  readonly serialise: () => PersistedPalette;
  /** Stops listening, drops the timers and the requests. */
  readonly dispose: () => void;
};

type Core = {
  open: boolean;
  query: string;
  /** The last query that was typed or composed, not a composition in progress: the prefix rule asks if it was empty. */
  applied: string;
  kind: PaletteKind;
  view: 'results' | 'sources';
  chips: readonly Chip[];
  memo: readonly Memo[];
  chip: number;
  composing: boolean;
  /** The row the user moved to; empty until they do. */
  active: string;
  current: Route | undefined;
  running: string;
  notice: string;
  recents: readonly Recent[];
};

const fresh = (recents: readonly Recent[]): Core => ({ open: false, query: '', applied: '', kind: 'all', view: 'results', chips: [], memo: [], chip: -1, composing: false, active: '', current: undefined, running: '', notice: '', recents });

const ASYNC_KINDS: readonly PaletteKind[] = ['all', 'goto', 'commands'];
const BUILTIN_SECTIONS: readonly string[] = ['tabs', 'goto', 'commands', 'settings'];
const RECENT_KINDS: readonly string[] = ['page', 'home', 'scope', 'type', 'resource', 'setting'];

const platformScheduler: Scheduler = {
  now: () => globalThis.performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const logError: ErrorHook = (error, where) => {
  console.error(`[palette] ${where}`, error);
};

const closedState = (recents: readonly Recent[]): PaletteState =>
  Object.freeze({
    version: PALETTE_VERSION,
    open: false,
    query: '',
    kind: 'all',
    view: 'results',
    chips: Object.freeze([]),
    memo: Object.freeze([]),
    chip: -1,
    composing: false,
    sections: Object.freeze([]),
    rows: Object.freeze([]),
    active: '',
    activeIndex: -1,
    focused: false,
    note: undefined,
    total: 0,
    searching: false,
    slow: false,
    folded: 0,
    sources: Object.freeze([]),
    runs: Object.freeze([]),
    hints: Object.freeze([]),
    sentence: '',
    notice: '',
    running: '',
    recents,
  });

export type SeedInput = {
  readonly plugin: string;
  readonly pluginName: string;
  readonly pluginIcon?: string | undefined;
  readonly scope?: { readonly id: string; readonly label: string } | undefined;
  readonly scopeNoun?: string | undefined;
  readonly scopeIcon?: string | undefined;
  /** False: this plugin does not want the palette narrowed to the tab it is on (ch16 S69). */
  readonly seed?: boolean | undefined;
};

/** The chips the palette opens with when it is opened from a tab that has a scope (S69): the plugin's, then the scope's. None when the tab has no scope or its plugin opts out. */
export function seedChips(input: SeedInput): readonly Chip[] {
  if (input.scope === undefined || input.seed === false) {
    return [];
  }

  return Object.freeze([
    Object.freeze<Chip>({ kind: 'plugin', id: input.plugin, label: input.pluginName, plugin: input.plugin, noun: 'plugin', icon: input.pluginIcon ?? '' }),
    Object.freeze<Chip>({ kind: 'scope', id: input.scope.id, label: clip(input.scope.label, LIMITS.chipLabel), plugin: input.plugin, noun: input.scopeNoun ?? 'scope', icon: input.scopeIcon ?? '' }),
  ]);
}

const stable = (chips: readonly Chip[]): string => chips.map((chip) => `${chip.kind}:${chip.id}`).join('|');

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error && error.message !== '' ? error.message : fallback);

const isThenable = (value: unknown): value is PromiseLike<unknown> => isObject(value) && typeof value.then === 'function';

/** A provider is valid when it has an id, a plugin, one way to answer and a section its way may use. */
function readProvider(provider: unknown): { readonly ok: true; readonly entry: Omit<Entry, 'index'> } | { readonly ok: false; readonly reason: string } {
  if (!isObject(provider)) {
    return { ok: false, reason: 'A provider is an object.' };
  }

  const { id, plugin, match, search, section } = provider as Partial<Provider>;
  if (typeof id !== 'string' || id.trim() === '' || typeof plugin !== 'string' || plugin.trim() === '') {
    return { ok: false, reason: 'A provider needs an id and the plugin it belongs to.' };
  }

  const hasMatch = typeof match === 'function';
  const hasSearch = typeof search === 'function';
  if (hasMatch === hasSearch) {
    return { ok: false, reason: 'A provider has exactly one way to answer: `match` for a small set held in memory, or `search` for a large one asked on demand.' };
  }

  const pluginName = typeof provider.pluginName === 'string' && provider.pluginName.trim() !== '' ? provider.pluginName.trim() : sentenceCase(plugin);
  let ref: SectionRef;
  if (typeof section === 'string') {
    if (!BUILTIN_SECTIONS.includes(section) || hasSearch) {
      return { ok: false, reason: hasSearch ? 'A provider that answers asynchronously has a section of its own: its late rows must not move rows that are already shown.' : `There is no section "${section}".` };
    }

    ref = { id: section, title: TITLES[section] ?? section, kind: section };
  } else if (isObject(section) && typeof section.id === 'string' && section.id.trim() !== '' && typeof section.title === 'string' && section.title.trim() !== '') {
    const kind = section.kind === 'commands' ? 'commands' : 'goto';
    ref = { id: `${plugin}:${section.id}`, title: `${pluginName} · ${section.title.trim()}`, kind };
  } else {
    return { ok: false, reason: 'A section is one of the host\'s (tabs, goto, commands, settings) or `{ id, title }`.' };
  }

  const limit = typeof provider.limit === 'number' && Number.isFinite(provider.limit) && provider.limit >= 1 ? Math.min(LIMITS.rowsPerProvider, Math.floor(provider.limit)) : LIMITS.rowsPerProvider;
  const pluginIcon = typeof provider.pluginIcon === 'string' && provider.pluginIcon !== '' ? provider.pluginIcon : undefined;
  const title = typeof provider.title === 'string' && provider.title.trim() !== '' ? provider.title.trim() : id;
  return { ok: true, entry: { provider: provider as Provider, mode: hasMatch ? 'match' : 'search', ref, owner: { provider: id, plugin, pluginName, pluginIcon, section: ref.id }, pluginName, title, limit } };
}

export function createPaletteStore(options: PaletteOptions): PaletteStore {
  const scheduler = options.scheduler ?? platformScheduler;
  const onError = options.onError ?? logError;
  const platform = options.platform ?? 'other';
  let core: Core = fresh(Object.freeze([...(options.initial ?? [])]));
  let state: PaletteState = closedState(core.recents);
  let signature = JSON.stringify(state);
  const listeners = new Set<() => void>();
  const entries = new Map<string, Entry>();
  let sequence = 0;
  /** Raised when what the static providers say, or what the host says of a route, may have changed. */
  let revision = 0;
  let recentsRevision = 0;
  let memo: { readonly key: string; readonly value: StaticResult } | undefined;
  let overflow = 0;
  let shape = '';
  let announced = '';
  let settle: unknown;
  let session = 0;
  let batching = 0;
  let disposed = false;

  const guarded = <T>(run: () => T, fallback: T, where: string): T => {
    try {
      return run();
    } catch (error) {
      onError(error, where);
      return fallback;
    }
  };

  const seam: Seam = {
    availability: (route) => {
      const answer = guarded<unknown>(() => options.availability?.(route), undefined, `availability() of ${route.plugin}`);
      if (isObject(answer) && answer.state === 'unavailable') {
        return Object.freeze({ state: 'unavailable', reason: typeof answer.reason === 'string' ? answer.reason : '' });
      }

      return isObject(answer) && answer.state === 'degraded' ? Object.freeze({ state: 'degraded', ...(typeof answer.reason === 'string' ? { reason: answer.reason } : {}) }) : AVAILABLE;
    },
    describe: (route) => {
      const answer = guarded<unknown>(() => options.describe?.(route), undefined, `describe() of ${route.plugin}`);
      return isObject(answer) ? (answer as Description) : undefined;
    },
    onError,
  };

  const scopeOf = (): SearchScope => {
    const below = core.chips.slice(1);
    return { plugin: core.chips[0]?.plugin ?? null, chips: below, scope: below[0] ?? null, kind: core.kind };
  };

  const inputOf = (): ComposeInput => ({ query: core.query, words: wordsOf(core.query), kind: core.kind, chips: core.chips, scope: scopeOf(), entries: [...entries.values()], recents: core.recents, current: core.current, seam });

  const named = (): Map<string, Named> => new Map([...entries.values()].map((entry) => [entry.provider.id, { provider: entry.provider, pluginName: entry.pluginName, title: entry.title }]));

  const sourceRows = (reports: ReadonlyMap<string, SyncReport>): Row[] => {
    const rows: Row[] = [];
    const names = named();
    for (const answer of runner.answers()) {
      const who = `${answer.source.pluginName} · ${answer.source.title}`;
      let word = '';
      let availability: Availability = AVAILABLE;
      let context = `${plural(answer.rows.length, 'result')}${answer.ms > 0 ? ` · ${String(answer.ms)} ms` : ''}${answer.live ? '' : ' · no live updates'}`;
      if (answer.state === 'pending') {
        [word, availability, context] = ['Searching…', { state: 'degraded', reason: '' }, ''];
      } else if (answer.state === 'error' || answer.state === 'timeout') {
        [word, availability, context] = [answer.word === '' ? 'Unavailable' : answer.word, { state: 'degraded', reason: answer.message }, answer.message];
      } else if (answer.state === 'partial') {
        [word, availability] = ['Partial results', { state: 'degraded', reason: answer.message }];
      } else if (answer.state === 'limited') {
        [word, availability] = [`Showing ${String(answer.rows.length)} of ${String(answer.limited)}`, { state: 'degraded', reason: '' }];
      }

      const failed = answer.state === 'error' || answer.state === 'timeout';
      rows.push(ownRow({ id: `${SOURCES}|${answer.id}`, section: SOURCES, kind: 'source', title: who, context, icon: 'puzzle', action: failed ? { type: 'retry', source: answer.id } : { type: 'none' }, availability, word }));
    }

    for (const [id, report] of reports) {
      const who = names.get(id);
      if (who !== undefined && report.error !== '') {
        rows.push(ownRow({ id: `${SOURCES}|${id}`, section: SOURCES, kind: 'source', title: `${who.pluginName} · ${who.title}`, context: report.error, icon: 'puzzle', action: { type: 'retry', source: id }, availability: { state: 'degraded', reason: report.error }, word: 'Unavailable' }));
      }
    }

    return rows;
  };

  const build = (): PaletteState => {
    if (!core.open) {
      return closedState(core.recents);
    }

    const input = inputOf();
    const key = `${String(revision)}|${String(recentsRevision)}|${core.kind}|${core.query.trim()}|${stable(core.chips)}|${core.current === undefined ? '' : routeKey(core.current)}`;
    if (memo?.key !== key) {
      memo = { key, value: composeStatic(input) };
    }

    const fixed = memo.value;
    const answers = runner.answers();
    const pending = runner.pending();
    let sections: readonly Section[];
    let summary: Note | undefined;
    let total: number;
    if (core.view === 'sources') {
      const rows = sourceRows(fixed.reports);
      sections = rows.length === 0 ? [] : [{ id: SOURCES, title: 'Sources', rows, more: 0, to: undefined, source: undefined }];
      summary = undefined;
      total = 0;
    } else {
      const arranged = arrange(input, fixed.sections, composeAsync(input, answers), { pending, pinned: core.active === '' ? undefined : state.sections.map((section) => section.id) });
      ({ sections, note: summary, total } = arranged);
    }

    // A command that is running is inert: one at a time (the row of the one that runs, and no other, is refused as busy).
    if (core.running !== '') {
      sections = sections.map((section) => (section.rows.some((row) => row.id === core.running) ? { ...section, rows: section.rows.map((row) => (row.id === core.running ? Object.freeze({ ...row, inert: true }) : row)) } : section));
    }

    const rows = sections.flatMap((section) => section.rows);
    // The active row. A row the user moved to is kept by id, and when it is gone the one at the same place; before they move it is the first row that can be opened (S71, SE1).
    let index = -1;
    let focused = false;
    if (rows.length > 0) {
      if (core.active !== '') {
        focused = true;
        index = rows.findIndex((row) => row.id === core.active);
        if (index < 0) {
          index = Math.min(Math.max(state.activeIndex, 0), rows.length - 1);
          core = { ...core, active: rows[index]?.id ?? '' };
        }
      } else {
        index = rows.findIndex((row) => !row.inert && row.availability.state !== 'unavailable');
        index = index < 0 ? 0 : index;
      }
    } else if (core.active !== '') {
      core = { ...core, active: '' };
    }

    const active = rows[index];
    const failed = failedCount(answers, fixed.reports);
    const names = named();
    const runs = runsOf(names, answers, fixed.reports, overflow);
    return Object.freeze({
      version: PALETTE_VERSION,
      open: true,
      query: core.query,
      kind: core.kind,
      view: core.view,
      chips: core.chips,
      memo: core.memo,
      chip: core.chip,
      composing: core.composing,
      sections: Object.freeze(sections.map((section) => Object.freeze({ ...section, rows: Object.freeze([...section.rows]) }))),
      rows: Object.freeze(rows),
      active: active?.id ?? '',
      activeIndex: index,
      focused,
      note: summary,
      total,
      searching: pending > 0,
      slow: runner.slow(),
      folded: Math.max(0, runs.length - LIMITS.runs),
      sources: Object.freeze(sourcesOf(names, answers, fixed.reports)),
      runs: Object.freeze(runs),
      hints: Object.freeze(hintsOf(active, core.view, options.windows === true)),
      sentence: sentenceOf(total, failed),
      notice: core.notice,
      running: core.running,
      recents: core.recents,
    });
  };

  const announce = (text: string): void => {
    guarded(() => options.announce?.(text), undefined, 'announce()');
  };

  /** The sentence is told once, when the results have settled and been still for a moment (S86), and never for an empty input. */
  const armSettle = (): void => {
    scheduler.clearTimeout(settle);
    settle = undefined;
    if (core.open && !disposed) {
      settle = scheduler.setTimeout(() => {
        settle = undefined;
        if (core.open && runner.pending() === 0 && core.query.trim() !== '' && state.sentence !== announced) {
          announced = state.sentence;
          announce(state.sentence);
        }
      }, TIMING.announce);
    }
  };

  const publish = (): void => {
    const next = build();
    const text = JSON.stringify(next);
    if (text === signature) {
      return;
    }

    signature = text;
    state = next;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const rebuild = (): void => {
    if (disposed) {
      return;
    }

    publish();
    armSettle();
  };

  const runner: Runner = createRunner({
    scheduler,
    onError,
    onChange: () => {
      if (batching === 0) {
        rebuild();
      }
    },
  });

  /** One operation, one change: whatever the runner reports while it runs is folded into the one snapshot that ends it. */
  const act = <T>(run: () => T): T => {
    batching += 1;
    let result: T;
    try {
      result = run();
    } finally {
      batching -= 1;
    }

    if (batching === 0) {
      rebuild();
    }

    return result;
  };

  /** The providers that would be asked now, at most eight (S71): none for an empty unscoped query, the Tabs kind or the Settings kind. */
  const wanted = (): { readonly list: readonly AsyncSource[]; readonly overflow: number } => {
    if (!core.open || !ASYNC_KINDS.includes(core.kind) || (core.query.trim() === '' && core.chips.length === 0)) {
      return { list: [], overflow: 0 };
    }

    const scope = scopeOf();
    const list: AsyncSource[] = [];
    let left = 0;
    for (const entry of entries.values()) {
      if (entry.mode === 'search' && participates(entry, scope, onError)) {
        if (list.length >= LIMITS.providers) {
          left += 1;
        } else {
          list.push({ id: entry.provider.id, provider: entry.provider, owner: entry.owner, pluginName: entry.pluginName, title: entry.title, limit: entry.limit });
        }
      }
    }

    return { list, overflow: left };
  };

  /** The query, the chips or the kind changed: supersede everything in flight, keep the rows of the sources that still apply (inert while pending), ask again after the debounce. */
  const touch = (immediate: boolean): void => {
    const asked = wanted();
    const next = `${core.kind}|${stable(core.chips)}`;
    runner.begin({ query: core.query, scope: scopeOf() }, asked.list, { immediate, keep: next === shape });
    shape = next;
    overflow = asked.overflow;
    announced = '';
  };

  /** A provider arrived or left while the palette is open: a source that is new is asked at once. */
  const sync = (): void => {
    if (!core.open) {
      return;
    }

    const asked = wanted();
    const have = new Set(runner.answers().map((answer) => answer.id));
    if (asked.list.some((source) => !have.has(source.id))) {
      touch(true);
    } else {
      overflow = asked.overflow;
    }
  };

  const reset = (next: Partial<Core>): void => {
    core = { ...core, ...next, notice: '' };
  };

  // ---- the registry

  const registerProvider = (provider: Provider): Registration => {
    const read = readProvider(provider);
    if (!read.ok) {
      return { ok: false, reason: read.reason, remove: () => undefined };
    }

    const entry: Entry = { ...read.entry, index: entries.get(read.entry.provider.id)?.index ?? sequence };
    sequence += 1;
    act(() => {
      entries.set(entry.provider.id, entry);
      revision += 1;
      sync();
    });
    return {
      ok: true,
      reason: '',
      remove: () => {
        if (entries.get(entry.provider.id) === entry) {
          act(() => {
            entries.delete(entry.provider.id);
            revision += 1;
            runner.forget((source) => source.id === entry.provider.id);
            sync();
          });
        }
      },
    };
  };

  const removePlugin = (plugin: string): boolean =>
    act(() => {
      const leaving = [...entries.values()].filter((entry) => entry.provider.plugin === plugin);
      if (leaving.length === 0) {
        return false;
      }

      for (const entry of leaving) {
        entries.delete(entry.provider.id);
      }

      revision += 1;
      runner.forget((source) => source.provider.plugin === plugin);
      if (core.chips[0]?.plugin === plugin) {
        reset({ chips: [], memo: [], chip: -1, active: '', view: 'results' });
        touch(true);
      } else {
        sync();
      }

      return true;
    });

  // ---- the lifecycle

  const open = (opening: OpenPalette = {}): boolean =>
    act(() => {
      if (disposed || core.open) {
        return false;
      }

      const query = (opening.query ?? '').slice(0, LIMITS.query);
      const kind = opening.kind ?? 'all';
      const chips = Object.freeze([...(opening.scope ?? [])].slice(0, LIMITS.chips));
      session += 1;
      core = { ...fresh(core.recents), open: true, query, applied: query, kind, chips, memo: chips.map(() => ({ query: '', kind, active: '' })), current: opening.current };
      shape = '';
      touch(true);
      return true;
    });

  const close = (): boolean =>
    act(() => {
      if (!core.open) {
        return false;
      }

      session += 1;
      runner.stop();
      scheduler.clearTimeout(settle);
      settle = undefined;
      memo = undefined;
      core = fresh(core.recents);
      shape = '';
      overflow = 0;
      return true;
    });

  // ---- the input

  /** The text of the input after it was typed (or composed): the first character may name a kind, and everything is asked again. */
  const apply = (raw: string, force: boolean): void => {
    let value = raw.slice(0, LIMITS.query);
    let kind = core.kind;
    const prefix = value === '' ? undefined : kindOfPrefix(value.charAt(0));
    if (core.applied === '' && prefix !== undefined && !core.composing) {
      kind = prefix;
      value = value.slice(1);
    }

    if (!force && value === core.query && kind === core.kind && core.view === 'results') {
      return;
    }

    reset({ query: value, applied: value, kind, active: '', chip: -1, view: 'results' });
    touch(false);
  };

  const setQuery = (text: string): void => {
    act(() => {
      if (disposed || !core.open) {
        return;
      }

      if (core.composing) {
        // The text is shown and the list follows it, but nothing is asked while an IME composes (ch05: preserve composition).
        const value = text.slice(0, LIMITS.query);
        if (value !== core.query) {
          reset({ query: value });
        }

        return;
      }

      apply(text, false);
    });
  };

  const setKind = (kind: PaletteKind): boolean =>
    act(() => {
      if (!core.open || (kind === core.kind && core.view === 'results')) {
        return false;
      }

      const before = ASYNC_KINDS.includes(core.kind);
      reset({ kind, active: '', chip: -1, view: 'results' });
      if (before !== ASYNC_KINDS.includes(kind)) {
        touch(true);
      }

      return true;
    });

  const showResults = (): boolean =>
    act(() => {
      if (!core.open || core.view === 'results') {
        return false;
      }

      reset({ view: 'results', active: '' });
      return true;
    });

  const showSources = (): boolean =>
    act(() => {
      if (!core.open || core.view === 'sources') {
        return false;
      }

      reset({ view: 'sources', active: '' });
      return true;
    });

  // ---- the chips (S69)

  const rowOf = (id: string | undefined): Row | undefined => (id === undefined ? state.rows[state.activeIndex] : state.rows.find((row) => row.id === id));

  const pluginChip = (plugin: string): Chip => {
    const entry = [...entries.values()].find((candidate) => candidate.provider.plugin === plugin);
    return { kind: 'plugin', id: plugin, label: clip(entry?.pluginName ?? sentenceCase(plugin), LIMITS.chipLabel), plugin, noun: 'plugin', icon: entry?.owner.pluginIcon ?? '' };
  };

  const enter = (id?: string): boolean =>
    act(() => {
      const row = rowOf(id);
      if (!core.open || row?.into === undefined) {
        return false;
      }

      const was: Memo = { query: core.query, kind: core.kind, active: core.active };
      let chips = [...core.chips];
      let memos = [...core.memo];
      if (chips.length === 0 || chips[0]?.plugin !== row.plugin) {
        chips = [pluginChip(row.plugin)];
        memos = [was];
      }

      if (!chips.some((chip) => chip.kind === row.into?.kind) && chips.length < LIMITS.chips) {
        chips.push(chipOf(row.into, row.plugin));
        memos.push(was);
      }

      if (stable(chips) === stable(core.chips)) {
        return false;
      }

      reset({ chips, memo: memos, query: '', applied: '', active: '', chip: -1, view: 'results' });
      touch(true);
      return true;
    });

  const removeChip = (index: number): boolean =>
    act(() => {
      if (!core.open || index < 0 || index >= core.chips.length) {
        return false;
      }

      const back = core.memo[index] ?? { query: '', kind: core.kind, active: '' };
      reset({ chips: core.chips.slice(0, index), memo: core.memo.slice(0, index), query: back.query, applied: back.query, active: back.active, chip: -1, view: 'results' });
      touch(true);
      return true;
    });

  const selectChip = (index: number): boolean =>
    act(() => {
      if (!core.open || index < 0 || index >= core.chips.length || core.chip === index) {
        return false;
      }

      core = { ...core, chip: index };
      return true;
    });

  const clearChips = (): boolean =>
    act(() => {
      if (!core.open || core.chips.length === 0) {
        return false;
      }

      reset({ chips: [], memo: [], chip: -1, active: '', view: 'results' });
      touch(true);
      return true;
    });

  // ---- the active row

  const move = (delta: number, moving: { readonly wrap?: boolean | undefined } = {}): boolean =>
    act(() => {
      const rows = state.rows;
      if (!core.open || rows.length === 0 || delta === 0) {
        return false;
      }

      const from = state.activeIndex < 0 ? (delta > 0 ? -1 : 0) : state.activeIndex;
      const raw = from + delta;
      const index = moving.wrap === false ? Math.max(0, Math.min(rows.length - 1, raw)) : ((raw % rows.length) + rows.length) % rows.length;
      const id = rows[index]?.id ?? '';
      if (id === core.active && state.focused) {
        return false;
      }

      reset({ active: id });
      return true;
    });

  const focus = (id: string): boolean =>
    act(() => {
      if (!core.open || !state.rows.some((row) => row.id === id) || (core.active === id && state.focused)) {
        return false;
      }

      reset({ active: id });
      return true;
    });

  // ---- recents

  const remember = (input: RecordInput): boolean => {
    const made = recentOf(input, seam.describe);
    if (made === undefined) {
      return false;
    }

    const next = record(core.recents, made);
    if (next === core.recents) {
      return false;
    }

    core = { ...core, recents: next };
    recentsRevision += 1;
    return true;
  };

  const rememberRow = (row: Row): void => {
    if (row.route === undefined || row.kind === 'command' || row.kind === 'tool') {
      return;
    }

    const kind = RECENT_KINDS.includes(row.kind) ? (row.kind as Recent['kind']) : 'page';
    remember({ route: row.route, kind, ...(row.kind === 'tab' ? {} : { noun: row.noun }), title: row.title.text, context: row.context.text, icon: row.tile?.icon ?? '', tone: row.tile?.tone ?? 'neutral' });
  };

  // ---- what a row does

  const refuse = (reason: Extract<ActivateResult, { status: 'refused' }>['reason'], message: string, say: boolean): ActivateResult => {
    core = { ...core, notice: message };
    if (say) {
      announce(message);
    }

    return { status: 'refused', reason, message };
  };

  const finishCommand = (row: Row, ref: CommandRef, outcome: CommandOutcome, mine: number): CommandOutcome => {
    if (mine !== session || !core.open) {
      return outcome;
    }

    core = { ...core, running: '' };
    const refused = outcome === false || (isObject(outcome) && outcome.ok === false);
    if (refused) {
      core = { ...core, notice: `${row.title.text}: ${isObject(outcome) && typeof outcome.reason === 'string' && outcome.reason !== '' ? outcome.reason : 'It could not run.'}` };
      announce(core.notice);
    } else if (isObject(outcome) && outcome.refresh === true) {
      revision += 1;
      touch(true);
    }

    if (!refused && ref.keepOpen !== true && !(isObject(outcome) && outcome.keepOpen === true)) {
      close();
    }

    return outcome;
  };

  const run = (row: Row, ref: CommandRef): ActivateResult => {
    if (core.running !== '') {
      return refuse('busy', `${row.title.text}: another command is still running.`, false);
    }

    if (options.run === undefined) {
      return refuse('invalid', `${row.title.text}: there is no way to run commands here.`, true);
    }

    const mine = session;
    core = { ...core, running: row.id, notice: '' };
    let outcome: CommandOutcome | Promise<CommandOutcome>;
    try {
      outcome = options.run(ref, { source: 'palette' });
    } catch (error) {
      onError(error, `run() of ${ref.id}`);
      core = { ...core, running: '', notice: `${row.title.text}: ${messageOf(error, 'It could not run.')}` };
      announce(core.notice);
      return { status: 'ran', outcome: 'refused', done: undefined };
    }

    if (isThenable(outcome)) {
      const done = Promise.resolve(outcome).then(
        (value) => act(() => finishCommand(row, ref, value, mine)),
        (error: unknown) =>
          act(() => {
            onError(error, `run() of ${ref.id}`);
            if (mine === session && core.open) {
              core = { ...core, running: '', notice: `${row.title.text}: ${messageOf(error, 'It could not run.')}` };
              announce(core.notice);
            }

            return false;
          }),
      );
      return { status: 'ran', outcome: 'pending', done };
    }

    const settled = finishCommand(row, ref, outcome, mine);
    return { status: 'ran', outcome: settled === false || (isObject(settled) && settled.ok === false) ? 'refused' : 'done', done: undefined };
  };

  const activate = (id?: string, how?: ModifierEvent | OpenHow): ActivateResult =>
    act((): ActivateResult => {
      const row = disposed || !core.open ? undefined : rowOf(id);
      if (row === undefined) {
        return { status: 'refused', reason: 'none', message: 'There is nothing to open.' };
      }

      if (row.inert) {
        return refuse('inert', `${row.title.text} is still loading.`, false);
      }

      const { action } = row;
      switch (action.type) {
        case 'kind':
          setKind(action.kind);
          return { status: 'changed' };
        case 'everywhere':
          clearChips();
          return { status: 'changed' };
        case 'retry':
          retry(action.source);
          return { status: 'changed' };
        case 'none':
          return refuse('invalid', `${row.title.text} cannot be opened.`, false);
        case 'run':
          // A command acts: it ignores the modifiers, and the host revalidates it just before it runs (S64).
          if (row.availability.state === 'unavailable') {
            return refuse('unavailable', `${row.title.text}: ${row.availability.reason === '' ? 'Unavailable' : row.availability.reason}`, true);
          }

          return run(row, action.command);
        case 'open':
        case 'activate':
          break;
      }

      if (row.availability.state === 'unavailable') {
        return refuse('unavailable', `${row.title.text}: ${row.availability.reason === '' ? 'Unavailable' : row.availability.reason}`, true);
      }

      const disposition: OpenHow = typeof how === 'string' ? how : dispositionOf(how, { platform });
      if (disposition === 'window' && options.windows !== true) {
        return refuse('invalid', 'This window cannot open another one yet.', true);
      }

      const result = guarded(
        () => {
          if (action.type === 'activate') {
            // A tab's own row switches to it; another key opens its place, when it has one.
            return disposition === 'smart' || action.destination === undefined ? options.activate?.(action.tab) : options.open(action.destination, { how: disposition, source: 'search' });
          }

          return options.open(action.destination, { how: disposition, source: 'search' });
        },
        undefined,
        'open() of the tab model',
      );
      if (result === undefined) {
        return refuse('invalid', `${row.title.text} could not be opened.`, true);
      }

      if (result.status === 'refused') {
        if (action.type === 'activate' && result.reason === 'missing') {
          return refuse('closed', `${row.title.text} is closed`, true);
        }

        core = { ...core, notice: result.message };
        return { status: 'opened', result };
      }

      if (options.recordOpens !== false) {
        rememberRow(row);
      }

      close();
      return { status: 'opened', result };
    });

  const retry = (source: string): boolean =>
    act(() => {
      if (!core.open) {
        return false;
      }

      if (runner.answers().some((answer) => answer.id === source) || source === '@live') {
        return runner.retry(source);
      }

      // A synchronous provider that failed answers again on the next composition.
      if (entries.has(source)) {
        revision += 1;
        return true;
      }

      return false;
    });

  const retryAll = (): number =>
    act(() => {
      if (!core.open) {
        return 0;
      }

      const count = runner.retryAll();
      const failed = [...(memo?.value.reports.values() ?? [])].filter((report) => report.error !== '').length;
      if (failed > 0) {
        revision += 1;
      }

      return count + failed;
    });

  // ---- the keys (S66, S69, S70)

  const hands = (target: 'input' | 'chip', index = 0): Focus => (target === 'chip' ? { target: 'chip', index } : { target: 'input', caret: 'end' });

  const key = (input: KeyInput): KeyOutcome => {
    if (disposed || !core.open || input.isComposing === true) {
      return { handled: false };
    }

    const mod = input.metaKey === true || input.ctrlKey === true;
    const plain = !mod && input.altKey !== true && input.shiftKey !== true;
    if (input.key === 'Escape' && plain) {
      if (core.view === 'sources') {
        showResults();
        return { handled: true, focus: hands('input') };
      }

      close();
      return { handled: true };
    }

    if (input.target === 'chip') {
      const index = input.index ?? core.chip;
      const last = core.chips.length - 1;
      switch (input.key) {
        case 'ArrowLeft':
          selectChip(Math.max(0, index - 1));
          return { handled: true, focus: hands('chip', Math.max(0, index - 1)) };
        case 'ArrowRight':
          if (index < last) {
            selectChip(index + 1);
            return { handled: true, focus: hands('chip', index + 1) };
          }

          act(() => {
            core = { ...core, chip: -1 };
          });
          return { handled: true, focus: { target: 'input', caret: 'start' } };
        case 'Home':
          selectChip(0);
          return { handled: true, focus: hands('chip', 0) };
        case 'End':
          selectChip(last);
          return { handled: true, focus: hands('chip', last) };
        case 'Backspace':
        case 'Delete':
          if (plain) {
            removeChip(index);
            return { handled: true, focus: hands('input') };
          }

          return { handled: false };
        default:
          return { handled: false };
      }
    }

    switch (input.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (mod || input.altKey === true) {
          return { handled: false };
        }

        move(input.key === 'ArrowDown' ? 1 : -1);
        return { handled: true };
      case 'PageDown':
      case 'PageUp':
        move(input.key === 'PageDown' ? LIMITS.page : -LIMITS.page, { wrap: false });
        return { handled: true };
      case 'Enter':
        return { handled: true, result: activate(undefined, input) };
      case 'ArrowRight':
        if (plain && input.caret?.atEnd === true && enter()) {
          return { handled: true, focus: hands('input') };
        }

        return { handled: false };
      case 'ArrowLeft':
        if (plain && input.caret?.atStart === true && core.chips.length > 0) {
          const last = core.chips.length - 1;
          selectChip(last);
          return { handled: true, focus: hands('chip', last) };
        }

        return { handled: false };
      case 'Backspace':
        if (plain && core.query === '') {
          if (core.view === 'sources') {
            showResults();
            return { handled: true };
          }

          if (core.chips.length > 0) {
            removeChip(core.chips.length - 1);
            return { handled: true, focus: hands('input') };
          }

          if (core.kind !== 'all') {
            setKind('all');
            return { handled: true };
          }
        }

        return { handled: false };
      default:
        return { handled: false };
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getSnapshot: () => state,
    subscribe,
    subscribeTo: (select, listener, equals = Object.is) => {
      let previous = select(state);
      return subscribe(() => {
        const next = select(state);
        if (!equals(previous, next)) {
          const before = previous;
          previous = next;
          listener(next, before);
        }
      });
    },

    registerProvider,
    removePlugin,
    refresh: (moved) => {
      act(() => {
        revision += 1;
        if (moved !== undefined && core.open) {
          core = { ...core, current: moved.route };
        }
      });
    },

    open,
    close,
    toggle: (opening) => {
      if (core.open) {
        close();
        return false;
      }

      return open(opening);
    },

    setQuery,
    compositionStart: () => {
      act(() => {
        if (core.open && !core.composing) {
          core = { ...core, composing: true };
        }
      });
    },
    compositionEnd: (text) => {
      act(() => {
        if (core.open && core.composing) {
          core = { ...core, composing: false };
          apply(text, true);
        }
      });
    },
    setKind,
    showSources,
    showResults,

    enter,
    removeChip,
    selectChip,
    clearChips,

    move,
    focus,
    activate,
    key,

    retry,
    retryAll,

    record: (input) => act(() => remember(input)),
    clearRecents: () =>
      act(() => {
        if (core.recents.length === 0) {
          return false;
        }

        core = { ...core, recents: Object.freeze([]) };
        recentsRevision += 1;
        return true;
      }),
    serialise: () => serialiseRecents(core.recents),
    dispose: () => {
      disposed = true;
      runner.stop();
      scheduler.clearTimeout(settle);
      settle = undefined;
      listeners.clear();
    },
  };
}
