import type { Answer } from './runner';
import { LIMITS, type Hint, type Provider, type Row, type Run, type Source } from './types';

// What the palette says about its sources and its keys (ch16 S70, S72, S86): the runs of the status band, the Sources list, the footer's keys of the active row and the sentence of the
// results. Only something notable is a run: no "Ready", no collapsed details.

/** What a synchronous provider's last call came to; made while a section is composed. */
export type SyncReport = { error: string; invalid: number; limited: number };

/** A provider as the palette knows it: the words that name it, in a run and in the Sources list. */
export type Named = { readonly provider: Provider; readonly pluginName: string; readonly title: string };

export const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`;

const nameOf = (named: Named): string => `${named.pluginName} · ${named.title}`;

/** The sources that did not answer: a provider that failed or timed out. */
export function failedCount(answers: readonly Answer[], reports: ReadonlyMap<string, SyncReport>): number {
  return answers.filter((answer) => answer.state === 'error' || answer.state === 'timeout').length + [...reports.values()].filter((report) => report.error !== '').length;
}

/** "12 results", "No results. 1 source didn't answer": what a live region says about the list. */
export function sentenceOf(total: number, failed: number): string {
  return [total > 0 ? plural(total, 'result') : 'No results', failed > 0 ? `${plural(failed, 'source')} didn't answer` : ''].filter((part) => part !== '').join('. ');
}

/** The sources, for the Sources list and the diagnostics: every asynchronous one asked, and the synchronous ones that failed, were cut or gave something unusable. */
export function sourcesOf(named: ReadonlyMap<string, Named>, answers: readonly Answer[], reports: ReadonlyMap<string, SyncReport>): Source[] {
  const out: Source[] = [];
  for (const [id, report] of reports) {
    const who = named.get(id);
    if (who !== undefined && (report.error !== '' || report.invalid > 0 || report.limited > 0)) {
      out.push({ id, plugin: who.provider.plugin, pluginName: who.pluginName, title: who.title, mode: 'match', state: report.error === '' ? (report.limited > 0 ? 'limited' : 'ready') : 'error', rows: 0, limited: report.limited, attempts: 0, message: report.error, ms: 0, live: true, invalid: report.invalid });
    }
  }

  for (const answer of answers) {
    const { source } = answer;
    out.push({
      id: answer.id,
      plugin: source.provider.plugin,
      pluginName: source.pluginName,
      title: source.title,
      mode: 'search',
      state: answer.state,
      rows: answer.rows.length,
      limited: answer.limited,
      attempts: answer.attempts,
      message: answer.message,
      ms: answer.ms,
      live: answer.live,
      invalid: answer.invalid,
    });
  }

  return out;
}

const SETTLED = ['ready', 'partial', 'limited'];

/** The runs of the status band, in the order their sources answered, so a new run joins at the end and none moves under the pointer (S72). */
export function runsOf(named: ReadonlyMap<string, Named>, answers: readonly Answer[], reports: ReadonlyMap<string, SyncReport>, overflow: number): Run[] {
  const runs: Run[] = [];
  for (const [id, report] of reports) {
    const who = named.get(id);
    if (who === undefined) {
      continue;
    }

    if (report.error !== '') {
      runs.push({ id, name: nameOf(who), label: `${who.title}: Unavailable`, tone: 'error', retry: true, message: report.error });
    } else if (report.limited > 0) {
      runs.push({ id, name: nameOf(who), label: `${who.title}: first ${String(LIMITS.candidates)} of ${String(report.limited)}`, tone: 'info', retry: false, message: '' });
    }
  }

  const answered = [...answers].sort((a, b) => (a.doneAt === 0 ? Number.POSITIVE_INFINITY : a.doneAt) - (b.doneAt === 0 ? Number.POSITIVE_INFINITY : b.doneAt));
  for (const answer of answered) {
    const { source } = answer;
    const name = `${source.pluginName} · ${source.title}`;
    if (answer.state === 'error' || answer.state === 'timeout') {
      runs.push({ id: answer.id, name, label: `${source.title}: ${answer.word === '' ? 'Unavailable' : answer.word}`, tone: 'error', retry: true, message: answer.message });
    } else if (answer.state === 'partial') {
      runs.push({ id: answer.id, name, label: `${source.title}: Partial results`, tone: 'warning', retry: true, message: answer.message });
    } else if (answer.state === 'limited') {
      runs.push({ id: answer.id, name, label: `${source.title}: first ${String(answer.rows.length)} of ${String(answer.limited)}`, tone: 'info', retry: false, message: '' });
    }
  }

  const still = answers.filter((answer) => !answer.live && SETTLED.includes(answer.state));
  if (still.length > 0) {
    runs.push({ id: '@live', name: 'live updates', label: 'Live updates unavailable', tone: 'warning', retry: true, message: `${still.map((answer) => `${answer.source.pluginName} · ${answer.source.title}`).join(', ')}: the results don't refresh until live updates resume` });
  }

  if (overflow > 0) {
    runs.push({ id: 'limit', name: 'Source limit', label: `Source limit: ${String(overflow)} not searched`, tone: 'warning', retry: false, message: `At most ${String(LIMITS.providers)} sources are searched; ${plural(overflow, 'source')} were left out` });
  }

  return runs;
}

const OPEN_KEYS: readonly Hint[] = [
  { keys: 'Enter', label: 'Open' },
  { keys: 'Alt+Enter', label: 'Here' },
  { keys: 'Mod+Shift+Enter', label: 'New tab' },
  { keys: 'Mod+Enter', label: 'Background tab' },
];

/** The key that opens a window of its own: said only to a host that can open one (the footer never says a key that does nothing). */
const WINDOW_KEY: Hint = { keys: 'Shift+Enter', label: 'New window' };

/**
 * The real keys of the active row, one muted line (A5, S70): the open keys for anything that opens a page (four, and a fifth, New window, when the host can open a window), one key for a command,
 * none for a row that cannot be used (an unavailable row shows its reason instead). The chords are platform-neutral (`Mod` is Command or Control); the view draws them with the platform's own glyphs.
 */
export function hintsOf(row: Row | undefined, view: 'results' | 'sources', windows: boolean): Hint[] {
  if (view === 'sources') {
    return [...(row?.action.type === 'retry' ? [{ keys: 'Enter', label: 'Retry' }] : []), { keys: 'Escape', label: 'Back to results' }];
  }

  if (row === undefined || row.inert || row.availability.state === 'unavailable') {
    return [];
  }

  const search = row.into === undefined ? [] : [{ keys: 'ArrowRight', label: 'Search inside' }];
  const fixed: Partial<Record<Row['kind'], string>> = { command: 'Run', tool: 'Show', more: 'Show all', everywhere: 'Search everywhere' };
  const label = fixed[row.kind];
  if (label !== undefined) {
    return [{ keys: 'Enter', label }];
  }

  if (row.kind === 'source') {
    return row.action.type === 'retry' ? [{ keys: 'Enter', label: 'Retry' }] : [];
  }

  if (row.kind === 'tab') {
    // A tab with no place of its own can only be switched to: the other keys open a place.
    return [{ keys: 'Enter', label: 'Switch to tab' }, ...(row.action.type === 'activate' && row.action.destination !== undefined ? [...OPEN_KEYS.slice(1), ...(windows ? [WINDOW_KEY] : [])] : []), ...search];
  }

  return [...OPEN_KEYS, ...(windows ? [WINDOW_KEY] : []), ...search];
}
