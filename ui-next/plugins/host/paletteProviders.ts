import type { PaletteAnswer, PaletteCandidate, PaletteCommandOutcome, PaletteScope, PaletteSource } from '../../shell';
import { admitRows, oneLine, PALETTE_LIMITS, type AdmittedRow, type RowRules } from '../contract/paletteRows';
import type { PaletteCommandV1, PaletteJsonV1, PaletteProviderV1, PaletteScopeV1, PanelHostV1 } from '../contract/v1';
import { routeInputOf } from './panel';
import type { PluginEntry } from './pluginStore';

// What a plugin's palette becomes in the host (contract/v1.ts, `palette`; the model is ui-next/shell/core/palette). The plugin declares providers and commands as data and functions; the host makes of each provider a
// provider of the model, and reads every answer row by row (`contract/paletteRows.ts`) before the model sees one. The model is plugin-agnostic and so is this: nothing here names a plugin.
//
// What a plugin's code can do to the palette, and what the host does about it:
//   throws, rejects, answers what is not a list   the source did not answer, in the host's words ("Things did not answer."); the plugin's own words are the cause of the error the model logs, and reach no screen
//   never answers                                  the model's runner gives up after five seconds and says so; a late answer is dropped
//   answers after it was told to stop              the runner drops it, and the host does no work on it
//   answers a row that is not valid                the row is left out and the problem is reported once (`report`), whatever else the answer holds
//   answers more than it may                       a `match` answer is read to a thousand rows and a `search` answer to a hundred looked at and twenty kept; the palette says how many there were

type Ready = Extract<PluginEntry, { readonly phase: 'ready' }>;

/** What the host is told of a provider's rows that were left out: the provider's id (`<plugin>:<its own>`) and a sentence for the plugin's author. */
export type ProblemReport = (provider: string, message: string) => void;

export type ProviderOptions = {
  /** The glyph of the plugin's entry in the rail: how the palette draws the plugin's chip. */
  readonly icon: string | undefined;
  readonly report: ProblemReport;
};

/** The most distinct problems the host says for one provider: a provider that is wrong in new ways every keystroke is not said a thousand times. */
const MAX_SAID = 8;

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a provider is asked in, as the plugin reads it: a frozen copy of what the model holds, with the chips under the plugin's own and the filters a provider is asked in. */
function scopeOf(scope: PaletteScope): PaletteScopeV1 {
  return Object.freeze({
    plugin: scope.plugin,
    chips: Object.freeze(scope.chips.flatMap((chip) => (chip.kind === 'plugin' ? [] : [Object.freeze({ kind: chip.kind, id: chip.id, label: chip.label })]))),
    kind: scope.kind === 'goto' || scope.kind === 'commands' ? scope.kind : 'all',
  });
}

/**
 * The model's candidate for a row that was read. A row that carries a command is a command, under the id the host will find it again by (`<plugin>:<command>`, so no plugin names a command of another or of the host's); a
 * row that carries a route is a page when its provider answers from a small set it holds and a resource when it answers on demand. The plugin's name is among the words a page is found by, as the host's own pages are.
 */
function candidateOf(plugin: string, pluginName: string, mode: 'match' | 'search', row: AdmittedRow): PaletteCandidate {
  const base = { id: row.id, title: row.label, context: row.secondary, keywords: [pluginName, row.keywords].filter((word) => word !== '').join(' '), icon: row.icon, tone: 'neutral' } as const;
  if (row.command !== undefined) {
    return { ...base, kind: 'command', command: { id: `${plugin}:${row.command.id}`, ...(row.command.arg === undefined ? {} : { arg: row.command.arg }) } };
  }

  return { ...base, kind: mode === 'match' ? 'page' : 'resource', route: routeInputOf(plugin, row.route) };
}

/** The provider of the model for one the plugin declared. */
function providerOf(entry: Ready, local: string, declared: PaletteProviderV1, options: ProviderOptions): PaletteSource {
  const { id: plugin } = entry;
  const { contribution } = entry;
  const pluginName = contribution.plugin.name;
  const id = `${plugin}:${local}`;
  const title = declared.section.trim();
  const rules: RowRules = { pages: contribution.pages, commands: contribution.palette?.commands ?? {} };
  const said = new Set<string>();
  const tell = (problem: string): void => {
    if (said.size < MAX_SAID && !said.has(problem)) {
      said.add(problem);
      options.report(id, problem);
    }
  };

  // The model words the failure with the error's message when it has one: the host's sentence is that, and the plugin's own error is its cause, which the model logs with the error.
  const failed = (cause: unknown): Error => new Error(`${title} did not answer.`, { cause });
  const common = {
    id,
    plugin,
    pluginName,
    pluginIcon: options.icon,
    title,
    section: { id: local, title, kind: declared.filter ?? 'goto' },
    ...(declared.supports === undefined ? {} : { supports: (scope: PaletteScope): boolean => declared.supports?.(scopeOf(scope)) !== false }),
  };

  if (declared.kind === 'match') {
    return {
      ...common,
      match: (query, scope) => {
        let answer: unknown;
        try {
          answer = declared.match(query, scopeOf(scope));
        } catch (cause) {
          throw failed(cause);
        }

        if (!Array.isArray(answer)) {
          throw failed(new TypeError('A match provider must answer with a list of rows.'));
        }

        if (answer.length > PALETTE_LIMITS.matchRows) {
          tell(`returned ${String(answer.length)} rows: at most ${String(PALETTE_LIMITS.matchRows)} are read; a set that large is a search provider`);
        }

        const read = admitRows(answer, rules, { keep: PALETTE_LIMITS.matchRows, scan: PALETTE_LIMITS.matchRows });
        read.problems.forEach(tell);
        return read.rows.map((row) => candidateOf(plugin, pluginName, 'match', row));
      },
    };
  }

  return {
    ...common,
    search: async (query, scope, signal): Promise<PaletteAnswer> => {
      let answer: unknown;
      try {
        answer = await declared.search(query, scopeOf(scope), signal);
      } catch (cause) {
        throw failed(cause);
      }

      // The palette drops an answer that comes after it asked the provider to stop; the host does no work on it either.
      if (signal.aborted) {
        return { rows: [] };
      }

      const list: unknown = Array.isArray(answer) ? answer : isRecord(answer) ? answer.rows : undefined;
      if (!Array.isArray(list)) {
        throw failed(new TypeError('A search provider must answer with a list of rows, or an answer with `rows`.'));
      }

      const read = admitRows(list, rules, { keep: PALETTE_LIMITS.answerRows, scan: PALETTE_LIMITS.scanRows });
      read.problems.forEach(tell);
      const said = isRecord(answer) ? answer : {};
      const declaredTotal = typeof said.limited === 'number' && Number.isFinite(said.limited) ? Math.floor(said.limited) : 0;
      const limited = Math.max(declaredTotal, list.length > PALETTE_LIMITS.answerRows ? list.length : 0);
      const message = oneLine(said.message, PALETTE_LIMITS.message);
      return {
        rows: read.rows.map((row) => candidateOf(plugin, pluginName, 'search', row)),
        ...(limited > read.rows.length ? { limited } : {}),
        ...(said.partial === true ? { partial: true } : {}),
        ...(message === undefined || message === '' ? {} : { message }),
      };
    },
  };
}

/** The providers of the model that a plugin that is ready declares, in the order it declared them. None for a plugin with no palette, or none of its own to offer. */
export function providersOf(entry: Ready, options: ProviderOptions): readonly PaletteSource[] {
  const declared = entry.contribution.palette?.providers;
  return declared === undefined ? [] : Object.entries(declared).map(([local, provider]) => providerOf(entry, local, provider, options));
}

/** A command a plugin registers, found again where the palette runs it. */
export type FoundCommand = { readonly plugin: string; readonly local: string; readonly command: PaletteCommandV1 };

/**
 * The command a row's command id names, from the plugins as they are NOW: the id is the plugin's own, a colon, and the command's (`commandOf` never reads a plugin that is not ready, a command it no longer has, or a
 * member the prototype brings). The palette lists a row at one moment and runs it at another, and a plugin may have left between them: a command is looked up again immediately before it runs.
 */
export function commandOf(entries: readonly PluginEntry[], id: string): FoundCommand | undefined {
  for (const entry of entries) {
    const prefix = `${entry.id}:`;
    if (entry.phase !== 'ready' || !id.startsWith(prefix)) {
      continue;
    }

    const local = id.slice(prefix.length);
    const commands = entry.contribution.palette?.commands;
    const command = commands !== undefined && Object.hasOwn(commands, local) ? commands[local] : undefined;
    if (command !== undefined) {
      return { plugin: entry.id, local, command };
    }
  }

  return undefined;
}

const DID_NOT_RUN = 'This command did not run.';
const FAILED: PaletteCommandOutcome = { ok: false, reason: 'This command failed.' };

/** What a command answered, as the palette reads it: done, or refused with a reason (the plugin's own when it is a plain sentence of at most 160 characters, the host's when it is not). */
function outcomeOf(answer: unknown): PaletteCommandOutcome {
  if (answer === false) {
    return { ok: false, reason: DID_NOT_RUN };
  }

  if (isRecord(answer) && answer.ok === false) {
    const reason = oneLine(answer.reason, PALETTE_LIMITS.message);
    return { ok: false, reason: reason === undefined || reason === '' ? DID_NOT_RUN : reason };
  }

  return true;
}

/**
 * Runs a command with its argument and what it may use of the host. A throw, or a rejection, is the command's failure: the palette stays open and says so in the host's words, and `onError` is given the plugin's. The
 * answer is what the command said, read by `outcomeOf`, or a promise of it for a command that answers later.
 */
export function runCommand(found: FoundCommand, arg: PaletteJsonV1 | undefined, panel: PanelHostV1 | undefined, onError: (error: unknown) => void): PaletteCommandOutcome | Promise<PaletteCommandOutcome> {
  try {
    const answer: unknown = found.command.run(arg, { plugin: found.plugin, ...(panel === undefined ? {} : { panel }) });
    if (isThenable(answer)) {
      return Promise.resolve(answer).then(outcomeOf, (cause: unknown) => {
        onError(cause);
        return FAILED;
      });
    }

    return outcomeOf(answer);
  } catch (cause) {
    onError(cause);
    return FAILED;
  }
}
