/**
 * Regex safety utilities for search-as-you-type over large text buffers.
 *
 * Centralizes all guards against pathological regex behavior:
 *  - Empty-match patterns (e.g. "foo|", ".*", "a?")
 *  - Catastrophic backtracking / ReDoS
 *  - Unbounded result sets
 *
 * Usage:
 *   const pattern = compileSearchPattern(query, { isRegex, caseSensitive });
 *   if (!pattern) return []; // invalid or unsafe
 *   const { results, capped } = execSafeSearch(pattern, count, getLine, buildMatch);
 */

/** Stop collecting after this many matches. */
export const MAX_MATCH_COUNT = 10_000;

/** Abort the search loop after this many milliseconds. */
export const SEARCH_TIME_BUDGET_MS = 100;

// ---------------------------------------------------------------------------
// Pattern compilation + validation
// ---------------------------------------------------------------------------

interface CompileOpts {
  isRegex: boolean;
  caseSensitive: boolean;
}

/**
 * Compile a user-supplied search string into a safe global RegExp.
 * Returns null if the string is empty, syntactically invalid, or would
 * produce degenerate results (e.g. matches the empty string).
 */
export function compileSearchPattern(
  query: string,
  { isRegex, caseSensitive }: CompileOpts,
): RegExp | null {
  if (!query) return null;

  const flags = caseSensitive ? 'g' : 'gi';
  let pattern: RegExp;
  try {
    pattern = isRegex
      ? new RegExp(query, flags)
      : new RegExp(escapeRegex(query), flags);
  } catch {
    // Syntax error while user is still typing (e.g. unclosed "[" or "(")
    return null;
  }

  // Patterns that match the empty string (e.g. "foo|", ".*", "a?") would
  // produce a match at every character position — useless results and an
  // infinite exec() loop if the zero-length guard somehow fails.
  if (pattern.test('')) return null;

  return pattern;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Safe search execution
// ---------------------------------------------------------------------------

export interface SafeSearchResult<T> {
  results: T[];
  /** True when search stopped early (match cap or time budget exceeded). */
  capped: boolean;
}

/**
 * Run a global regex across lines `[startIndex, endIndex)` with built-in safety limits.
 *
 * Stops early when:
 *  - `matchBudget` matches have been collected (defaults to `MAX_MATCH_COUNT`)
 *  - `SEARCH_TIME_BUDGET_MS` has elapsed (checked every 512 lines)
 *  - A zero-length match is encountered (prevents infinite exec() loop)
 *
 * @param pattern      A global RegExp (must have the `g` flag).
 * @param startIndex   First line index to search (inclusive).
 * @param endIndex     Last line index to search (exclusive).
 * @param getLine      Accessor for line content by index.
 * @param onMatch      Factory called for each match to build the result item.
 * @param matchBudget  Max matches to collect (defaults to `MAX_MATCH_COUNT`).
 */
export function execSafeSearchRange<T>(
  pattern: RegExp,
  startIndex: number,
  endIndex: number,
  getLine: (index: number) => string,
  onMatch: (lineIndex: number, start: number, end: number) => T,
  matchBudget: number = MAX_MATCH_COUNT,
): SafeSearchResult<T> {
  const results: T[] = [];
  const t0 = performance.now();
  let linesSearched = 0;

  for (let i = startIndex; i < endIndex; i++) {
    const line = getLine(i);
    pattern.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      // Zero-length match → break to prevent infinite loop
      if (m[0].length === 0) break;

      results.push(onMatch(i, m.index, m.index + m[0].length));

      if (results.length >= matchBudget) {
        return { results, capped: true };
      }
    }

    linesSearched++;
    // Amortize performance.now() overhead — check every 512 lines
    if ((linesSearched & 511) === 0 && linesSearched > 0 && performance.now() - t0 > SEARCH_TIME_BUDGET_MS) {
      return { results, capped: true };
    }
  }

  return { results, capped: false };
}

/**
 * Run a global regex across `count` lines with built-in safety limits.
 *
 * Convenience wrapper around `execSafeSearchRange` that searches `[0, count)`.
 *
 * @param pattern   A global RegExp (must have the `g` flag).
 * @param count     Number of lines to search.
 * @param getLine   Accessor for line content by index.
 * @param onMatch   Factory called for each match to build the result item.
 */
export function execSafeSearch<T>(
  pattern: RegExp,
  count: number,
  getLine: (index: number) => string,
  onMatch: (lineIndex: number, start: number, end: number) => T,
): SafeSearchResult<T> {
  return execSafeSearchRange(pattern, 0, count, getLine, onMatch);
}
