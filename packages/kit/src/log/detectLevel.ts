// Provenance: carried as an engine from the host's old log viewer, `detectLevel` of `ui/providers/BottomDrawer/containers/LogViewer/utils/parseLogLine.ts:4-71`
// at origin/main ce60076a (last changed by c4bd5776). Register: HLT-15. Unchanged but for one number: a keyword looked up in a Map after four precompiled
// patterns tried in order (a JSON field, key=value, a bracketed [LEVEL], then a word near the start of the line after an optional timestamp), stopping at the
// first hit and never scanning the whole line for a bare word, which would bring back the false positives host #34 fixed. The number is the start-of-line
// pattern's prefix, 40 characters where the old viewer had 35 (PR #544 review): the widest RFC 3339 timestamp a feed writes, `2024-01-01T10:00:00.123456789+00:00`
// (nine fraction digits, a numeric offset), is itself 35, and its separator makes 36, which the old bound left no room for. NOT carried: `isJsonString` and the
// `isJson` flag of the entry: a `JSON.parse` of every line that starts with a brace, for a flag nothing read (the defect HLT-15 names).
import type { LogLevel } from './types';

const LEVEL_KEYWORDS: ReadonlyArray<{ readonly level: LogLevel; readonly words: readonly string[] }> = [
  { level: 'error', words: ['error', 'err', 'fatal', 'panic', 'critical'] },
  { level: 'warn', words: ['warn', 'warning'] },
  { level: 'info', words: ['info'] },
  { level: 'debug', words: ['debug', 'dbg'] },
  { level: 'trace', words: ['trace', 'trc'] },
];

const LEVEL_WORD_SET = new Map<string, LogLevel>(LEVEL_KEYWORDS.flatMap(({ level, words }) => words.map((word) => [word, level] as const)));

// A level in a JSON field: "level":"error", "severity":"WARN", "lvl":"info".
const JSON_LEVEL_RE = /["'](?:level|severity|lvl)["']\s*[:=]\s*["']([a-zA-Z]+)["']/i;

// A bracketed level: [ERROR], [WARN], [info].
const BRACKET_LEVEL_RE = /\[([A-Za-z]+)\]/g;

// A key=value level: level=ERROR, severity=warn, level = "error", severity : 'warn'.
const KV_LEVEL_RE = /\b(?:level|severity|lvl)\s*[=:]\s*["']?([a-zA-Z]+)\b["']?/i;

// A level word at or near the start of the line, after an optional timestamp: "ERROR ...", "2024-01-01 ERROR ...", "2024-01-01T00:00:00Z ERROR ...". The prefix may be
// 40 characters of the ones a timestamp is written with: its widest form (35) and a separator of up to five characters (a space or two, ` - `). It stays a short, bounded
// prefix of those characters only, so a word in the middle of a sentence is never reached.
const START_LEVEL_RE = /^[\d\-T:.Z+/ ]{0,40}\b([A-Za-z]+)\b/;

/** The level the first group of a match names, when it names one. */
function levelWord(match: RegExpExecArray | null): LogLevel | undefined {
  const word = match?.[1];
  return word === undefined ? undefined : LEVEL_WORD_SET.get(word.toLowerCase());
}

/** The level a line says about itself, or undefined when it says none. The text has no ANSI escapes. */
export function detectLevel(content: string): LogLevel | undefined {
  const json = levelWord(JSON_LEVEL_RE.exec(content));
  if (json !== undefined) {
    return json;
  }

  const keyValue = levelWord(KV_LEVEL_RE.exec(content));
  if (keyValue !== undefined) {
    return keyValue;
  }

  // Every bracket is tried, the first recognised level wins.
  BRACKET_LEVEL_RE.lastIndex = 0;
  let bracketMatch = BRACKET_LEVEL_RE.exec(content);
  while (bracketMatch !== null) {
    const found = levelWord(bracketMatch);
    if (found !== undefined) {
      return found;
    }

    bracketMatch = BRACKET_LEVEL_RE.exec(content);
  }

  return levelWord(START_LEVEL_RE.exec(content));
}
