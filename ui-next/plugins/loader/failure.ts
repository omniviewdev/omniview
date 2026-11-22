// Why a plugin has no contribution, as the page words it. Six kinds, each a different thing for a person to do:
//
// - `missing`:      the bundle could not be read (not installed, removed, the host could not serve it). Try again, or reinstall.
// - `incompatible`: the bundle imports what this version of the app does not serve, so it was built for another one. Update the plugin.
// - `broken`:       the bundle was read and linked but threw when it ran. A defect of the plugin.
// - `timeout`:      it did not finish in time.
// - `contract`:     it ran but does not hand the host a contribution this version understands (`admit.ts`).
// - `unloaded`:     it had a contribution, and the host says it stopped serving the window or could not start (`plugin/unloaded`, host/lifecycle.ts): its process crashed, it is reloading, its load failed, its process
//                   did not answer in time, or the host refused it because it speaks a plugin protocol this Omniview does not run (`incompatible`). Wait, or try again, except for the last: asking again cannot help.
//
// The messages are sentences for the page; the detail is for the log and the details view. A failure is a value, never a throw, past the loader.

export type LoadFailureKind = 'missing' | 'incompatible' | 'broken' | 'timeout' | 'contract' | 'unloaded';

/**
 * Why the host says a plugin is not serving the window: what the event carries besides the plugin's id (backend/pkg/plugin/events.go, `UnloadCause`). One of seven words, never text: each is worded here, for the person, by the host.
 * `failed` and `timeout` are the end of a load that went wrong (its files did not validate, its process did not start, or it did not answer within the loader's own start timeout), told by the host whether the load was a reload, a retry or a first load.
 * `incompatible` is the host's refusal of a plugin whose process speaks a plugin protocol this Omniview does not run, decided from the number the handshake negotiated; it brings the two numbers (`Incompatibility`).
 */
export type UnloadCause = 'crashed' | 'reloaded' | 'uninstalled' | 'disabled' | 'failed' | 'timeout' | 'incompatible';

export const UNLOAD_CAUSES: readonly UnloadCause[] = ['crashed', 'reloaded', 'uninstalled', 'disabled', 'failed', 'timeout', 'incompatible'];

/** A closed range of plugin protocol numbers (`ProtocolRange`, backend/pkg/plugin/types/protocol.go). */
export type ProtocolRange = { readonly oldest: number; readonly newest: number };

/**
 * Why the host refused a plugin by protocol number, as the numbers the host decided on and nothing else (`Incompatibility`, backend/pkg/plugin/types/protocol.go): the protocol the plugin's process negotiated and the range this
 * Omniview runs. It rides the event (`plugin/unloaded`) and the plugin's inventory entry (`PluginInfo.incompatible`); no word of the plugin's or of go-plugin's travels with it, and the words are this file's.
 */
export type Incompatibility = { readonly pluginProtocol: number; readonly accepted: ProtocolRange };

const isProtocol = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * The facts of a refusal by protocol number, read from what the host sent (an event's member, an inventory entry's): `undefined` unless the value is the plugin's protocol and a range of protocols, each a whole number from 1 and the
 * range's oldest no newer than its newest. Whatever else the object carries is not read.
 */
export function readIncompatibility(value: unknown): Incompatibility | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const pluginProtocol: unknown = Reflect.get(value, 'pluginProtocol');
  const accepted: unknown = Reflect.get(value, 'accepted');
  if (!isProtocol(pluginProtocol) || typeof accepted !== 'object' || accepted === null) {
    return undefined;
  }

  const oldest: unknown = Reflect.get(accepted, 'oldest');
  const newest: unknown = Reflect.get(accepted, 'newest');
  return isProtocol(oldest) && isProtocol(newest) && oldest <= newest ? { pluginProtocol, accepted: { oldest, newest } } : undefined;
}

/** The causes after which the window still has the plugin, as a failed entry of the kind `unloaded` that says why. A plugin that was uninstalled or turned off is not a failure: the window does not have it. */
export type GoneCause = Exclude<UnloadCause, 'uninstalled' | 'disabled'>;

export type LoadFailure = {
  readonly kind: LoadFailureKind;
  /** What the page says: one sentence. */
  readonly message: string;
  /** What the log says: the names or the text behind it. */
  readonly detail?: string | undefined;
  /** Only for `unloaded`: why the plugin is not there. */
  readonly cause?: GoneCause | undefined;
  /** Only for `unloaded` with the cause `incompatible`: the host's two numbers, which `message` words. */
  readonly incompatibility?: Incompatibility | undefined;
};

/** The causes that are words and nothing more: a plugin that is gone for one of them says the same sentence whenever the host says it. `incompatible` says its numbers too (`incompatibleFailure`). */
export type PlainGoneCause = Exclude<GoneCause, 'incompatible'>;

const SENTENCES: Readonly<Record<PlainGoneCause, string>> = {
  crashed: 'The plugin process stopped unexpectedly, so its pages can\'t load data.',
  reloaded: 'The plugin is starting again. The page opens when it is ready.',
  failed: 'The plugin could not start, so its pages can\'t load data.',
  timeout: 'The plugin took too long to start, so its pages can\'t load data.',
};

/**
 * The failure of a plugin that is not there and will be wanted again: a crash (the mock's failed plugin, "The plugin process stopped unexpectedly, so its pages can't load data."; ch16 S89), a reload (its starting, "The plugin is
 * starting. The page opens when it is ready."), and a load that failed or ran out of time (the mock's failed plugin again, in the host's words for what the host reports: a code, never the plugin's text). A plugin that was
 * removed or turned off has no failure: it is a plugin the window does not have.
 */
export function unloadedFailure(cause: PlainGoneCause): LoadFailure {
  return { kind: 'unloaded', cause, message: SENTENCES[cause] };
}

/** The host's sentence for a plugin built for a protocol this Omniview does not run. It says no direction (older or newer): the person has the same two ways out in both, and this window offers neither. */
const INCOMPATIBLE_SENTENCE = 'This plugin was built for a different version of Omniview.';

/**
 * The failure of a plugin the host refused by protocol number: the host's sentence, followed by the two versions the host decided on (the plugin's protocol and the range this Omniview accepts), in words composed here from the
 * numbers: the host sends none (`Incompatibility.String` in backend/pkg/plugin/types/protocol.go words the same numbers for its log and the old shell's page, and a test of each side holds the one sentence). Asking again cannot
 * help, so the page offers no Retry (`canRetry`); and no update is offered either, because this window has no way to update a plugin today: it says what is true and nothing it cannot do.
 */
export function incompatibleFailure(facts: Incompatibility): LoadFailure {
  const { oldest, newest } = facts.accepted;
  const accepts = oldest === newest ? `protocol ${String(newest)}` : `protocols ${String(oldest)} to ${String(newest)}`;
  return {
    kind: 'unloaded',
    cause: 'incompatible',
    message: `${INCOMPATIBLE_SENTENCE} It uses plugin protocol ${String(facts.pluginProtocol)}; this Omniview accepts ${accepts}.`,
    incompatibility: facts,
  };
}

/**
 * Whether asking the host again can help. It cannot for a plugin built for a protocol this Omniview does not run: the same process would say the same number, so the page draws no Retry (a button that cannot work is not
 * offered, PU2) and the store asks the host for nothing. Every other failure may pass: the host starts the plugin again, or the interface is read again.
 */
export function canRetry(failure: LoadFailure): boolean {
  return failure.kind !== 'unloaded' || failure.cause !== 'incompatible';
}

type FailureWords = { readonly label: string; readonly caption: string; readonly faulted: boolean };

const UNLOADED_WORDS: Readonly<Record<GoneCause, FailureWords>> = {
  crashed: { label: 'stopped', caption: 'Stopped', faulted: true },
  reloaded: { label: 'starting again', caption: 'Starting again', faulted: false },
  failed: { label: 'did not start', caption: 'Did not start', faulted: true },
  timeout: { label: 'timed out', caption: 'Timed out', faulted: true },
  // The mock's state word for an incompatible plugin (ch16 S88, "Update required"): it is not on its way back, so it is a fault.
  incompatible: { label: 'update required', caption: 'Update required', faulted: true },
};

/**
 * What the places that list a plugin by name say of one that has no contribution: a word after its name in the rail, the caption of its row in the empty window, and whether it is a fault (the
 * error glyph) or only a plugin on its way back (a plugin that is reloading is the mock's starting, ch16 S89: nothing failed).
 */
export function failureWords(failure: LoadFailure): FailureWords {
  if (failure.kind !== 'unloaded') {
    return { label: 'did not load', caption: 'Did not load', faulted: true };
  }

  return UNLOADED_WORDS[failure.cause ?? 'crashed'];
}

/** A bundle that imports names the host does not serve. Thrown before the bundle runs. */
export class IncompatibleBundleError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(`The bundle imports ${names.join(', ')}, which this version does not serve`);
    this.name = 'IncompatibleBundleError';
    this.names = names;
  }
}

export class BundleTimeoutError extends Error {
  constructor(readonly milliseconds: number) {
    super(`The bundle did not finish loading in ${String(milliseconds)} ms`);
    this.name = 'BundleTimeoutError';
  }
}

/** The contribution a bundle handed over is not one this version understands. `problems` are what is wrong with it. */
export class ContractError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('; '));
    this.name = 'ContractError';
  }
}

const UNRESOLVED = /Unable to resolve bare specifier '([^']+)'/;
const NOT_READ = /\b(?:Error loading|Fetch error|Failed to fetch|NetworkError|did not instantiate)\b|, loading https?:/i;

const firstLine = (text: string): string => (text.split('\n')[0] ?? '').slice(0, 240);

/** The failure a thrown value means. Anything that is not one of the loader's own errors is read from its text, as SystemJS words its own. */
export function classify(error: unknown): LoadFailure {
  if (error instanceof IncompatibleBundleError) {
    return { kind: 'incompatible', message: 'This plugin was built for another version of the app. Update it.', detail: error.message };
  }

  if (error instanceof BundleTimeoutError) {
    return { kind: 'timeout', message: 'The plugin took too long to load.', detail: error.message };
  }

  if (error instanceof ContractError) {
    return { kind: 'contract', message: 'This plugin does not describe its pages in a way this version understands.', detail: error.message };
  }

  const text = error instanceof Error ? error.message : String(error);
  const unresolved = UNRESOLVED.exec(text);
  if (unresolved !== null) {
    return { kind: 'incompatible', message: 'This plugin was built for another version of the app. Update it.', detail: `It imports ${unresolved[1] ?? ''}, which this version does not serve` };
  }

  if (NOT_READ.test(text)) {
    return { kind: 'missing', message: 'The plugin\'s interface could not be read.', detail: firstLine(text) };
  }

  return { kind: 'broken', message: 'The plugin\'s interface failed to start.', detail: firstLine(text) };
}
