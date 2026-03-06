export interface AnsiSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface LogEntry {
  lineNumber: number;
  sessionId: string;
  sourceId: string;
  labels: Record<string, string>;
  timestamp: string;
  /** Plain text content with ANSI codes stripped (used by search, level detection, download). */
  content: string;
  origin: 'CURRENT' | 'PREVIOUS' | 'SYSTEM';
  level?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  isJson?: boolean;
  /** Styled segments for ANSI color rendering. Empty when no ANSI codes were present. */
  ansiSegments?: AnsiSegment[];
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

/**
 * Handlers that a data source pushes data into.
 * LogViewerContainer provides these when it calls source.connect().
 */
export interface LogDataSourceHandlers {
  onLines: (entries: LogEntry[]) => void;
  onEvent: (event: LogStreamEvent) => void;
}

/**
 * Abstraction over where log entries come from.
 * SDK log sessions, plugin process logs, and dev build logs
 * all implement this interface.
 */
export interface LogDataSource {
  /** Connect to the source. Returns a cleanup function. */
  connect(handlers: LogDataSourceHandlers): () => void;

  /** Load historical log entries (e.g. from ring buffer). */
  loadHistory?(): Promise<LogEntry[]>;

  /**
   * Declared filter dimensions (e.g. [{key: "source"}, {key: "level"}]).
   * When provided, useLogSources uses these instead of fetching from
   * LogsClient.GetSession. When absent, useLogSources derives dimensions
   * from entry labels (auto-derive behavior).
   */
  declaredDimensions?: Array<{ key: string; displayName?: string }>;
}
