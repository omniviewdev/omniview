import type { LogEntry, LogLevel, RawLogLine } from '../types';
import { parseAnsi } from './parseAnsi';

const LEVEL_KEYWORDS: Array<{ level: LogLevel; words: string[] }> = [
  { level: 'error', words: ['error', 'err', 'fatal', 'panic', 'critical'] },
  { level: 'warn', words: ['warn', 'warning'] },
  { level: 'info', words: ['info'] },
  { level: 'debug', words: ['debug', 'dbg'] },
  { level: 'trace', words: ['trace', 'trc'] },
];

const LEVEL_WORD_SET = new Map<string, LogLevel>(
  LEVEL_KEYWORDS.flatMap(({ level, words }) =>
    words.map((w) => [w, level] as const),
  ),
);

// Match level in JSON fields: "level":"error", "severity":"WARN", "lvl":"info"
const JSON_LEVEL_RE =
  /["'](?:level|severity|lvl)["']\s*[:=]\s*["']([a-zA-Z]+)["']/i;

// Match bracketed level: [ERROR], [WARN], [info]
const BRACKET_LEVEL_RE = /\[([A-Za-z]+)\]/g;

// Match key=value level: level=ERROR, severity=warn, level = "error", severity : 'warn'
const KV_LEVEL_RE = /\b(?:level|severity|lvl)\s*[=:]\s*["']?([a-zA-Z]+)\b["']?/i;

// Match level keyword at/near line start (with optional leading timestamp):
// "ERROR ...", "2024-01-01 ERROR ...", "2024-01-01T00:00:00Z ERROR ..."
const START_LEVEL_RE = /^[\d\-T:.Z+/ ]{0,35}\b([A-Za-z]+)\b/;

function detectLevel(content: string): LogLevel | undefined {
  // 1. JSON field match
  const jsonMatch = JSON_LEVEL_RE.exec(content);
  if (jsonMatch) {
    const found = LEVEL_WORD_SET.get(jsonMatch[1].toLowerCase());
    if (found) return found;
  }

  // 2. Key=value match
  const kvMatch = KV_LEVEL_RE.exec(content);
  if (kvMatch) {
    const found = LEVEL_WORD_SET.get(kvMatch[1].toLowerCase());
    if (found) return found;
  }

  // 3. Bracketed match — scan all brackets, return first recognized level
  BRACKET_LEVEL_RE.lastIndex = 0;
  let bracketMatch: RegExpExecArray | null;
  while ((bracketMatch = BRACKET_LEVEL_RE.exec(content)) !== null) {
    const found = LEVEL_WORD_SET.get(bracketMatch[1].toLowerCase());
    if (found) return found;
  }

  // 4. Level keyword near line start (after optional timestamp)
  const startMatch = START_LEVEL_RE.exec(content);
  if (startMatch) {
    const found = LEVEL_WORD_SET.get(startMatch[1].toLowerCase());
    if (found) return found;
  }

  return undefined;
}

function isJsonString(str: string): boolean {
  if (!str.startsWith('{') && !str.startsWith('[')) return false;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

const ORIGIN_MAP: Record<number, LogEntry['origin']> = {
  0: 'CURRENT',
  1: 'PREVIOUS',
  2: 'SYSTEM',
};

export function parseRawLogLine(raw: RawLogLine, lineNumber: number): LogEntry {
  const rawContent = typeof raw.content === 'string'
    ? raw.content
    : new TextDecoder().decode(new Uint8Array(Object.values(raw.content)));

  // Parse ANSI in one pass: produces stripped plain text + styled segments.
  const parsed = parseAnsi(rawContent);
  const content = parsed.plain;

  return {
    lineNumber,
    sessionId: raw.session_id,
    sourceId: raw.source_id,
    labels: raw.labels || {},
    timestamp: raw.timestamp || '',
    content,
    origin: ORIGIN_MAP[raw.origin] || 'CURRENT',
    level: detectLevel(content),
    isJson: isJsonString(content.trim()),
    ansiSegments: parsed.segments.length > 0 ? parsed.segments : undefined,
  };
}
