import { activateSession, activateTool, fitHeight, hide, reorderSession, resize, revealSession, setHeight, show, type ShowOptions } from './arrange';
import { serialise } from './persist';
import { createSelectors } from './selectors';
import { closeSession, openSession, renameSession, retitleSession, setSessionState, type OpenOptions, type StateChange } from './sessions';
import { emptyPanel, type Context, type Step } from './state';
import { registerTool, syncPlugins, unregisterTool, type PluginTools } from './tools';
import type { CloseResult, OpenResult, PanelResult, PanelState, PersistedPanel, Resize, Selectors, SessionId, SessionInput, ToolId, ToolInput } from './types';

// The store: one immutable snapshot, `subscribe`, and the operations. It is the shape `useSyncExternalStore` wants (`getSnapshot` and `subscribe`), and nothing in it knows React. A selector
// from `selectors` applied to the snapshot gives each consumer its own slice. The tab model's store (../tabs/store.ts) is the pattern.

export type PanelStoreOptions = {
  /** A state from `restorePanel`. Default: a hidden panel with no tool and no session. */
  readonly initial?: PanelState | undefined;
  /** Makes a session id. Default: a random UUID. */
  readonly newId?: (() => SessionId) | undefined;
  /** The time in milliseconds. Default: the clock. */
  readonly now?: (() => number) | undefined;
};

export type PanelStore = {
  readonly getSnapshot: () => PanelState;
  /** Called after every change of the snapshot, and never for an operation that changed nothing. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Called with the new value when what `select` reads changed by `equals` (default `Object.is`). */
  readonly subscribeTo: <T>(select: (state: PanelState) => T, listener: (value: T, previous: T) => void, equals?: (a: T, b: T) => boolean) => () => void;
  readonly selectors: Selectors;

  /** Opens the panel, on a tool when one is named. */
  readonly show: (options?: ShowOptions) => PanelResult;
  readonly hide: () => PanelResult;
  readonly toggle: () => PanelResult;
  /** The splitter's release or key: a new height, or hide. */
  readonly resize: (change: Resize) => PanelResult;
  /** Back to the default height. */
  readonly resetHeight: () => PanelResult;
  /** The window is this high (or the panel was read in a window this high): a remembered size that does not fit is brought within its limits, and stays so (the mock re-clamps on load and on resize). */
  readonly fitHeight: (viewport: number) => PanelResult;
  readonly activateTool: (id: ToolId) => PanelResult;
  /** Chooses a session: its tool comes on screen. It does not open the panel. */
  readonly activateSession: (id: SessionId) => PanelResult;
  /**
   * Shows a session: the panel opens on it, its tool on screen and the session its tool's, in one change. What a press of the command that opened it does when it is already there. It moves no focus (the model has
   * none) and starts nothing; a session that is hidden or not there is refused.
   */
  readonly revealSession: (id: SessionId) => PanelResult;

  /** Registers a tool of the host. */
  readonly registerTool: (input: ToolInput) => PanelResult;
  readonly unregisterTool: (id: ToolId) => PanelResult;
  /** The plugins that are live now, and the tools each brings: the whole answer, in one transaction. */
  readonly syncPlugins: (plugins: readonly PluginTools[]) => PanelResult;

  readonly openSession: (input: SessionInput, options?: OpenOptions) => OpenResult;
  /** What a session came to. */
  readonly setSessionState: (id: SessionId, change: StateChange) => PanelResult;
  /**
   * Gives a session another title on its owner's behalf (the shell's real name once the host has it, the title a program set): one change, and the tab's name, twins and ordinal follow from the snapshot. The same title changes
   * nothing; a held session is refused, and so is a session the person named (`renameSession`): their name stands.
   */
  readonly retitleSession: (id: SessionId, title: string) => PanelResult;
  /**
   * The person names a session: the title is theirs from now on (`titlePinned`, saved with the session), and the owner's own naming (`retitleSession`) is refused. An empty title is refused. The same title of a session that is named
   * changes nothing; a held session is refused.
   */
  readonly renameSession: (id: SessionId, title: string) => PanelResult;
  readonly closeSession: (id: SessionId) => CloseResult;
  /** Moves a session to an index of its tool's strip (kept within it): the other sessions keep their places, and the saved panel lists them in the new order. The place it has changes nothing. */
  readonly reorderSession: (id: SessionId, to: number) => PanelResult;

  /** What the session saves; see `restorePanel` for the way back and `createSaver` for the writing. */
  readonly serialise: () => PersistedPanel;
  /** Drops the listeners. */
  readonly dispose: () => void;
};

/** What a session says when its plugin left while it was running. */
export const UNLOADED_CAUSE = 'The plugin was unloaded.';

/** A random id from the platform; without one the clock and a counter stand in, which is unique within a run. */
let fallbackCounter = 0;
function newUuid(): SessionId {
  // A platform without `crypto.randomUUID` (an old engine, a test environment) is the case the cast lets this look at: the typings say the global is always there.
  const crypto: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  fallbackCounter += 1;
  return `session-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPanelStore(options: PanelStoreOptions = {}): PanelStore {
  const ctx: Context = { newId: options.newId ?? newUuid, now: options.now ?? (() => Date.now()) };
  let state = options.initial ?? emptyPanel();
  const listeners = new Set<() => void>();
  const selectors = createSelectors();

  const commit = (next: PanelState): void => {
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

  const run = <R>(step: Step<R>): R => {
    commit(step.state);
    return step.result;
  };

  const subscribe = (listener: () => void) => {
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
    selectors,

    show: (showOptions) => run(show(state, showOptions)),
    hide: () => run(hide(state)),
    toggle: () => run(state.open ? hide(state) : show(state)),
    resize: (change) => run(resize(state, change)),
    resetHeight: () => run(setHeight(state, null)),
    fitHeight: (viewport) => run(fitHeight(state, viewport)),
    activateTool: (id) => run(activateTool(state, id)),
    activateSession: (id) => run(activateSession(state, id)),
    revealSession: (id) => run(revealSession(state, id)),

    registerTool: (input) => run(registerTool(state, input)),
    unregisterTool: (id) => run(unregisterTool(state, id)),
    syncPlugins: (plugins) => run(syncPlugins(state, plugins, ctx.now(), UNLOADED_CAUSE)),

    openSession: (input, openOptions) => run(openSession(state, input, ctx, openOptions)),
    setSessionState: (id, change) => run(setSessionState(state, id, change, ctx.now())),
    retitleSession: (id, title) => run(retitleSession(state, id, title)),
    renameSession: (id, title) => run(renameSession(state, id, title)),
    closeSession: (id) => run(closeSession(state, id)),
    reorderSession: (id, to) => run(reorderSession(state, id, to)),

    serialise: () => serialise(state),
    dispose: () => {
      listeners.clear();
    },
  };
}
