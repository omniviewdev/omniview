// What the Plugins page knows of an installed plugin, and where each fact comes from. The page draws state the host says and nothing it guesses (decision: a fact the host or the page would have to guess is a gap in
// what the producer says, and is catalogued in docs/ui-next/status/PL1.md, never worked around): the manifest facts and the phase come from the host's inventory (`PluginManager.ListPlugins`), the interface half from the
// window's plugin store (the same entries the rail reads), the moves between phases from the host's events, and the work in flight from this page's own calls.

/** The members of a person or a group a manifest names. */
export type InventoryAuthor = { readonly name: string };

/**
 * The members of an inventory entry (`PluginInfo`, `backend/pkg/plugin/types/plugin_record.go`) that the page reads. NOT read: `lastError`, the text of the last error the host held for the plugin, which is raw (file paths,
 * the process's own first line, recovery directories) and which no gate has cleaned; the page says why a plugin failed in the host's own words and from the causes the host's events carry (`ui-next/plugins/loader/failure.ts`).
 */
export type InventoryEntry = {
  readonly id: string;
  /** `builtin` (the product's own plugin: it cannot be uninstalled) or `external`; an empty word is `external`. */
  readonly origin: string;
  readonly enabled: boolean;
  readonly phase: string;
  readonly devMode: boolean;
  readonly releaseChannel: string;
  readonly metadata: {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly category: string;
    readonly license: string;
    readonly author?: InventoryAuthor | null | undefined;
    readonly repository: string;
    readonly website: string;
    readonly tags: readonly string[];
    readonly dependencies: readonly string[];
    /** The capability kinds the plugin DECLARES (`resource`, `exec`, `log`...): what surfaces it offers, not what it may access. The top-level `capabilities` of the entry is what a live process detected, and is empty for a plugin that is not running. */
    readonly capabilities: readonly string[];
  };
};

/** One plugin as the inventory says it, its strings bounded (`inventory.ts`). */
export type Installed = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly publisher: string;
  readonly license: string;
  readonly category: string;
  readonly repository: string;
  readonly website: string;
  readonly tags: readonly string[];
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly builtin: boolean;
  readonly enabled: boolean;
  readonly devMode: boolean;
  readonly releaseChannel: string;
  /** The phase the host holds the plugin in, as the host says it (`lifecycle.PluginPhase`). */
  readonly phase: string;
};

/** The work this page started on a plugin and has not seen the end of. */
export type Operation = 'reload' | 'retry' | 'enable' | 'disable' | 'uninstall';

export const OPERATIONS: readonly Operation[] = ['reload', 'retry', 'enable', 'disable', 'uninstall'];

/** What a person is told of a plugin's state: one word, its tone, and the sentences of the status lane. */
export type StateKind = 'running' | 'starting' | 'stopping' | 'degraded' | 'disabled' | 'stopped' | 'failed' | 'removing' | 'unknown';

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'error';

/**
 * Why a plugin is not serving: the host's causes (`UnloadCause`), the interface that did not load, and a development build that failed. A typed incompatibility cause (a plugin built below the accepted SDK) is
 * coming from the producer (docs/ui-next/status/PL1.md): it is one more member of this union and one more kind of `StateKind`, and nothing else changes.
 */
export type Cause = 'crashed' | 'reloaded' | 'failed' | 'timeout' | 'interface' | 'build';

export type State = {
  readonly kind: StateKind;
  /** The word of the chip. Empty for a plugin that is running: a healthy plugin has no state to say. */
  readonly word: string;
  readonly tone: Tone;
  /** Work is going on: the plugin is starting, stopping or being removed. */
  readonly busy: boolean;
  readonly cause: Cause | undefined;
  /** The status lane's headline, with the plugin's name. */
  readonly title: string;
  /** The status lane's sentence, in the host's words. For a failure it is the sentence the rail's tip says. */
  readonly sentence: string;
  /** Whether the state is a fault (the error glyph) and not a plugin on its way. */
  readonly faulted: boolean;
};
