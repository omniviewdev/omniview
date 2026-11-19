// Provenance: carried as an engine from the host's old log viewer, `ui/providers/BottomDrawer/containers/LogViewer/utils/regexSafety.ts` at origin/main
// ce60076a (last changed by c4bd5776). Register: HLT-11 (docs/ui-next/optimisations.md). Changed in three places (PR #544 review). Unchanged: the bounds of 10,000
// matches and of a 100 ms budget checked every 512 lines, and the guard that compiles an empty, malformed or empty-matching pattern to null; all hold for every
// search path of the viewer, the chunked one in lineSearch.ts included.
//   1. `execSafeSearchRange` no longer ENDS a line at its first zero-length match: it skips the match and goes on ("Continue scanning after an empty regex match").
//      A pattern such as `\b|foo` is accepted by the compiler, since it does not match the empty STRING, and on `xfoo` its first match is the empty word boundary at
//      0, before the `foo` that consumes text at 1; the old loop stopped there and the search found nothing. The highlight scan of runs.ts skips the same way, so a row
//      marks what the search found. Every pass moves at least one position (`indexAfterEmptyMatch`), so the loop still ends on every pattern. The clock is also read INSIDE
//      a line, every `EMPTY_MATCHES_PER_CLOCK_READ` empty matches it passes: between lines is not enough for one line of millions of positions that all match the empty string.
//   2. `compileSearchPattern` refuses a regular expression of the dominant exponential shape before it compiles it ("Reject unsafe regex patterns before synchronous
//      execution"): `(a*)*b` against a line of `a` characters backtracks for longer than anyone waits, inside one `pattern.exec()` that the time check, which runs
//      between lines, cannot interrupt. `isRiskyPattern` is a static check on that shape and on the size of the pattern, not a proof of safety. It does NOT cover
//      alternation with overlapping branches under a repeat, such as `(a|aa)+b` (exponential), nor adjacent overlapping repeats, such as `.*.*.*x` (polynomial).
//      Those are left to the time check of `execSafeSearchRange` and the slices of lineSearch.ts, which bound a search between lines and stop no single `exec`.
//   3. `execSafeSearchRange` takes where the first line begins (`startOffset`) and says where the MATCH budget stopped it (`stoppedAt`: the line, the offset after the last match,
//      whether the line has text left), so a scan that the cap stopped inside a line goes on inside that line when eviction gives the cap room back (lineSearch.ts), and finds
//      the matches a fresh scan would count.
/**
 * Regex safety utilities for search-as-you-type over large text buffers.
 *
 * Centralizes all guards against pathological regex behavior:
 *  - Empty-match patterns (e.g. "foo|", ".*", "a?")
 *  - Catastrophic backtracking / ReDoS: the dominant exponential shape and the size of a regular expression query, before it compiles (see `isRiskyPattern`)
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

/**
 * The longest regular expression a query may be. A search field holds a few dozen characters and a long alternation of words a few hundred; 512 is above both,
 * and it keeps the guard's own pass (and the compile) short: a pasted megabyte is refused by its length, unread. A literal query has no such limit: it is text.
 */
export const MAX_PATTERN_LENGTH = 512;

/**
 * The deepest nesting of groups a regular expression query may have. A query a person writes nests three or four; 16 is generous, and it is the size of the
 * guard's stack, which therefore cannot grow past it however the pattern is written.
 */
export const MAX_GROUP_DEPTH = 16;

// ---------------------------------------------------------------------------
// Pattern compilation + validation
// ---------------------------------------------------------------------------

type CompileOpts = {
  isRegex: boolean;
  caseSensitive: boolean;
};

/**
 * Compile a user-supplied search string into a safe global RegExp.
 * Returns null if the string is empty, syntactically invalid, or would
 * produce degenerate results (e.g. matches the empty string). A regular
 * expression is also refused when it is too long, nests groups too deep or
 * has the shape that backtracks without bound (`isRiskyPattern`); a literal
 * query is escaped, is text, and is never judged.
 */
export function compileSearchPattern(
  query: string,
  { isRegex, caseSensitive }: CompileOpts,
): RegExp | null {
  if (!query) {
    return null;
  }

  // The dominant exponential shape is refused before the pattern is compiled, so that no `exec` of it ever starts (see `isRiskyPattern`).
  if (isRegex && isRiskyPattern(query)) {
    return null;
  }

  const flags = caseSensitive ? 'g' : 'gi';
  let pattern: RegExp;
  try {
    pattern = isRegex
      ? new RegExp(query, flags)
      : new RegExp(escapeRegex(query), flags);
    // Patterns that match the empty string (e.g. "foo|", ".*", "a?") would
    // produce a match at every character position — useless results and an
    // infinite exec() loop if the zero-length guard somehow fails. The test is
    // inside the `try` because it is what compiles a pattern for the first time
    // in V8, and a literal of about 50,000 characters is "too large" there.
    if (pattern.test('')) {
      return null;
    }
  } catch {
    // Syntax error while user is still typing (e.g. unclosed "[" or "(")
    return null;
  }

  return pattern;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The characters `isRiskyPattern` reads, by code: the guard is a loop over character codes, with no regular expression over the source.
const BACKSLASH = 0x5c;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const STAR = 0x2a;
const PLUS = 0x2b;
const QUESTION = 0x3f;
const COMMA = 0x2c;

/** The index of the first character at or after `from` that is not an ASCII digit. */
function skipDigits(source: string, from: number): number {
  let at = from;
  while (source.charCodeAt(at) >= 0x30 && source.charCodeAt(at) <= 0x39) {
    at += 1;
  }

  return at;
}

/**
 * The index after the class that opens just before `from`. It runs to the first `]` that is not escaped, even one right after the `[` or the `[^`: that is how
 * the engine reads a class without the `v` flag (`[]` is empty and `[^]` is anything), and a guard that read it otherwise would skip a group the engine runs.
 */
function classEnd(source: string, from: number): number {
  let at = from;
  while (at < source.length) {
    const code = source.charCodeAt(at);
    if (code === CLOSE_BRACKET) {
      return at + 1;
    }

    at += code === BACKSLASH ? 2 : 1;
  }

  return at;
}

/**
 * Whether a regular expression query has a shape the engine can backtrack on for longer than anyone waits. True when it
 *  - is longer than `MAX_PATTERN_LENGTH`, or nests groups deeper than `MAX_GROUP_DEPTH`; or
 *  - repeats a group more than once (`*`, `+`, `{n,}`, and `{n}` or `{n,m}` with a count above one) whose body holds an unbounded repeat (`*`, `+`, `{n,}`) at any
 *    depth: `(a*)*b`, `(a+)+`, `(\w+\s?)+`, `(.*)*`, `(?:a+){2,}`. Against a line the pattern cannot match, the engine tries every way of dividing a run of `a`
 *    characters between the inner repeat and the outer one, and the ways double with each character: one `exec` that nothing can interrupt.
 *
 * It is one pass over the source with no regular expression over it and no recursion: a loop, and a stack of `MAX_GROUP_DEPTH` flags. It reads the source as the engine
 * reads it without the `u` flag (the flags of a query are `g` and `gi`): a backslash takes the next character; a class runs to the first `]` that is not escaped; every
 * `(` opens a group whatever follows it (`(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>`); a `?` after a repeat is its lazy mark; a `{` that does not make `{n}`,
 * `{n,}` or `{n,m}` is the character itself. A literal query is escaped before it compiles and is never given to it.
 *
 * It is a static check on the dominant exponential shape and it errs towards refusing: `(\w+\.)+` is refused, though each repeat of it ends at a dot. It is NOT a proof
 * of safety. It does not cover alternation with overlapping branches under a repeat, `(a|aa)+b` (exponential), nor adjacent overlapping repeats, `.*.*.*x` (polynomial,
 * and slow on a long line). The time check of `execSafeSearchRange` is the second line for those, and it runs between lines: it cannot interrupt one `exec`.
 */
export function isRiskyPattern(source: string): boolean {
  if (source.length > MAX_PATTERN_LENGTH) {
    return true;
  }

  // Slot d: whether the group open at depth d holds an unbounded repeat so far, at any depth inside it. Slot 0 is the pattern itself.
  const holdsUnbounded = new Uint8Array(MAX_GROUP_DEPTH + 1);
  let depth = 0;
  // Whether the token before this one was the `)` of a group that holds an unbounded repeat: a repeat that comes next repeats that group.
  let afterHolder = false;
  let at = 0;
  while (at < source.length) {
    const code = source.charCodeAt(at);
    let next = at + 1;
    let closedHolder = false;
    // What this token is, when it is a repeat: whether it has no upper bound, and whether it can repeat more than once.
    let repeat = false;
    let unbounded = false;
    let many = false;

    if (code === BACKSLASH) {
      next = at + 2;
    } else if (code === OPEN_BRACKET) {
      next = classEnd(source, at + 1);
    } else if (code === OPEN_PAREN) {
      if (depth === MAX_GROUP_DEPTH) {
        return true;
      }

      depth += 1;
      holdsUnbounded[depth] = 0;
    } else if (code === CLOSE_PAREN) {
      // A `)` with no group open is a syntax error the compile reports; here it is nothing.
      if (depth > 0) {
        closedHolder = holdsUnbounded[depth] === 1;
        depth -= 1;
        // What a group holds, its parent holds too.
        if (closedHolder) {
          holdsUnbounded[depth] = 1;
        }
      }
    } else if (code === STAR || code === PLUS) {
      repeat = true;
      unbounded = true;
      many = true;
    } else if (code === QUESTION) {
      repeat = true;
    } else if (code === OPEN_BRACE) {
      const minEnd = skipDigits(source, at + 1);
      if (minEnd > at + 1) {
        let end = minEnd;
        let max = Number(source.slice(at + 1, minEnd));
        let open = false;
        if (source.charCodeAt(end) === COMMA) {
          const maxEnd = skipDigits(source, end + 1);
          open = maxEnd === end + 1;
          if (!open) {
            max = Number(source.slice(end + 1, maxEnd));
          }

          end = maxEnd;
        }

        if (source.charCodeAt(end) === CLOSE_BRACE) {
          repeat = true;
          unbounded = open;
          many = open || max > 1;
          next = end + 1;
        }
      }
    }

    if (repeat) {
      if (afterHolder && many) {
        return true;
      }

      if (unbounded) {
        holdsUnbounded[depth] = 1;
      }

      if (source.charCodeAt(next) === QUESTION) {
        next += 1;
      }
    }

    afterHolder = closedHolder;
    at = next;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Safe search execution
// ---------------------------------------------------------------------------

export type SafeSearchResult<T> = {
  results: T[];
  /** True when search stopped early (match cap or time budget exceeded). */
  capped: boolean;
  /**
   * Set only when the MATCH budget stopped the scan: the index of the line of the last match taken, the offset in its text after that match (where a scan of the rest of the
   * line begins: `startOffset`), and whether the line has no text left after it. Absent when the scan ran to its end or the time budget stopped it.
   */
  stoppedAt?: { readonly lineIndex: number; readonly offset: number; readonly atEnd: boolean };
};

/**
 * Empty matches a scan passes on one line between two readings of the clock. The clock is read between lines (every 512), so a line of millions of characters under a pattern
 * that matches the empty string at each one (`(?=a)|foo`) would be passed one position at a time for as long as it is long, past the time budget.
 */
export const EMPTY_MATCHES_PER_CLOCK_READ = 4096;

/**
 * Where a scan of `text` goes on after the empty match at `index`: one position on. `lastIndex` stays at the end of an empty match, so a loop that did not move it
 * would find the same empty match for ever; moved on, the next `exec` looks for a match that consumes text after it, and every pass advances, so the loop ends on
 * every pattern. A position is one UTF-16 unit, or one code point under the `u` and `v` flags: there the engine reads a surrogate pair as one character, and a
 * `lastIndex` between its halves as the start of the pair, so one unit would find the same empty match again. The engine builds its patterns with the flags `g` and
 * `gi` only, so one unit is all it ever takes; the code point is for a pattern that comes with `u`, because the scan must end on every pattern it is given.
 */
export function indexAfterEmptyMatch(pattern: RegExp, text: string, index: number): number {
  const unicode = pattern.unicode || pattern.flags.includes('v');
  return index + (unicode && (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

/**
 * Run a global regex across lines `[startIndex, endIndex)` with built-in safety limits.
 *
 * Stops early when:
 *  - `matchBudget` matches have been collected (defaults to `MAX_MATCH_COUNT`)
 *  - `SEARCH_TIME_BUDGET_MS` has elapsed (checked every 512 lines, and every `EMPTY_MATCHES_PER_CLOCK_READ` empty matches of the scan, whatever line they are on)
 *
 * A zero-length match is never a result. The scan passes it (`indexAfterEmptyMatch`) and goes on to the next match on the line, so a pattern such as `\b|foo`
 * finds the `foo` that follows its empty word boundaries, and the loop ends on every pattern. Each pass moves at least one position, so the work for a line
 * is bounded by its length, and the clock is read between lines and between runs of empty matches.
 *
 * @param pattern      A global RegExp (must have the `g` flag).
 * @param startIndex   First line index to search (inclusive).
 * @param endIndex     Last line index to search (exclusive).
 * @param getLine      Accessor for line content by index.
 * @param onMatch      Factory called for each match to build the result item.
 * @param matchBudget  Max matches to collect (defaults to `MAX_MATCH_COUNT`).
 * @param startOffset  Where in the text of the first line the scan begins (default 0): the rest of a line that a match budget stopped inside (`stoppedAt`).
 */
export function execSafeSearchRange<T>(
  pattern: RegExp,
  startIndex: number,
  endIndex: number,
  getLine: (index: number) => string,
  onMatch: (lineIndex: number, start: number, end: number) => T,
  matchBudget: number = MAX_MATCH_COUNT,
  startOffset = 0,
): SafeSearchResult<T> {
  const results: T[] = [];
  const t0 = performance.now();
  let linesSearched = 0;
  // Empty matches passed since the scan began, across lines: two lines of half a reading's worth each are a reading's worth, and the clock is read where they add up to it.
  let empties = 0;

  for (let i = startIndex; i < endIndex; i++) {
    const line = getLine(i);
    pattern.lastIndex = i === startIndex ? startOffset : 0;

    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex = indexAfterEmptyMatch(pattern, line, m.index);
        empties += 1;
        if (empties % EMPTY_MATCHES_PER_CLOCK_READ === 0 && performance.now() - t0 > SEARCH_TIME_BUDGET_MS) {
          return { results, capped: true };
        }

        continue;
      }

      results.push(onMatch(i, m.index, m.index + m[0].length));

      if (results.length >= matchBudget) {
        return { results, capped: true, stoppedAt: { lineIndex: i, offset: pattern.lastIndex, atEnd: pattern.lastIndex >= line.length } };
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
