import type { CloseResult, PanelStore, SessionId } from '../../core/panel';
import type { CloseQuestion } from './state';

// The question a close asks (ch16 S115: "Closing a session with a foreground process running opens a confirmation (Terminate session?, buttons Cancel and Terminate session); any other close is immediate";
// decision L12). Every path of the panel to a close (the tab's button, its middle button, Delete on the tab, the close chord) ends in `store.closeSession`, and that call is synchronous by design, so the
// question cannot be asked from inside it. The guard is the store those paths are GIVEN: its `closeSession` closes at once when the session has nothing to ask and, when it has, records the question for the
// dialog (`ClosePrompt.tsx`) and answers that nothing was closed; `confirm` then closes through the host's own store. What the registry or a plugin does through the host's own store never asks.
//
// A question may have to be ASKED of the producer first (what runs in a terminal is a call to the host, docs/ui-next/status/T1-go.md 2.3): `questionOf` then answers with a promise. The close the panel made is
// answered at once that nothing was closed, and the guard finishes it when the producer has answered: the dialog when something runs, and when nothing does the close itself, through the host's own store, with the
// focus following as it does after any close (`closedLater`). One question at a time for a session however often its close is pressed meanwhile.
//
// ONE question is on screen at a time, and the person's answer is for it: the dialog is modal, and a click meant for the question on screen must never land on another. A question that comes while another is on screen
// (the host answers for two sessions in whatever order it likes) WAITS, one for each session, and is asked, in the order it came, when the one on screen has been confirmed or cancelled; one whose session is gone by then
// is skipped. A session whose question is on screen or waits has been asked about: a press of its close is refused at once and asks nothing again, of the host or of the person, and a session the guard closes itself takes
// every question about it with it.
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
  /** The person said yes: the session closes, through the host's own store, and the question that waited, if any, is asked next. What the close answered, for the focus to follow; `undefined` when nothing was asked. */
  readonly confirm: () => CloseResult | undefined;
  /** The person said no. Nothing changes but the question: the one that waited, if any, is asked next. */
  readonly cancel: () => void;
};

export type CloseGuardOptions = {
  /**
   * The question closing this session asks, or nothing. A promise is a question that has to be asked of the producer first: it answers with the question, or nothing when nothing runs, and it never rejects (a
   * producer that cannot say is the general question, which is the caller's to give).
   */
  readonly questionOf: (session: SessionId) => CloseQuestion | undefined | Promise<CloseQuestion | undefined>;
  /** What the session is called, as its tab says. */
  readonly nameOf: (session: SessionId) => string;
  /**
   * Whether the focus still belongs to the session being closed (its own tab, or its body while it is on screen: the focus belongs to a session, and is not just somewhere in the panel): asked when a close that has to wait for
   * the producer is pressed, and again right before the close the guard makes itself, and told back with the outcome.
   */
  readonly focused?: ((session: SessionId) => boolean) | undefined;
  /** A close the guard made itself, after the producer said that nothing runs: the result, for the focus to follow, and whether the focus belonged to the session both when the close was pressed and when it was made. */
  readonly closedLater?: ((result: CloseResult, focused: boolean) => void) | undefined;
};

const isPromise = (value: unknown): value is Promise<unknown> => typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';

export function createCloseGuard(options: CloseGuardOptions): CloseGuard {
  const listeners = new Set<() => void>();
  const asking = new Set<SessionId>();
  /** The questions that came while another was on screen, in the order they came, one for each session: the prompt is made when its turn comes, so its name is the tab's name then. */
  const waiting: Array<{ readonly session: SessionId; readonly question: CloseQuestion }> = [];
  let prompt: ClosePrompt | null = null;
  let store: PanelStore | undefined;

  const set = (next: ClosePrompt | null) => {
    prompt = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** The prompt of the oldest question that waited whose session is still there, which leaves the line; nothing when none is. */
  const nextPrompt = (): ClosePrompt | null => {
    for (let entry = waiting.shift(); entry !== undefined; entry = waiting.shift()) {
      if (store?.getSnapshot().sessions[entry.session] !== undefined) {
        return { session: entry.session, name: options.nameOf(entry.session), question: entry.question };
      }
    }

    return null;
  };

  /** Whether a question about the session is on screen or waits for its turn. */
  const questioned = (id: SessionId): boolean => prompt?.session === id || waiting.some((entry) => entry.session === id);

  /** A question for the person: on screen at once when none is, otherwise it waits its turn. The same session asked again is the same question: what is on screen, or waits, stands. */
  const ask = (id: SessionId, question: CloseQuestion) => {
    if (prompt === null) {
      set({ session: id, name: options.nameOf(id), question });
    } else if (!questioned(id)) {
      waiting.push({ session: id, question });
    }
  };

  /** The producer answered: the question for the person, or, when nothing runs, the close. Nothing for a session that is gone by now. */
  const answered = (id: SessionId, question: CloseQuestion | undefined, focused: boolean) => {
    asking.delete(id);
    if (store?.getSnapshot().sessions[id] === undefined) {
      return;
    }

    if (question === undefined) {
      // The focus is sampled again here, right before the close, because the close removes the node that has it: the person may have gone to a page control while the host was asked, and the close must not take it back.
      const focusedNow = options.focused?.(id) ?? false;
      const result = store.closeSession(id);
      if (result.status === 'done') {
        // No question may go on naming a session that is gone: the one on screen gives way to the next, and one that waits for it is skipped when its turn comes.
        if (prompt?.session === id) {
          set(nextPrompt());
        }

        options.closedLater?.(result, focused && focusedNow);
      }

      return;
    }

    ask(id, question);
  };

  return {
    guard: (given) => {
      store = given;
      return {
        ...given,
        closeSession: (id) => {
          // A session whose question is on screen, or waits for the one that is, has been asked about: it is not asked again, of the producer (a call to the host) or of the person.
          if (questioned(id)) {
            return { status: 'refused', reason: 'invalid', message: 'Closing this terminal asks first: the question is on screen, or waits for the one that is.' };
          }

          if (asking.has(id)) {
            return { status: 'refused', reason: 'invalid', message: 'Closing this terminal asks first: the host is being asked what runs in it.' };
          }

          const question = options.questionOf(id);
          if (question === undefined) {
            return given.closeSession(id);
          }

          if (isPromise(question)) {
            const focused = options.focused?.(id) ?? false;
            asking.add(id);
            question.then(
              (answer) => {
                answered(id, answer, focused);
              },
              () => {
                asking.delete(id);
              },
            );
            return { status: 'refused', reason: 'invalid', message: 'Closing this terminal asks first: the host is being asked what runs in it.' };
          }

          // The person is asked, or the question waits behind the one on screen.
          ask(id, question);

          return { status: 'refused', reason: 'invalid', message: 'Closing this terminal asks first: the question is on screen, or waits for the one that is.' };
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

      const result = store.closeSession(prompt.session);
      set(nextPrompt());
      return result;
    },
    cancel: () => {
      if (prompt !== null) {
        set(nextPrompt());
      }
    },
  };
}
