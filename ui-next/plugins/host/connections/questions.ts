import type { ButtonTone, ConfirmSubject, IconName } from '@omniviewdev/kit';
import type { ConnectionVerbResultV1 } from '../../contract/v1';

// The question a verb on a connection asks the person before it runs (KL4): a disconnect, which stops what is open on the connection, and a removal. The HOST asks it, in its own dialog (`ConnectionQuestion.tsx`, the kit's
// `ConfirmDialog`), and never the plugin: a verb of `context.connections` that needs an answer opens this question and does nothing until the person says yes, so no plugin can run it without. Framework-free, like the rest of this
// directory: React reads the one question that is open through `useSyncExternalStore`, and every rule here is a test with no React.
//
// ONE QUESTION AT A TIME: the dialog is modal, so a second one asked while it is open is refused in words. THE ANSWER of `ask` is what the person's choice came to: a no is `cancelled`; a yes runs the operation INSIDE the dialog (the
// kit's `busy`), and when it fails the dialog stays open with the reason (the kit's `error`) for the person to try again or leave. A person who leaves after a failure answers with that failure, since the operation was tried; one who
// leaves while it runs leaves it running, and the answer is what it comes to.

/** What the dialog says: the verb phrase, who it is about, what happens in one line, and the verb. */
export type Question = {
  readonly title: string;
  readonly icon: IconName;
  readonly tone: ButtonTone;
  readonly subject: ConfirmSubject;
  readonly message: string;
  readonly confirmLabel: string;
};

/** The question on screen: what it says, whether the operation the person confirmed is running, and why the last try failed. `id` is new for each question, so a dialog that is shown again starts clean. */
export type OpenQuestion = Question & { readonly id: number; readonly busy: boolean; readonly error: string | undefined };

export type Questions = {
  /** The question on screen, or none. The same object until something in it changes. */
  readonly getSnapshot: () => OpenQuestion | null;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Puts the question on screen and answers when the person is done with it: `{ ok: true }` when the operation they confirmed worked, its failure when it did not and they left, `cancelled` when they said no, and a refusal when a
   * question is already open. `run` is the operation; it never rejects.
   */
  readonly ask: (question: Question, run: () => Promise<ConnectionVerbResultV1>) => Promise<ConnectionVerbResultV1>;
  /** The person said yes: the operation runs, with the dialog busy. Nothing happens when no question is open or the operation is running already. */
  readonly confirm: () => void;
  /** The person said no, or left (Cancel, Close, Escape). */
  readonly cancel: () => void;
};

/** What a person who answered no is told, to a plugin that shows what it is told: nothing ran, and `cancelled` says so. */
const CANCELLED: ConnectionVerbResultV1 = Object.freeze({ ok: false, reason: 'Cancelled.', cancelled: true });

const OCCUPIED = 'Another question is waiting for an answer.';

/** The question that is open, with what the window keeps of it. */
type Open = {
  readonly shown: OpenQuestion;
  readonly run: () => Promise<ConnectionVerbResultV1>;
  readonly settle: (result: ConnectionVerbResultV1) => void;
  /** How the last try came to an end when it failed: what a person who leaves after it answers with. */
  readonly failure: ConnectionVerbResultV1 | undefined;
};

export function createQuestions(): Questions {
  const listeners = new Set<() => void>();
  let count = 0;
  let open: Open | null = null;

  const show = (next: Open | null): void => {
    open = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const ask: Questions['ask'] = async (question, run) => {
    if (open !== null) {
      return { ok: false, reason: OCCUPIED };
    }

    // The app's TypeScript library (ES2023) has no `Promise.withResolvers`: the promise is made with the executor.
    return new Promise<ConnectionVerbResultV1>((settle) => {
      count += 1;
      show({ shown: { ...question, id: count, busy: false, error: undefined }, run, settle, failure: undefined });
    });
  };

  const confirm = (): void => {
    const asked = open;
    if (asked === null || asked.shown.busy) {
      return;
    }

    show({ ...asked, shown: { ...asked.shown, busy: true, error: undefined } });
    void asked.run().then((result) => {
      const stays = open?.shown.id === asked.shown.id;
      if (result.ok || !stays) {
        // Worked, or the person left while it ran: the dialog goes (it is gone already when they left), and the answer is what the operation came to.
        if (stays) {
          show(null);
        }

        asked.settle(result);
        return;
      }

      show({ ...asked, shown: { ...asked.shown, busy: false, error: result.reason }, failure: result });
    });
  };

  const cancel = (): void => {
    const asked = open;
    if (asked === null) {
      return;
    }

    show(null);
    // An operation that is running answers for itself when it ends (`confirm`); a question that is not answers with how the last try ended, if one did, and with the no otherwise.
    if (!asked.shown.busy) {
      asked.settle(asked.failure ?? CANCELLED);
    }
  };

  return {
    getSnapshot: () => open?.shown ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask,
    confirm,
    cancel,
  };
}
