// Search over the lines the viewer shows: chunked, time-boxed, incremental, and bounded (HLT-10, HLT-11, HLT-12; MNR-L4).
//
// Provenance: the technique of `ui/providers/BottomDrawer/containers/LogViewer/hooks/useLogSearch.ts` (a full pass only for a new query, a new view; otherwise
// only the lines that came; a capped result is kept unscanned) and the carried guard of regexSafety.ts (HLT-11), which does the scanning of one chunk. What
// changed, and why:
//   - The old hook searched DURING RENDER, up to its 100 ms budget at once: a keystroke over 100,000 lines could hold a frame for 100 ms. Here a scan is
//     slices of 512-line chunks, each slice ends when its own budget (a few ms) is spent, and the caller runs one slice a frame: the search never holds one.
//   - A match is named by the ordinal of its line (never reused), not by the line's index in the array: an eviction does not move it, so trimming the head
//     costs the matches that were there and no rescan (the old hook searched everything again on every eviction, `evictionCount`).
//   - Only the lines with a match are kept (at most the 10,000-match cap's worth), not a record per match: a row finds its own match ranges from the pattern
//     when it renders (runs.ts), for the few rows in the window, so a keystroke builds no 10,000-entry map (HLT-12: one index per change, one lookup per row).
//   - The cap on matches bounds what is HELD, not the life of the stream. The old hook kept a capped result unscanned for as long as it lived; here a stream
//     that evicts takes the matches that filled the cap away with its head, and a search that stayed stopped would show nothing for good and never find a
//     later line. So when eviction takes the held matches under the cap the scan resumes from the line after the last one it read, never from the start: no
//     line is read twice (MNR-L4). Each kept line carries the matches counted in it, not only that it has one, so the budget stays exact when the head goes.
//     The carried engine's time guard is the other stop: a slow pattern, not a full result, which resuming would meet again. That stop stays until the
//     query or the view changes.
import type { LineView } from './lineView';
import { compileSearchPattern, execSafeSearchRange, MAX_MATCH_COUNT } from './regexSafety';

/** Lines a slice scans between two readings of the clock: the interval the carried engine reads it at (every 512 lines). */
export const SEARCH_CHUNK_LINES = 512;

export type SearchOptions = {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
};

/**
 * `idle`: no query. `invalid`: a pattern the search cannot run (a syntax error, one that matches the empty string, one the guard of regexSafety.ts refuses: too long, nested too deep or a repeated group that holds an unbounded repeat, or a query too large for the engine to compile). `scanning`: the pass over the lines
 * that were not scanned yet is not done. `done`: it is, and new lines are scanned as they come. `capped`: a bound was reached. Either the cap on the matches
 * held: the result is kept, and the scan resumes after the last line it read when eviction takes matches away (`trim`). Or the carried engine's time guard on
 * one chunk, a pattern that is slow: the result is kept as it is and nothing is scanned after.
 */
export type SearchStatus = 'idle' | 'invalid' | 'scanning' | 'done' | 'capped';

export class LineSearch {
  private options: SearchOptions = { query: '', regex: false, caseSensitive: false };
  private compiled: RegExp | null = null;
  private state: SearchStatus = 'idle';
  private revision = 0;
  /** The ordinals of the lines with a match, ascending. */
  private found: number[] = [];
  /** The matches counted for each line of `found`, in step with it. */
  private counts: number[] = [];
  private matches = 0;
  /** Every line of the view with an ordinal below this has been scanned. */
  private scanned = 0;
  /** What stopped the scan while the status is `capped`: the cap on matches held, which eviction lifts, or the engine's time guard, which nothing lifts. */
  private cappedBy: 'matches' | 'time' | undefined;
  /**
   * Where the cap on matches stopped INSIDE a line that has text left after its last match: that line's ordinal and the offset in its text where the scan of the rest of it begins.
   * `scanned` is then that line's ordinal, not the one after it. Undefined when the cap fell at the end of a line, and for every other stop.
   */
  private resume: { readonly n: number; readonly offset: number } | undefined;

  private readonly lines: LineView;
  private readonly now: () => number;

  constructor(view: LineView, now: () => number = () => performance.now()) {
    this.lines = view;
    this.now = now;
  }

  /** Changes with every change of the result or the status, and with nothing else: what a snapshot compares. */
  get version(): number {
    return this.revision;
  }

  get status(): SearchStatus {
    return this.state;
  }

  /** The pattern, global, for finding where a line matches; null while there is no usable query. */
  get pattern(): RegExp | null {
    return this.compiled;
  }

  /** Lines with a match found so far. */
  get count(): number {
    return this.found.length;
  }

  /** The ordinal of the `index`th line with a match. */
  at(index: number): number {
    return this.found[index] ?? 0;
  }

  /** Whether the line numbered `n` has a match. */
  hit(n: number): boolean {
    return this.indexOf(n) >= 0;
  }

  /** The place of line `n` among the lines with a match, or -1. */
  indexOf(n: number): number {
    const index = this.lowerBound(n);
    return this.found[index] === n ? index : -1;
  }

  /** The first line with a match after `n`. */
  after(n: number): number | undefined {
    return this.found[this.lowerBound(n + 1)];
  }

  /** The last line with a match before `n`. */
  before(n: number): number | undefined {
    return this.found[this.lowerBound(n) - 1];
  }

  /** A new query, or new toggles: a full pass from the first line of the view. */
  configure(options: SearchOptions): void {
    this.options = options;
    this.compiled = compileSearchPattern(options.query, { isRegex: options.regex, caseSensitive: options.caseSensitive });
    this.restart();
  }

  /** The same query over a different view (a new minimum level): a full pass again. */
  restart(): void {
    this.found = [];
    this.counts = [];
    this.matches = 0;
    this.scanned = 0;
    this.cappedBy = undefined;
    this.resume = undefined;
    this.state = this.options.query === '' ? 'idle' : this.compiled === null ? 'invalid' : 'scanning';
    this.revision += 1;
  }

  /**
   * The buffer evicted its head: the matches of lines below `first` go, and no line is read. A search the cap on matches stopped has room again once matches
   * go, and is `scanning` again: it resumes after the last line it read. One the time guard stopped stays stopped.
   */
  trim(first: number): void {
    const cut = this.lowerBound(first);
    if (cut === 0) {
      return;
    }

    for (let index = 0; index < cut; index += 1) {
      this.matches -= this.counts[index] ?? 0;
    }

    this.found.splice(0, cut);
    this.counts.splice(0, cut);
    this.revision += 1;
    if (this.state === 'capped' && this.cappedBy === 'matches' && this.matches < MAX_MATCH_COUNT) {
      this.state = 'scanning';
      this.cappedBy = undefined;
    }
  }

  /**
   * Scans from where the last slice stopped to the end of the view, one chunk at a time, until `budgetMs` is spent; one chunk always runs, so a slice
   * progresses. Returns true while lines are left to scan, so the caller schedules the next slice. After the first full pass it scans only the lines
   * that have come since; after a cap that eviction lifted, only the lines after the last one it read.
   */
  step(budgetMs: number): boolean {
    if (this.compiled === null || this.state === 'capped' || this.state === 'idle' || this.state === 'invalid') {
      return false;
    }

    const end = this.lines.length;
    let index = this.lines.lowerBound(this.scanned);
    // The line the cap cut, if the head did not take it: the first chunk begins in it, at the offset after the last match it took. If the head took it, `index` is already the first
    // line that is left.
    let offset = this.resume !== undefined && index < end && this.lines.ordinalAt(index) === this.resume.n ? this.resume.offset : 0;
    this.resume = undefined;
    const started = this.now();
    const getLine = (lineIndex: number): string => {
      const entry = this.lines.at(lineIndex);
      return entry.kind === 'line' ? entry.text : '';
    };

    while (index < end) {
      const chunkEnd = Math.min(end, index + SEARCH_CHUNK_LINES);
      const { results, capped, stoppedAt } = execSafeSearchRange(this.compiled, index, chunkEnd, getLine, (lineIndex) => lineIndex, MAX_MATCH_COUNT - this.matches, offset);
      offset = 0;
      this.matches += results.length;
      let last = this.found.at(-1);
      for (const lineIndex of results) {
        const n = this.lines.ordinalAt(lineIndex);
        if (n === last) {
          const at = this.counts.length - 1;
          this.counts[at] = (this.counts[at] ?? 0) + 1;
        } else {
          this.found.push(n);
          this.counts.push(1);
          last = n;
        }
      }

      if (results.length > 0) {
        this.revision += 1;
      }

      if (capped) {
        this.state = 'capped';
        this.revision += 1;
        if (this.matches >= MAX_MATCH_COUNT) {
          // The cap is full. The engine stopped at the match that filled it and read no line after that one. The scan resumes there: not at the start of this chunk, whose earlier
          // lines were read (a second read would find their matches again and put their ordinals into `found` twice), not at its end, whose later lines were not read (their
          // matches would be missed), and not always at the line after the match: when text is left in that line after the match, the rest of it is read from where the match
          // ended, because its further matches are the ones a fresh scan counts against the cap, and a search that is full on a fresh scan must not read `done` on a resumed one.
          this.cappedBy = 'matches';
          if (stoppedAt !== undefined) {
            const stoppedN = this.lines.ordinalAt(stoppedAt.lineIndex);
            this.scanned = stoppedAt.atEnd ? stoppedN + 1 : stoppedN;
            this.resume = stoppedAt.atEnd ? undefined : { n: stoppedN, offset: stoppedAt.offset };
          }
        } else {
          // The cap is not full, so the engine stopped on its clock. That stop is for good, so where it stopped is not kept.
          this.cappedBy = 'time';
        }

        return false;
      }

      index = chunkEnd;
      this.scanned = this.lines.ordinalAt(chunkEnd - 1) + 1;
      if (this.now() - started >= budgetMs) {
        break;
      }
    }

    const more = index < end;
    if (more && this.state === 'done') {
      // Lines that came after a finished search are not all read: its result is partial until the last slice has run, and it says so.
      this.state = 'scanning';
      this.revision += 1;
    } else if (!more && this.state === 'scanning') {
      this.state = 'done';
      this.revision += 1;
    }

    return more;
  }

  /** The first place in `found` holding an ordinal that is at least `n`. */
  private lowerBound(n: number): number {
    let low = 0;
    let high = this.found.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.found[middle] ?? 0) < n) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }
}
