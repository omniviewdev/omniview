export interface LogEntry {
  lineNumber: number;
  sessionId: string;
  sourceId: string;
  labels: Record<string, string>;
  timestamp: string;
  content: string;
  origin: 'CURRENT' | 'PREVIOUS' | 'SYSTEM';
  level?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  isJson?: boolean;
}

export interface LogSource {
  id: string;
  labels: Record<string, string>;
}

export interface LogStreamEvent {
  type: number;
  source_id: string;
  message: string;
  timestamp: string;
}

export interface RawLogLine {
  session_id: string;
  source_id: string;
  labels: Record<string, string>;
  timestamp: string;
  content: string;
  origin: number;
}

export interface SearchMatch {
  lineIndex: number;
  startOffset: number;
  endOffset: number;
}

// LogStreamEvent type values (matches Go SDK LogStreamEventType iota)
export const StreamEventType = {
  SOURCE_ADDED: 0,
  SOURCE_REMOVED: 1,
  STREAM_ERROR: 2,
  RECONNECTING: 3,
  RECONNECTED: 4,
  STREAM_ENDED: 5,
} as const;

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

export const LEVEL_COLORS: Record<LogLevel, string> = {
  error: '#d32f2f',
  warn: '#ed6c02',
  info: '#0288d1',
  debug: '#757575',
  trace: '#9e9e9e',
};
