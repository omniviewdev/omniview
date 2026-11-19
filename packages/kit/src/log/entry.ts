// The entry the view keeps for a line of a feed. Made ONCE, at ingest (HLT-5): the escapes are read in one pass (HLT-14), the level is the feed's or is
// detected from the plain text (HLT-15), and nothing after this parses a line again: a row, a scroll and a search read the entry. An entry is immutable,
// so a row compares it by identity and a flush that appends lines renders no row it already drew (HLT-2).
import { paintedRuns } from './ansiHue';
import { detectLevel } from './detectLevel';
import { parseAnsi } from './parseAnsi';
import type { LineEntry, LogFeedLevel, LogFeedLine, LogLevel } from './types';

/** A level the feed gave, as the view tells it: the five levels it keeps, a `fatal` being an `error`. */
function levelOfFeed(level: LogFeedLevel): LogLevel {
  return level === 'fatal' ? 'error' : level;
}

/** The entry of a feed line, numbered `n` in its view. */
export function makeLineEntry(line: LogFeedLine, n: number): LineEntry {
  // The fast path of the parser returns the input and no segments for a line with no escape.
  const parsed = parseAnsi(line.text);
  const text = parsed.plain;
  return {
    kind: 'line',
    n,
    seq: line.seq,
    source: line.source,
    timestamp: line.timestamp,
    text,
    level: line.level === undefined ? detectLevel(text) : levelOfFeed(line.level),
    runs: parsed.hasAnsi ? paintedRuns(parsed.segments) : undefined,
  };
}
