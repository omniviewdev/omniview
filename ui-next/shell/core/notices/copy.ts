import { line } from './text';
import { LIMITS, type ActionView, type Cancellation, type FoldKind, type Kind, type Progress, type Severity, type State, type Target } from './types';

// One function behind every rendering of a record (S75): a surface may show fewer actions, never other text. The mock's `present`, `headline`, `failedTitle`, `foldNote`, `laneText` and
// `stateWord` (shell-notify.js), and the voice of `Shell.msg` (X3: contractions, "Couldn't connect", a full sentence ends with a period). Its tables of verbs and nouns are English and the
// model's own; the words of a plugin's domain are not here (the host is plugin-agnostic).

/** What the words of a record are made from. */
export type Phrase = {
  readonly kind: Kind;
  readonly state: State;
  readonly severity: Severity;
  readonly source: string;
  readonly sourceName: string;
  readonly title: string;
  readonly doneTitle: string;
  /** The one sentence of phase text or effect. */
  readonly detail: string;
  readonly target: Target | undefined;
  readonly progress: Progress | null;
  readonly cancellation: Cancellation;
  /** The label a producer gave the Cancel it declared ("Stop forwarding"), or empty. */
  readonly cancelLabel: string;
  readonly attempt: number;
  readonly count: number;
  readonly fold: FoldKind;
};

export type Presentation = {
  readonly title: string;
  readonly word: string;
  readonly text: string;
  readonly reason: string;
  readonly phase: string;
};

const ACTIVE: readonly State[] = ['queued', 'running', 'paused'];

/** The noun of a title that starts with a gerund (S74: a title is a present participle while the work is active): "Connecting to replica 5" is a connection. */
const NOUNS: Readonly<Record<string, string>> = Object.freeze({
  installing: 'install', uninstalling: 'uninstall', updating: 'update', upgrading: 'upgrade', restarting: 'restart', starting: 'start', stopping: 'stop', syncing: 'sync',
  synchronizing: 'sync', refreshing: 'refresh', reloading: 'reload', connecting: 'connection', disconnecting: 'disconnection', reconnecting: 'reconnection', deploying: 'deployment',
  uploading: 'upload', downloading: 'download', exporting: 'export', importing: 'import', restoring: 'restore', scanning: 'scan', building: 'build', creating: 'creation',
  deleting: 'deletion', terminating: 'termination', launching: 'launch', migrating: 'migration', validating: 'validation', authenticating: 'authentication', attaching: 'attachment',
  detaching: 'detachment', backing: 'backup',
});

/** What failed, from the gerund a title starts with ("Connecting to prod-db" is "Couldn't connect to prod-db"). A two-word gerund is read before its first word alone. */
const VERBS: Readonly<Record<string, string>> = Object.freeze({
  installing: 'install', uninstalling: 'uninstall', updating: 'update', upgrading: 'upgrade', restarting: 'restart', starting: 'start', stopping: 'stop', syncing: 'sync',
  synchronizing: 'synchronize', refreshing: 'refresh', reloading: 'reload', connecting: 'connect', disconnecting: 'disconnect', reconnecting: 'reconnect', deploying: 'deploy',
  'rolling back': 'roll back', 'backing up': 'back up', uploading: 'upload', downloading: 'download', exporting: 'export', importing: 'import', restoring: 'restore',
  scanning: 'scan', building: 'build', rebuilding: 'rebuild', creating: 'create', deleting: 'delete', terminating: 'terminate', launching: 'launch', migrating: 'migrate',
  validating: 'validate', authenticating: 'authenticate', attaching: 'attach', detaching: 'detach', applying: 'apply', copying: 'copy', enabling: 'enable', disabling: 'disable',
  linking: 'link', unlinking: 'unlink', loading: 'load', opening: 'open', saving: 'save', running: 'run', checking: 'check', fetching: 'fetch', publishing: 'publish',
  renaming: 'rename', resizing: 'resize', scaling: 'scale', suspending: 'suspend', resuming: 'resume', forwarding: 'forward', triggering: 'trigger',
});

/** A table of the model's own, read by what a person wrote: a word like `constructor` is not an entry. */
const lookup = (table: Readonly<Record<string, string>>, word: string): string | undefined => (Object.hasOwn(table, word) ? table[word] : undefined);

const STATE_WORD: Readonly<Record<State, string>> = { queued: 'Queued', running: '', paused: 'Paused', succeeded: '', failed: '', cancelled: 'Canceled', unknown: 'Outcome unknown.' };
const OPERATION_OUTCOME: Readonly<Partial<Record<State, string>>> = { failed: 'failed', succeeded: 'finished', cancelled: 'canceled', unknown: 'ended with an unknown outcome' };
const MESSAGE_OUTCOME: Readonly<Partial<Record<Severity, string>>> = { error: 'failed', success: 'finished', warning: 'need attention' };

const plural = (noun: string): string => (/(s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`);

const firstWord = (text: string): string => (text.trim().split(/[\s:]+/)[0] ?? '').toLowerCase();

const isStop = (label: string): boolean => /^Stop(?:\s|$)/.test(label);

/** A full sentence: a capital, and a period unless the text already ends one. */
export function sentenceOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }

  const sentence = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** "Couldn't …" for a title that starts with a gerund the model knows; empty for any other title, which stays as it was. */
export function failedTitle(title: string): string {
  const two = /^(\S+\s+\S+)(\s.*)?$/.exec(title);
  const one = /^(\S+)(\s.*)?$/.exec(title);
  const at = two !== null && lookup(VERBS, (two[1] ?? '').toLowerCase()) !== undefined ? two : one;
  const verb = at === null ? undefined : lookup(VERBS, (at[1] ?? '').toLowerCase());
  return verb === undefined ? '' : line(`Couldn't ${verb}${at?.[2] ?? ''}`, LIMITS.title);
}

/** What the folded records are: an explicit kind of target, else the noun the title starts with, or the noun itself. */
function nounOf(phrase: Phrase): string {
  const word = firstWord(phrase.title);
  return phrase.target?.kind !== undefined && phrase.target.kind !== '' ? phrase.target.kind : (lookup(NOUNS, word) ?? (Object.values(NOUNS).includes(word) ? word : ''));
}

const outcomeOf = (phrase: Phrase): string => (phrase.kind === 'operation' ? (OPERATION_OUTCOME[phrase.state] ?? '') : (MESSAGE_OUTCOME[phrase.severity] ?? ''));

/**
 * The title a person reads (S79): a folded group says what happened and how many times ("5 connections failed", "3 installs finished"); when the records share only a source it says that
 * ("5 notifications from Cloud"); the same message again says so ("Snapshot created 3 times"). Work that succeeded reads as what it did (OF3), work that failed as what it could not do.
 */
export function headline(phrase: Phrase): string {
  if (phrase.fold === 'repeat') {
    const tail = ` ${String(phrase.count)} times`;
    return `${line(phrase.title, LIMITS.title - tail.length)}${tail}`;
  }

  if (phrase.fold === 'group') {
    const noun = nounOf(phrase);
    const outcome = outcomeOf(phrase);
    if (noun !== '' && outcome !== '') {
      return line(`${String(phrase.count)} ${plural(noun)} ${outcome}`, LIMITS.title);
    }

    return line(phrase.kind === 'operation' ? `${String(phrase.count)} ${phrase.source === 'host' ? '' : `${phrase.sourceName} `}operations ${outcome}` : `${String(phrase.count)} notifications from ${phrase.sourceName}`, LIMITS.title);
  }

  if (phrase.state === 'succeeded' && phrase.doneTitle !== '') {
    return phrase.doneTitle;
  }

  return (phrase.kind === 'operation' && phrase.state === 'failed' && phrase.count <= 1 ? failedTitle(phrase.title) : '') || phrase.title;
}

/** The second line of a folded group or a keyed notice: the latest title, or how often it happened. */
export function foldNote(phrase: Phrase): string {
  if (phrase.fold === 'group') {
    return `Latest: ${phrase.state === 'succeeded' && phrase.doneTitle !== '' ? phrase.doneTitle : phrase.title}${phrase.detail === '' ? '' : ` — ${phrase.detail}`}`;
  }

  return phrase.fold === 'key' ? `Happened ${String(phrase.count)} times${phrase.detail === '' ? '' : ` · ${phrase.detail}`}` : '';
}

/** The second line: what a fold stands for, what to check when the outcome is unknown, the step while a step runs, else the producer's sentence. */
export function laneText(phrase: Phrase): string {
  const note = foldNote(phrase);
  if (note !== '') {
    return note;
  }

  if (phrase.state === 'unknown') {
    return `Check ${phrase.target?.label ?? 'the target'}.${phrase.detail === '' ? '' : ` ${phrase.detail}`}`;
  }

  if (phrase.detail === '' && ACTIVE.includes(phrase.state) && phrase.progress?.kind === 'steps' && phrase.progress.label !== '') {
    return phrase.progress.label;
  }

  return phrase.detail;
}

/** The word before the text: Canceling… (or Stopping…) until the producer acknowledges (S84), the attempt, or the state's own word. */
export function stateWord(phrase: Phrase): string {
  if (ACTIVE.includes(phrase.state) && (phrase.cancellation === 'requested' || phrase.cancellation === 'acknowledged')) {
    return isStop(phrase.cancelLabel) ? 'Stopping…' : 'Canceling…';
  }

  return phrase.state === 'running' && phrase.attempt > 1 ? `Attempt ${String(phrase.attempt)}` : STATE_WORD[phrase.state];
}

/**
 * What every rendering of a record says. `reason` is the visible sentence for the first command that cannot be used ("Retry is unavailable. Not available after restart."), never for a
 * Cancel that waits on its producer; `phase` is the one sentence a compact rendering shows: the state word and text while the work is active, the headline and the effect once it ended.
 */
export function present(phrase: Phrase, actions: readonly ActionView[]): Presentation {
  const title = headline(phrase);
  const word = phrase.fold === 'group' ? '' : stateWord(phrase);
  const text = laneText(phrase);
  const lane = word !== '' && text !== '' ? `${word}${word.endsWith('.') ? ' ' : ' · '}${text}` : word === '' ? text : word;
  const blocked = actions.find((candidate) => candidate.disabled !== '' && candidate.kind !== 'cancel');
  const reason = blocked === undefined ? '' : `${blocked.label} is unavailable. ${sentenceOf(blocked.disabled)}`;
  const ended = phrase.state === 'failed' || phrase.state === 'succeeded';
  const phase = ended ? `${title}${text === '' ? '' : `${title.endsWith('.') ? ' ' : '. '}${text}`}${reason === '' ? '' : ` ${reason}`}` : lane === '' ? title : lane;
  return { title, word, text, reason, phase };
}
