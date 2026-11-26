import { activate, activateOffset, canGo, consumeReveal, goto, historyList, keep, last, markAttention, pin, refresh, reload, reorder, setKeepAlive, setPageState, setUnsaved, step } from './arrange';
import { adopt, canReopen, close, closeMany, closePlugin, detach, duplicate, reopen } from './close';
import { normaliseKeepAlive } from './keepAlive';
import { ensureHome, navigate, open, replace } from './open';
import { serialise } from './persist';
import { guardContributions, logError, type ErrorHook } from './plugins';
import type { Context } from './resolve';
import { createSelectors } from './selectors';
import { applyKeepAlive, emptyState, patch, type Step } from './state';
import type {
  Attention,
  CloseResult,
  CloseScope,
  Contributions,
  Destination,
  Guard,
  HistoryDirection,
  HistoryItem,
  KeepAlive,
  NavigateOptions,
  OpenOptions,
  OpenResult,
  PersistedTabs,
  Preferences,
  ReopenCheck,
  ReopenOptions,
  RouteInput,
  Selectors,
  TabId,
  TabResult,
  TabsState,
  TabWindows,
} from './types';

// The store: one immutable snapshot, `subscribe`, and the operations. It is the shape `useSyncExternalStore` wants (`getSnapshot` and `subscribe`), and nothing in it knows
// React. A selector from `selectors` applied to the snapshot gives each consumer its own slice.

export type TabsStoreOptions = {
  /** What the plugins say; see `Contributions`. */
  readonly contributions: Contributions;
  /** A state from `restoreTabs`. Default: an empty strip, which opens the home page when one is offered. */
  readonly initial?: TabsState | undefined;
  /** Overrides the policy of `initial`; see `KeepAlive` and `DEFAULT_KEEP_ALIVE`. */
  readonly keepAlive?: Partial<KeepAlive> | undefined;
  /** The settings that change where a search result opens; read at each open. Default: smart, with a preview tab. */
  readonly preferences?: (() => Preferences) | undefined;
  /** Makes a tab id. Default: a random UUID. */
  readonly newId?: (() => TabId) | undefined;
  /** Hears every failure of a plugin's code. Default: the console. */
  readonly onError?: ErrorHook | undefined;
};

export type TabsStore = {
  readonly getSnapshot: () => TabsState;
  /** Called after every change of the snapshot, and never for an operation that changed nothing. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Called with the new value when what `select` reads changed by `equals` (default `Object.is`). */
  readonly subscribeTo: <T>(select: (state: TabsState) => T, listener: (value: T, previous: T) => void, equals?: (a: T, b: T) => boolean) => () => void;
  readonly selectors: Selectors;

  /** Where a destination lands (ch16 S64); see `OpenResult`. */
  readonly open: (destination: Destination, options?: OpenOptions) => OpenResult;
  /** Moves a tab to a destination: pushes history (or replaces the current entry), clears the page. */
  readonly navigate: (id: TabId, destination: Destination, options?: NavigateOptions) => TabResult;
  /** A change inside the page that is part of its route: replaces the current history entry and keeps the page. */
  readonly replace: (id: TabId, route: RouteInput) => TabResult;

  readonly activate: (id: TabId) => TabResult;
  readonly next: () => TabResult;
  readonly previous: () => TabResult;
  /** The Nth tab, from 1. */
  readonly goto: (n: number) => TabResult;
  readonly last: () => TabResult;

  /** Defaults to the tab on screen. */
  readonly close: (id?: TabId, guard?: Guard) => CloseResult;
  /** Takes a tab out of the strip because it now lives in another window: like `close`, but it is not offered under Recently closed. */
  readonly detach: (id: TabId, guard?: Guard) => CloseResult;
  /** Shows a tab that arrives from another window, as `serialise` saved it there: with its id, route, history and pin. */
  readonly adopt: (tab: unknown) => TabResult;
  readonly closeMany: (scope: CloseScope, id?: TabId, guard?: Guard) => CloseResult;
  readonly closePlugin: (plugin: string, guard?: Guard) => CloseResult;
  readonly reopen: (options?: ReopenOptions) => TabResult;
  readonly canReopen: (options?: ReopenOptions) => ReopenCheck;
  readonly duplicate: (id?: TabId) => TabResult;

  readonly pin: (id?: TabId, pinned?: boolean) => TabResult;
  readonly reorder: (id: TabId, to: number, options?: { readonly pinned?: boolean | undefined }) => TabResult;
  /** Makes a preview tab permanent. */
  readonly keep: (id?: TabId) => TabResult;

  readonly back: (id?: TabId, guard?: Guard) => TabResult;
  readonly forward: (id?: TabId, guard?: Guard) => TabResult;
  readonly canBack: (id?: TabId) => boolean;
  readonly canForward: (id?: TabId) => boolean;
  /** The titles in a direction, nearest first, at most 10. */
  readonly historyList: (id?: TabId, direction?: HistoryDirection) => readonly HistoryItem[];
  readonly reload: (id?: TabId, guard?: Guard) => TabResult;

  /** What a page reports about its tab. Each answers whether anything changed. */
  readonly setPageState: (id: TabId, state: unknown) => boolean;
  readonly setUnsaved: (id: TabId, unsaved: boolean) => boolean;
  readonly markAttention: (id: TabId, attention: Attention) => boolean;
  readonly consumeReveal: (id: TabId, seq: number) => boolean;

  /** Describes the tabs again (of one plugin, or all) because what the plugins say changed. Done by itself when `Contributions.subscribe` exists. */
  readonly refresh: (plugin?: string) => boolean;
  readonly setKeepAlive: (change: Partial<KeepAlive>) => boolean;
  /** What the session saves; see `restoreTabs` for the way back and `createSaver` for the writing. */
  readonly serialise: () => PersistedTabs;
  /** What a tab can do about the other windows of the app. Absent where the app has one window (a browser tab). */
  readonly windows?: TabWindows | undefined;
  /** Stops listening to the plugins and drops the listeners. */
  readonly dispose: () => void;
};

const DEFAULT_PREFERENCES: Preferences = Object.freeze({ openResults: 'smart', reusePreview: true });

/** A random id from the platform; without one the clock and a counter stand in, which is unique within a run. */
let fallbackCounter = 0;
export function newUuid(): TabId {
  const crypto: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  fallbackCounter += 1;
  return `tab-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function begin(options: TabsStoreOptions, ctx: Context): TabsState {
  const base = options.initial ?? emptyState(normaliseKeepAlive(options.keepAlive));
  const configured = options.initial && options.keepAlive ? applyKeepAlive(patch(base, { keepAlive: normaliseKeepAlive(options.keepAlive, base.keepAlive) })) : base;
  return ensureHome(configured, ctx);
}

export function createTabsStore(options: TabsStoreOptions): TabsStore {
  const onError = options.onError ?? logError;
  const ctx: Context = { plugins: guardContributions(options.contributions, onError), newId: options.newId ?? newUuid, preferences: options.preferences ?? (() => DEFAULT_PREFERENCES) };
  let state = begin(options, ctx);
  const listeners = new Set<() => void>();
  const selectors = createSelectors();

  const commit = (next: TabsState): void => {
    if (next === state) {
      return;
    }

    state = next;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const run = <R>(result: Step<R>): R => {
    commit(result.state);
    return result.result;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const target = (id: TabId | undefined): TabId | null => id ?? state.active;
  const refreshNow = (plugin?: string): boolean => {
    const before = state;
    commit(refresh(state, ctx, plugin));
    return state !== before;
  };

  let stop: (() => void) | undefined;
  try {
    stop = options.contributions.subscribe?.(() => {
      refreshNow();
    });
  } catch (error) {
    onError(error, 'subscribe() of the contributions');
  }

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
    selectors,

    open: (destination, openOptions) => run(open(state, ctx, destination, openOptions)),
    navigate: (id, destination, navigateOptions) => run(navigate(state, ctx, id, destination, navigateOptions)),
    replace: (id, route) => run(replace(state, ctx, id, route)),

    activate: (id) => run(activate(state, id)),
    next: () => run(activateOffset(state, 1)),
    previous: () => run(activateOffset(state, -1)),
    goto: (n) => run(goto(state, n)),
    last: () => run(last(state)),

    close: (id, guard) => run(close(state, target(id), guard)),
    detach: (id, guard) => run(detach(state, id, guard)),
    adopt: (saved) => run(adopt(state, ctx, saved)),
    closeMany: (scope, id, guard) => run(closeMany(state, scope, target(id), guard)),
    closePlugin: (plugin, guard) => run(closePlugin(state, plugin, guard)),
    reopen: (reopenOptions) => run(reopen(state, ctx, reopenOptions)),
    canReopen: (reopenOptions) => canReopen(state, ctx, reopenOptions),
    duplicate: (id) => run(duplicate(state, ctx, target(id))),

    pin: (id, pinned) => run(pin(state, target(id), pinned)),
    reorder: (id, to, reorderOptions) => run(reorder(state, id, to, reorderOptions)),
    keep: (id) => run(keep(state, target(id))),

    back: (id, guard) => run(step(state, ctx, target(id), 'back', guard)),
    forward: (id, guard) => run(step(state, ctx, target(id), 'forward', guard)),
    canBack: (id) => canGo(state.tabs[target(id) ?? ''], 'back'),
    canForward: (id) => canGo(state.tabs[target(id) ?? ''], 'forward'),
    historyList: (id, direction = 'back') => historyList(state, ctx, target(id), direction),
    reload: (id, guard) => run(reload(state, target(id), guard)),

    setPageState: (id, value) => run(setPageState(state, id, value)),
    setUnsaved: (id, unsaved) => run(setUnsaved(state, id, unsaved)),
    markAttention: (id, attention) => run(markAttention(state, id, attention)),
    consumeReveal: (id, seq) => run(consumeReveal(state, id, seq)),

    refresh: refreshNow,
    setKeepAlive: (change) => run(setKeepAlive(state, change)),
    serialise: () => serialise(state),
    dispose: () => {
      stop?.();
      stop = undefined;
      listeners.clear();
    },
  };
}
