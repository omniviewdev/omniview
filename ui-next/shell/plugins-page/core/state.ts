import type { PluginEntry } from '../../../plugins/host/pluginStore';
import { failureWords, unloadedFailure, type GoneCause, type LoadFailure } from '../../../plugins/loader/failure';
import { SENTENCES } from './words';
import type { Cause, Installed, State, StateKind, Tone } from './types';

// The one state of a plugin as the page says it (ch16 S133, S135: the state word of a row, the chip of the header, the status lane). Where it comes from, in this order:
//   1. the host says the plugin is being removed (`plugin/unloaded`: uninstalled, not yet gone from the inventory) or holds it in the phase Uninstalling;
//   2. the person turned it off (`enabled` is false in the inventory): that is the person's choice and outranks whatever the process did on its way out;
//   3. the window's plugin store says the plugin's interface is gone or did not load: the SAME entry the rail reads, with the rail's words (`failureWords`), so the page and the rail cannot say two things of one plugin;
//   4. the phase the host holds the plugin in (`ui-next/shell/plugins-page/core/events.ts` lists them).
// A store entry that is still loading says nothing: the interface being read is the window's business, not a state of the plugin. Every word is the host's own, and nothing a plugin wrote is in a state.

export type StateInput = {
  readonly installed: Installed;
  /** What the window's plugin store says of this plugin, if it holds it (a plugin that is off, or the product's own, is not in it). */
  readonly entry: PluginEntry | undefined;
  /** The host said the plugin is being uninstalled and the inventory has not yet stopped listing it. */
  readonly removing: boolean;
};

type Facts = {
  readonly kind: StateKind;
  readonly word: string;
  readonly tone: Tone;
  readonly busy: boolean;
  readonly cause?: Cause | undefined;
  readonly title: (name: string) => string;
  readonly sentence: string;
};

const FACTS: Readonly<Record<'running' | 'starting' | 'recovering' | 'stopping' | 'degraded' | 'disabled' | 'stopped' | 'removing' | 'unknown' | 'build', Facts>> = {
  running: { kind: 'running', word: '', tone: 'success', busy: false, title: (name) => `${name} is running`, sentence: SENTENCES.running },
  starting: { kind: 'starting', word: 'Starting', tone: 'neutral', busy: true, title: (name) => `Starting ${name}…`, sentence: SENTENCES.starting },
  recovering: { kind: 'starting', word: 'Recovering', tone: 'neutral', busy: true, title: (name) => `Starting ${name} again…`, sentence: SENTENCES.recovering },
  stopping: { kind: 'stopping', word: 'Stopping', tone: 'neutral', busy: true, title: (name) => `Stopping ${name}…`, sentence: SENTENCES.stopping },
  degraded: { kind: 'degraded', word: 'Degraded', tone: 'warning', busy: false, title: (name) => `${name} is running with errors`, sentence: SENTENCES.degraded },
  disabled: { kind: 'disabled', word: 'Disabled', tone: 'neutral', busy: false, title: (name) => `${name} is disabled`, sentence: SENTENCES.disabled },
  stopped: { kind: 'stopped', word: 'Stopped', tone: 'neutral', busy: false, title: (name) => `${name} is stopped`, sentence: SENTENCES.stopped },
  removing: { kind: 'removing', word: 'Removing', tone: 'neutral', busy: true, title: (name) => `Removing ${name}…`, sentence: SENTENCES.removing },
  unknown: { kind: 'unknown', word: 'Unknown', tone: 'neutral', busy: false, title: (name) => `${name} is in a state this version does not know`, sentence: SENTENCES.unknown },
  build: { kind: 'failed', word: 'Build failed', tone: 'error', busy: false, cause: 'build', title: (name) => `${name} failed to build`, sentence: SENTENCES.build },
};

const GONE_TITLES: Readonly<Record<GoneCause, (name: string) => string>> = {
  crashed: (name) => `${name} stopped`,
  reloaded: (name) => `Starting ${name} again…`,
  failed: (name) => `${name} didn't start`,
  timeout: (name) => `${name} took too long to start`,
  incompatible: (name) => `${name} is not compatible with this version of Omniview`,
};

const done = (facts: Facts, name: string): State => ({
  kind: facts.kind,
  word: facts.word,
  tone: facts.tone,
  busy: facts.busy,
  cause: facts.cause,
  title: facts.title(name),
  sentence: facts.sentence,
  faulted: facts.tone === 'error',
});

/** The state of a plugin the host says is gone or could not start: the rail's word for the cause, and the host's sentence for it (the failure's own, so that a refusal by protocol says its two versions). A plugin that is starting again is work, and nothing failed; one the host refused for its protocol is a fault of its own kind, for which no Retry is drawn. */
function goneState(failure: LoadFailure, name: string): State {
  const cause = failure.cause ?? 'crashed';
  const words = failureWords(failure);
  return {
    kind: cause === 'reloaded' ? 'starting' : cause === 'incompatible' ? 'incompatible' : 'failed',
    word: words.caption,
    tone: words.faulted ? 'error' : 'neutral',
    busy: !words.faulted,
    cause,
    title: GONE_TITLES[cause](name),
    sentence: failure.message,
    faulted: words.faulted,
  };
}

/** The state of a plugin whose interface did not load: the window's own sentence for why (a kind and a sentence, never the text behind it). */
function interfaceState(sentence: string, name: string): State {
  return { kind: 'failed', word: 'Did not load', tone: 'error', busy: false, cause: 'interface', title: `${name} didn't load`, sentence, faulted: true };
}

function phaseState(installed: Installed): State {
  const { name, phase } = installed;
  switch (phase) {
    case 'Running':
      return done(FACTS.running, name);
    case 'Starting':
    case 'Validating':
    case 'Installing':
    case 'Building':
      return done(FACTS.starting, name);
    case 'Recovering':
      return done(FACTS.recovering, name);
    case 'Stopping':
      return done(FACTS.stopping, name);
    case 'Degraded':
      return done(FACTS.degraded, name);
    case 'Stopped':
    case 'Installed':
      return done(FACTS.stopped, name);
    case 'Failed':
      return goneState(unloadedFailure('failed'), name);
    case 'BuildFailed':
      return done(FACTS.build, name);
    case 'Uninstalling':
      return done(FACTS.removing, name);
    default:
      return done(FACTS.unknown, name);
  }
}

/** The one state of a plugin. Pure: the same inputs say the same state. */
export function stateOf({ installed, entry, removing }: StateInput): State {
  const { name } = installed;
  if (removing) {
    return done(FACTS.removing, name);
  }

  if (!installed.enabled && installed.phase !== 'Uninstalling') {
    return done(FACTS.disabled, name);
  }

  if (entry?.phase === 'failed') {
    const { failure } = entry;
    return failure.kind === 'unloaded' ? goneState(failure, name) : interfaceState(failure.message, name);
  }

  return phaseState(installed);
}
