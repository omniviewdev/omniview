import type { LogEntry, LogLevel, RawLogLine } from '../types';

const LEVEL_PATTERNS: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: 'error', pattern: /\b(ERROR|ERR|FATAL|PANIC|CRITICAL)\b/i },
  { level: 'warn', pattern: /\b(WARN|WARNING)\b/i },
  { level: 'info', pattern: /\b(INFO)\b/i },
  { level: 'debug', pattern: /\b(DEBUG|DBG)\b/i },
  { level: 'trace', pattern: /\b(TRACE|TRC)\b/i },
];

function detectLevel(content: string): LogLevel | undefined {
  for (const { level, pattern } of LEVEL_PATTERNS) {
    if (pattern.test(content)) {
      return level;
    }
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
  const content = typeof raw.content === 'string'
    ? raw.content
    : new TextDecoder().decode(new Uint8Array(Object.values(raw.content)));

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
  };
}
