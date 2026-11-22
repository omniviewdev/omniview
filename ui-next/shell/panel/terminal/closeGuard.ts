import type { CloseResult, PanelStore, SessionId } from '../../core/panel';
import type { CloseQuestion } from './state';

// The question a close asks (ch16 S115: "Closing a session with a foreground process running opens a confirmation (Terminate session?, buttons Cancel and Terminate session); any other close is immediate";
// decision L12). Every path of the panel to a close (the tab's button, its middle button, Delete on the tab, the close chord) ends in `store.closeSession`, and that call is synchronous by design, so the
// question cannot be asked from inside it. The guard is the store those paths are GIVEN: its `closeSession` closes at once when the session has nothing to ask and, when it has, records the question for the
// dialog (`ClosePrompt.tsx`) and answers that nothing was closed; `confirm` then closes through the host's own store. What the registry or a plugin does through the host's own store never asks.
//
// The proper place for this is a member of the panel's bindings that the shell's own close paths call (a follow-up in the shell, docs/ui-next/status/T1.md): until it exists the host hands the shell this wrapper.

/** What the dialog draws: which session is asked about, what it is called, and the question. */
export type ClosePrompt = {
  readonly session: SessionId;
  readonly name: string;
  readonly question: CloseQuestion;
};

export type CloseGuard = {
  /** The store for the panel: the host's own store with a `closeSession` that asks first. Every other member is the host's. */
  readonly guard: (store: PanelStore) => PanelStore;
  /** What the dialog reads: the same object until the question changes, `null` while nothing is asked. */
  readonly getSnapshot: () => ClosePrompt | null;
  readonly subscribe: (listener: () => void) => () => void;
  /** The person said yes: the session closes, through the host's own store. What the close answered, for the focus to follow; `undefined` when nothing was asked. */
  readonly confirm: () => CloseResult | undefined;
  /** The person said no. Nothing changes. */
  readonly cancel: () => void;
};

export type CloseGuardOptions = {
  /** The question closing this session asks, or nothing. */
  readonly questionOf: (session: SessionId) => CloseQuestion | undefined;
  /** What the session is called, as its tab says. */
  readonly nameOf: (session: SessionId) => string;
};

export function createCloseGuard(options: CloseGuardOptions): CloseGuard {
  const listeners = new Set<() => void>();
  let prompt: ClosePrompt | null = null;
  let store: PanelStore | undefined;

  const set = (next: ClosePrompt | null) => {
    prompt = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    guard: (given) => {
      store = given;
      return {
        ...given,
        closeSession: (id) => {
          const question = options.questionOf(id);
          if (question === undefined) {
            return given.closeSession(id);
          }

          // The same question twice is one question: nobody is told again.
          if (prompt?.session !== id) {
            set({ session: id, name: options.nameOf(id), question });
          }

          return { status: 'refused', reason: 'invalid', message: 'Closing this terminal asks first: the question is on screen.' };
        },
      };
    },
    getSnapshot: () => prompt,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    confirm: () => {
      if (prompt === null || store === undefined) {
        return undefined;
      }

      const { session } = prompt;
      set(null);
      return store.closeSession(session);
    },
    cancel: () => {
      if (prompt !== null) {
        set(null);
      }
    },
  };
}
