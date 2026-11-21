// Why a plugin has no contribution, as the page words it. Six kinds, each a different thing for a person to do:
//
// - `missing`:      the bundle could not be read (not installed, removed, the host could not serve it). Try again, or reinstall.
// - `incompatible`: the bundle imports what this version of the app does not serve, so it was built for another one. Update the plugin.
// - `broken`:       the bundle was read and linked but threw when it ran. A defect of the plugin.
// - `timeout`:      it did not finish in time.
// - `contract`:     it ran but does not hand the host a contribution this version understands (`admit.ts`).
// - `unloaded`:     it had a contribution, and the host says it stopped serving the window (`plugin/unloaded`, host/lifecycle.ts): its process crashed, or it is reloading. Wait, or try again.
//
// The messages are sentences for the page; the detail is for the log and the details view. A failure is a value, never a throw, past the loader.

export type LoadFailureKind = 'missing' | 'incompatible' | 'broken' | 'timeout' | 'contract' | 'unloaded';

/**
 * Why the host says a plugin stopped serving the window: the whole of what the event carries besides the plugin's id (backend/pkg/plugin/events.go, `UnloadCause`). One of four words, never
 * text: each is worded here, for the person, by the host.
 */
export type UnloadCause = 'crashed' | 'reloaded' | 'uninstalled' | 'disabled';

export const UNLOAD_CAUSES: readonly UnloadCause[] = ['crashed', 'reloaded', 'uninstalled', 'disabled'];

export type LoadFailure = {
  readonly kind: LoadFailureKind;
  /** What the page says: one sentence. */
  readonly message: string;
  /** What the log says: the names or the text behind it. */
  readonly detail?: string | undefined;
  /** Only for `unloaded`: why the plugin stopped. */
  readonly cause?: UnloadCause | undefined;
};

/**
 * The failure of a plugin that stopped and will be wanted again: a crash (the mock's failed plugin, "The plugin process stopped unexpectedly, so its pages can't load data."; ch16 S89) and a
 * reload (its starting, "The plugin is starting. The page opens when it is ready."). A plugin that was removed or turned off has no failure: it is a plugin the window does not have.
 */
export function unloadedFailure(cause: 'crashed' | 'reloaded'): LoadFailure {
  return cause === 'crashed'
    ? { kind: 'unloaded', cause, message: 'The plugin process stopped unexpectedly, so its pages can\'t load data.' }
    : { kind: 'unloaded', cause, message: 'The plugin is starting again. The page opens when it is ready.' };
}

/**
 * What the places that list a plugin by name say of one that has no contribution: a word after its name in the rail, the caption of its row in the empty window, and whether it is a fault (the
 * error glyph) or only a plugin on its way back (a plugin that is reloading is the mock's starting, ch16 S89: nothing failed).
 */
export function failureWords(failure: LoadFailure): { readonly label: string; readonly caption: string; readonly faulted: boolean } {
  if (failure.kind !== 'unloaded') {
    return { label: 'did not load', caption: 'Did not load', faulted: true };
  }

  return failure.cause === 'reloaded' ? { label: 'starting again', caption: 'Starting again', faulted: false } : { label: 'stopped', caption: 'Stopped', faulted: true };
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
