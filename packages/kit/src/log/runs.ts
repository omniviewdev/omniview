// What a row draws for its text: the line's painted runs (the colour an ANSI escape gave it, parsed once at ingest) cut at the edges of the search matches.
// A row asks for this only when it HAS a match; every other row renders its plain string or its painted runs as they are (HLT-3, HLT-12).
import { EMPTY_MATCHES_PER_CLOCK_READ, indexAfterEmptyMatch, SEARCH_TIME_BUDGET_MS } from './regexSafety';
import type { PaintedRun } from './types';

/** A run of a row's text: its paint, and whether a search match covers it, and which kind (the line of the current match is marked apart). */
export type RowRun = PaintedRun & { readonly mark?: 'found' | 'current' };

/** The most matches of one line that are marked: the mock stops at 20. */
export const MAX_MARKS_PER_LINE = 20;

type Range = readonly [number, number];

/**
 * Where `pattern` (global) matches in `text`: `[from, to)` pairs in order, at most `limit`. A zero-length match is passed over and never returned, as the search engine passes it
 * (`execSafeSearchRange`): a row marks the matches the search found, and a pattern such as `\b|foo` has an empty match before the one that consumes text. A row is drawn in a render, and
 * a line of millions of positions under a pattern that matches the empty string at every one (`(?=a)|foo`) would hold it for as long as the line is long, so the scan reads the clock
 * every `EMPTY_MATCHES_PER_CLOCK_READ` empty matches, as the search does, and ends past the search's own budget with the rest of the line unmarked. The search that found the line
 * scanned it under that clock, so a line it found is marked, however many positions come before its match.
 */
export function matchRanges(text: string, pattern: RegExp, limit: number = MAX_MARKS_PER_LINE): Range[] {
  const ranges: Range[] = [];
  pattern.lastIndex = 0;
  const started = performance.now();
  let empties = 0;
  while (ranges.length < limit) {
    const match = pattern.exec(text);
    if (match === null) {
      break;
    }

    if (match[0].length === 0) {
      pattern.lastIndex = indexAfterEmptyMatch(pattern, text, match.index);
      empties += 1;
      if (empties % EMPTY_MATCHES_PER_CLOCK_READ === 0 && performance.now() - started > SEARCH_TIME_BUDGET_MS) {
        break;
      }
    } else {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  pattern.lastIndex = 0;
  return ranges;
}

/**
 * The runs of a row: the painted runs (or the whole text as one) cut where a match starts and ends, the matched pieces marked with `mark`. With no match
 * it is the painted runs themselves. The runs always add up to `text`. `ranges` are ascending and do not overlap.
 */
export function rowRuns(text: string, painted: readonly PaintedRun[] | undefined, ranges: readonly Range[], mark: 'found' | 'current'): readonly RowRun[] {
  if (ranges.length === 0) {
    return painted ?? [{ text }];
  }

  const out: RowRun[] = [];
  let offset = 0;
  let next = 0;
  for (const run of painted ?? [{ text }]) {
    const end = offset + run.text.length;
    let at = offset;
    while (at < end) {
      while ((ranges[next]?.[1] ?? Number.POSITIVE_INFINITY) <= at) {
        next += 1;
      }

      const range = ranges[next];
      // The text up to the next match (or the end of the run), then the match.
      const plainTo = range === undefined || range[0] >= end ? end : Math.max(at, range[0]);
      if (plainTo > at) {
        out.push(piece(run, run.text.slice(at - offset, plainTo - offset), undefined));
        at = plainTo;
      }

      if (range !== undefined && range[0] < end && at >= range[0]) {
        const stop = Math.min(range[1], end);
        out.push(piece(run, run.text.slice(at - offset, stop - offset), mark));
        at = stop;
      }
    }

    offset = end;
  }

  return out;
}

/** A piece of `run`'s text with the run's paint, and a mark when it is a match. */
function piece(run: PaintedRun, text: string, mark: 'found' | 'current' | undefined): RowRun {
  return {
    text,
    ...(run.hue === undefined ? {} : { hue: run.hue }),
    ...(run.bold === true ? { bold: true } : {}),
    ...(mark === undefined ? {} : { mark }),
  };
}
