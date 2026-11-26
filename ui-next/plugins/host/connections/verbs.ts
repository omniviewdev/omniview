import type { ConfirmSubject } from '@omniviewdev/kit';
import type { ConnectionVerbResultV1 } from '../../contract/v1';
import type { ConnectionsApi } from './api';
import { createQuestions, type Question, type Questions } from './questions';
import type { Reach } from './reach';
import type { ConnectionsStore } from './store';
import type { ConnectionBusy, HostConnection } from './types';
import { faceOf, NOT_LISTED, refusalOf, unhealthyReason, verbFailure } from './words';

// What a page of a plugin may do to its connections besides opening one (KL4; `ConnectionsHostV1`): start one without opening a page, check one, stop one, remove one, and load them again. Each answers `{ ok: true }` or why not in a
// sentence, and never rejects; each is the host's call, attributed to the plugin whose handle made it (`connectionsHost.ts` gives the plugin).
//
// ONE VERB AT A TIME on a connection: the list marks the connection with what is being done (`busy`, `store.ts`, `hold`) and a verb that finds it marked is refused in a sentence. A connection that is connecting is not held, stopped,
// checked or removed either: the host's own stop waits behind a start that does not end (backend catalog B-56), so it is refused instead of left waiting.
//
// A STOP AND A REMOVAL ASK FIRST, and the host asks (`questions.ts`): the dialog names the connection and, for a stop, how many tabs and sessions of it are open. A verb that would be refused is refused before it asks, and when the person says
// yes the operation runs, holding the connection, inside the dialog.

export type ConnectionVerbs = {
  /** Starts the connection and opens nothing; answers when it is connected (a connection that is connected is already). */
  readonly connect: (plugin: string, key: string) => Promise<ConnectionVerbResultV1>;
  /** Asks the plugin whether the connection is healthy, and reads the list again: `{ ok: true }` when it is, else what is wrong with it. */
  readonly check: (plugin: string, key: string) => Promise<ConnectionVerbResultV1>;
  /** Asks the person, and then stops the connection. */
  readonly disconnect: (plugin: string, key: string) => Promise<ConnectionVerbResultV1>;
  /** Asks the person, and then removes the connection from the plugin's list. */
  readonly remove: (plugin: string, key: string) => Promise<ConnectionVerbResultV1>;
  /** Asks the plugin's backend to load its connections again, and reads the list. Never rejects. */
  readonly refresh: (plugin: string) => Promise<void>;
  /** The window's one question, which the dialog draws (`ConnectionQuestion.tsx`). */
  readonly questions: Questions;
};

export type ConnectionVerbsDeps = {
  /** The window's list, which holds a connection for a verb while it runs (`store.hold`). */
  readonly store: ConnectionsStore;
  /** The host's own calls. */
  readonly api: Pick<ConnectionsApi, 'check' | 'stop' | 'remove'>;
  /** What a stop would reach, asked when the question is made. */
  readonly reach: (plugin: string, key: string) => Reach;
};

const OK: ConnectionVerbResultV1 = Object.freeze({ ok: true });

/** What a person is told when the host rejected a verb with no line of its own to show: what did not happen. */
const CHECK_FAILED = 'The connection could not be checked.';
const STOP_FAILED = 'The connection did not stop.';
const REMOVE_FAILED = 'The connection was not removed.';

/** Who a question is about: the connection by its name, its description and where it stands, in the host's words. */
function subjectOf(entry: HostConnection): ConfirmSubject {
  const { role, word } = faceOf(entry.state);
  return { name: entry.name, kind: 'Connection', meta: entry.detail, status: { role, label: word } };
}

/** The question of a stop: what it reaches, in the host's words, and a verb that fills the button with the error role, as the design's Tier 1 confirmations do (the mock's K58.2). */
function disconnectQuestion(entry: HostConnection, { tabs, sessions }: Reach): Question {
  const reached = [tabs === 0 ? '' : `${String(tabs)} open ${tabs === 1 ? 'tab' : 'tabs'}`, sessions === 0 ? '' : `${String(sessions)} ${sessions === 1 ? 'session' : 'sessions'}`].filter((part) => part !== '');
  return {
    title: 'Disconnect',
    icon: 'unplug',
    tone: 'danger',
    subject: subjectOf(entry),
    message: reached.length === 0 ? `Stops browsing ${entry.name}. You can connect again at any time.` : `${reached.join(' and ')} of ${entry.name} will lose the connection. You can connect again at any time.`,
    confirmLabel: 'Disconnect',
  };
}

/** The question of a removal: the connection leaves the plugin's list, and what it points to is not touched. */
function removeQuestion(entry: HostConnection): Question {
  return {
    title: 'Remove connection',
    icon: 'trash',
    tone: 'danger',
    subject: subjectOf(entry),
    message: `Removes ${entry.name} from your connection list. Nothing it points to is changed.`,
    confirmLabel: 'Remove',
  };
}

export function createConnectionVerbs({ store, api, reach }: ConnectionVerbsDeps): ConnectionVerbs {
  const questions = createQuestions();

  /** Runs `work` while the verb holds the connection, or answers why it cannot be held. The hold goes after the list was read again, whichever way `work` ended. */
  const holding = async (plugin: string, key: string, busy: Exclude<ConnectionBusy, 'connecting'>, work: () => Promise<ConnectionVerbResultV1>): Promise<ConnectionVerbResultV1> => {
    const held = store.hold(plugin, key, busy);
    if (!held.ok) {
      return { ok: false, reason: held.reason };
    }

    try {
      return await work();
    } finally {
      await held.release();
    }
  };

  /** The operation of a verb that asked first, once the person said yes: the host's call, and what it said if it threw. */
  const confirmed = async (plugin: string, key: string, busy: 'disconnecting' | 'removing', call: () => Promise<unknown>, fallback: string): Promise<ConnectionVerbResultV1> =>
    holding(plugin, key, busy, async () => {
      try {
        await call();
        return OK;
      } catch (error) {
        return { ok: false, reason: verbFailure(error, fallback) };
      }
    });

  /** The connection a verb that asks first is about, or the sentence of why it is not asked at all: it is not listed, or something is being done to it. */
  const askable = (plugin: string, key: string): HostConnection | string => {
    const entry = store.getSnapshot().connections.find((candidate) => candidate.plugin === plugin && candidate.key === key);
    return entry === undefined ? NOT_LISTED : (refusalOf(entry) ?? entry);
  };

  return {
    connect: async (plugin, key) => {
      const outcome = await store.connect(plugin, key);
      return outcome.status === 'connected' ? OK : { ok: false, reason: outcome.reason };
    },
    check: async (plugin, key) =>
      holding(plugin, key, 'checking', async () => {
        try {
          const reason = unhealthyReason(await api.check(plugin, key));
          return reason === undefined ? OK : { ok: false, reason };
        } catch (error) {
          return { ok: false, reason: verbFailure(error, CHECK_FAILED) };
        }
      }),
    disconnect: async (plugin, key) => {
      const entry = askable(plugin, key);
      if (typeof entry === 'string') {
        return { ok: false, reason: entry };
      }

      return questions.ask(disconnectQuestion(entry, reach(plugin, key)), async () => confirmed(plugin, key, 'disconnecting', async () => api.stop(plugin, key), STOP_FAILED));
    },
    remove: async (plugin, key) => {
      const entry = askable(plugin, key);
      if (typeof entry === 'string') {
        return { ok: false, reason: entry };
      }

      return questions.ask(removeQuestion(entry), async () => confirmed(plugin, key, 'removing', async () => api.remove(plugin, key), REMOVE_FAILED));
    },
    refresh: async (plugin) => store.reload(plugin),
    questions,
  };
}
