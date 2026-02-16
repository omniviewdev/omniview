import { parseRawLogLine } from './parseLogLine';
import type { RawLogLine } from '../types';

function makeRaw(overrides: Partial<RawLogLine> = {}): RawLogLine {
  return {
    session_id: 'sess-1',
    source_id: 'pod-a',
    labels: { app: 'web' },
    timestamp: '2024-01-15T10:30:00Z',
    content: 'hello world',
    origin: 0,
    ...overrides,
  };
}

describe('parseRawLogLine', () => {
  // ---- Field mapping ----

  it('maps basic fields from raw line', () => {
    const entry = parseRawLogLine(makeRaw(), 42);

    expect(entry.lineNumber).toBe(42);
    expect(entry.sessionId).toBe('sess-1');
    expect(entry.sourceId).toBe('pod-a');
    expect(entry.labels).toEqual({ app: 'web' });
    expect(entry.timestamp).toBe('2024-01-15T10:30:00Z');
    expect(entry.content).toBe('hello world');
  });

  // ---- Origin mapping ----

  it.each([
    [0, 'CURRENT'],
    [1, 'PREVIOUS'],
    [2, 'SYSTEM'],
  ] as const)('maps origin %i to %s', (origin, expected) => {
    const entry = parseRawLogLine(makeRaw({ origin }), 1);
    expect(entry.origin).toBe(expected);
  });

  it('defaults unknown origin to CURRENT', () => {
    const entry = parseRawLogLine(makeRaw({ origin: 99 }), 1);
    expect(entry.origin).toBe('CURRENT');
  });

  // ---- Level detection ----

  it.each([
    ['2024-01-01 ERROR something broke', 'error'],
    ['FATAL: out of memory', 'error'],
    ['PANIC in handler', 'error'],
    ['CRITICAL failure', 'error'],
    ['WARN disk almost full', 'warn'],
    ['WARNING: deprecated', 'warn'],
    ['INFO server started', 'info'],
    ['DEBUG handler called', 'debug'],
    ['DBG cache miss', 'debug'],
    ['TRACE request details', 'trace'],
    ['TRC packet received', 'trace'],
  ])('detects level in "%s"', (content, expectedLevel) => {
    const entry = parseRawLogLine(makeRaw({ content }), 1);
    expect(entry.level).toBe(expectedLevel);
  });

  it('detects level case-insensitively', () => {
    const entry = parseRawLogLine(makeRaw({ content: 'error happened' }), 1);
    expect(entry.level).toBe('error');
  });

  it('requires word boundaries (no match on INFORMED)', () => {
    const entry = parseRawLogLine(makeRaw({ content: 'INFORMED the user' }), 1);
    expect(entry.level).toBeUndefined();
  });

  it('uses first-match priority (ERROR before WARN)', () => {
    const entry = parseRawLogLine(makeRaw({ content: 'ERROR with WARNING' }), 1);
    expect(entry.level).toBe('error');
  });

  it('returns undefined level for no match', () => {
    const entry = parseRawLogLine(makeRaw({ content: 'just a plain line' }), 1);
    expect(entry.level).toBeUndefined();
  });

  // ---- JSON detection ----

  it('detects valid JSON object', () => {
    const entry = parseRawLogLine(makeRaw({ content: '{"key":"value"}' }), 1);
    expect(entry.isJson).toBe(true);
  });

  it('detects valid JSON array', () => {
    const entry = parseRawLogLine(makeRaw({ content: '[1,2,3]' }), 1);
    expect(entry.isJson).toBe(true);
  });

  it('detects JSON with leading/trailing whitespace', () => {
    const entry = parseRawLogLine(makeRaw({ content: '  {"a":1}  ' }), 1);
    expect(entry.isJson).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const entry = parseRawLogLine(makeRaw({ content: '{not json}' }), 1);
    expect(entry.isJson).toBe(false);
  });

  it('rejects non-JSON starting chars', () => {
    const entry = parseRawLogLine(makeRaw({ content: 'hello world' }), 1);
    expect(entry.isJson).toBe(false);
  });

  // ---- Binary content ----

  it('decodes Uint8Array-like object via TextDecoder', () => {
    // Simulate the shape that comes over gRPC: { "0": 72, "1": 105 } for "Hi"
    const binaryContent = { 0: 72, 1: 105 } as unknown as string;
    const entry = parseRawLogLine(makeRaw({ content: binaryContent }), 1);
    expect(entry.content).toBe('Hi');
  });

  // ---- Edge cases ----

  it('handles empty content', () => {
    const entry = parseRawLogLine(makeRaw({ content: '' }), 1);
    expect(entry.content).toBe('');
    expect(entry.level).toBeUndefined();
    expect(entry.isJson).toBe(false);
  });

  it('defaults null labels to empty object', () => {
    const entry = parseRawLogLine(makeRaw({ labels: null as unknown as Record<string, string> }), 1);
    expect(entry.labels).toEqual({});
  });

  it('defaults missing timestamp to empty string', () => {
    const entry = parseRawLogLine(makeRaw({ timestamp: '' }), 1);
    expect(entry.timestamp).toBe('');
  });
});
