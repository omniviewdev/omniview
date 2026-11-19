// The sentences of the log view that are decisions, not layout. The mock's words (shell-panel.js `countText`, `syncEmpty`, `failureText`) in plain
// functions of state, so a test pins each.
import type { SearchSnapshot } from './logViewModel';
import type { LogFeedCause, LogFeedState } from './types';

const NUMBER = new Intl.NumberFormat('en-US');

export type CountInput = Pick<SearchSnapshot, 'options' | 'status' | 'count' | 'position' | 'capped'>;

/**
 * The text of the find count, the lane inside the field (design 16 FBR1: a lane of fixed width, so a count that appears, changes or goes moves no
 * control): which match of how many, "No results", "Search stopped", "Invalid pattern", or nothing. "No results" says the whole log was searched; a search
 * a bound stopped before it found a line has not searched the whole log, and says it stopped (the mock has no such state: its search ends at "5,000+"
 * with matches, and this one can also be stopped by its clock on a slow pattern).
 */
export function countText({ options, status, count, position, capped }: CountInput): string {
  if (status === 'invalid') {
    return 'Invalid pattern';
  }

  if (options.query === '' || (status === 'scanning' && count === 0)) {
    return '';
  }

  if (count === 0) {
    return capped ? 'Search stopped' : 'No results';
  }

  return `${NUMBER.format(position)} of ${NUMBER.format(count)}${capped ? '+' : ''}`;
}

export type EmptyInput = {
  readonly state: LogFeedState;
  /** The level filter is on. */
  readonly filtered: boolean;
  /** Lines the view holds, whatever the filter shows. */
  readonly buffered: number;
};

/** What the list says when it has no row, and whether it offers the way back from a filter that hides every line. */
export function emptyText({ state, filtered, buffered }: EmptyInput): { readonly text: string; readonly clear: boolean } {
  if (filtered && buffered > 0) {
    return { text: 'No lines match the filters.', clear: true };
  }

  if (state === 'starting') {
    return { text: 'Connecting…', clear: false };
  }

  return { text: state === 'streaming' || state === 'paused' ? 'Waiting for lines…' : 'There are no lines.', clear: false };
}

/**
 * How a failed stream is told: what failed, then the cause as the source said it (design 16 S116, X3: the cause in the user's terms, one or two
 * sentences). `established` is whether the stream had started: a stream that ran and stopped is not one that never started. The caller says it from the cause's stage (a creation that
 * failed never started) or from the lines it holds.
 */
export function failureWords(cause: LogFeedCause, established: boolean): { readonly title: string; readonly message: string } {
  const said = cause.message.trim();
  return {
    title: established ? 'The log stream stopped' : 'Couldn\'t start the log stream',
    message: said === '' ? 'The source gave no reason.' : /[.!?]$/.test(said) ? said : `${said}.`,
  };
}
