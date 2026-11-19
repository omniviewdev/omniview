// Provenance: the level cases of `ui/providers/BottomDrawer/containers/LogViewer/utils/parseLogLine.spec.ts` at origin/main ce60076a (45cd8242), run against
// `detectLevel` directly (the old spec reached it through `parseRawLogLine`, which also ran an `isJson` probe nobody read: the defect HLT-15 names, not
// carried; the entry's test pins that a JSON line costs no `JSON.parse`).
import { describe, expect, it } from 'vitest';
import { detectLevel } from './detectLevel';

describe('detectLevel', () => {
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
  ])('detects the level in "%s"', (content, expected) => {
    expect(detectLevel(content)).toBe(expected);
  });

  it('reads a level written in lower case', () => {
    expect(detectLevel('error happened')).toBe('error');
  });

  it('wants a whole word: INFORMED is not INFO', () => {
    expect(detectLevel('INFORMED the user')).toBeUndefined();
  });

  it('takes the first match by position, not by the severity of a word later on', () => {
    expect(detectLevel('ERROR with WARNING')).toBe('error');
  });

  it('has no level for a plain line', () => {
    expect(detectLevel('just a plain line')).toBeUndefined();
    expect(detectLevel('')).toBeUndefined();
  });

  it.each([
    ['{"level":"error","msg":"x"}', 'error'],
    ['{"severity":"WARN","msg":"x"}', 'warn'],
    ['level=info msg="started"', 'info'],
    ['time=2024-01-01T00:00:00Z level=debug msg=x', 'debug'],
    ['2024-01-01T10:00:00Z [ERROR] failed', 'error'],
    ['ts=1 caller=x [warn] slow', 'warn'],
  ])('reads the level of a structured line: %s', (content, expected) => {
    expect(detectLevel(content)).toBe(expected);
  });

  it('does not scan the whole line for a bare word: "error" in the middle of a sentence is not a level (host #34)', () => {
    expect(detectLevel('the request completed without error after 3 retries')).toBeUndefined();
    expect(detectLevel('user typed the word error in the box')).toBeUndefined();
  });
});

// A level at the start of a line, after a timestamp. The widest RFC 3339 timestamp a feed writes is 35 characters (nine fraction digits and a numeric offset:
// `2024-01-01T10:00:00.123456789+00:00`), and the space after it makes 36; the prefix has to span both, and nothing much past them.
describe('detectLevel: the timestamp before a level', () => {
  const stamps = ['T', ' '].flatMap((separator) =>
    ['', '.123', '.123456', '.123456789'].flatMap((fraction) =>
      ['Z', '+00:00', '-05:30'].map((offset) => `2024-01-01${separator}10:00:00${fraction}${offset}`),
    ),
  );

  it.each(stamps)('reads the level after the timestamp "%s"', (stamp) => {
    expect(detectLevel(`${stamp} ERROR failed`)).toBe('error');
  });

  it('reads the line that names the widest timestamp, and a separator wider than one space', () => {
    expect(detectLevel('2024-01-01T10:00:00.123456789+00:00 ERROR failed')).toBe('error');
    expect(detectLevel('2024-01-01T10:00:00.123456789+00:00  WARN  aligned')).toBe('warn');
    expect(detectLevel('2024-01-01T10:00:00.123456789+00:00 - INFO dashed')).toBe('info');
  });

  it('still rejects a severity word inside an ordinary sentence, after a timestamp too', () => {
    expect(detectLevel('2024-01-01T10:00:00.123456789+00:00 the request completed without error')).toBeUndefined();
    expect(detectLevel('2024-01-01T10:00:00Z user typed the word error in the box')).toBeUndefined();
  });

  it('does not look further than a timestamp: a level after a long run of timestamp characters is not one', () => {
    expect(detectLevel(`${'0'.repeat(100)} ERROR failed`)).toBeUndefined();
  });
});
