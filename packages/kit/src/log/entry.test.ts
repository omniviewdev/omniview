// The entry the view keeps for a line of a feed: made once at ingest, so no row, scroll or search parses anything (HLT-5, HLT-14, HLT-15).
// The cases of the old `parseRawLogLine` spec that still apply (ANSI, level, empty content) run here; `isJson` is not carried (HLT-15 defect).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLineEntry } from './entry';
import type { LogFeedLine } from './types';

const line = (overrides: Partial<LogFeedLine> = {}): LogFeedLine => ({
  seq: 7,
  source: 'source-a/app',
  timestamp: '2024-01-15T10:30:00.123Z',
  text: 'hello world',
  level: undefined,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeLineEntry', () => {
  it('maps the line and numbers the entry', () => {
    const entry = makeLineEntry(line(), 42);
    expect(entry).toEqual({
      kind: 'line',
      n: 42,
      seq: 7,
      source: 'source-a/app',
      timestamp: '2024-01-15T10:30:00.123Z',
      text: 'hello world',
      level: undefined,
      runs: undefined,
    });
  });

  it('keeps a plain line as the very string it came as: nothing is copied for the common line', () => {
    const text = 'a plain line of a log';
    expect(makeLineEntry(line({ text }), 1).text).toBe(text);
    expect(makeLineEntry(line({ text }), 1).runs).toBeUndefined();
  });

  it('removes escapes from the text and keeps the painted runs', () => {
    const entry = makeLineEntry(line({ text: '\x1b[31mERROR\x1b[0m something broke' }), 1);
    expect(entry.text).toBe('ERROR something broke');
    expect(entry.runs).toEqual([{ text: 'ERROR', hue: 'red' }, { text: ' something broke' }]);
  });

  it('paints a standard colour and not a 256 or 24-bit one of the same hex: the design paints the 16 only', () => {
    expect(makeLineEntry(line({ text: '\x1b[31mERROR\x1b[0m failed' }), 1).runs).toEqual([{ text: 'ERROR', hue: 'red' }, { text: ' failed' }]);
    expect(makeLineEntry(line({ text: '\x1b[38;5;1mERROR\x1b[0m failed' }), 1)).toMatchObject({ text: 'ERROR failed', runs: undefined, level: 'error' });
    expect(makeLineEntry(line({ text: '\x1b[38;2;204;0;0mERROR\x1b[0m failed' }), 1)).toMatchObject({ text: 'ERROR failed', runs: undefined, level: 'error' });
  });

  it('has no runs when the escapes only reset, or paint nothing the design paints', () => {
    expect(makeLineEntry(line({ text: '\x1b[0mplain text' }), 1)).toMatchObject({ text: 'plain text', runs: undefined });
    expect(makeLineEntry(line({ text: '\x1b[31m\x1b[0m' }), 1)).toMatchObject({ text: '', runs: undefined, level: undefined });
  });

  describe('level', () => {
    it('is the one the feed gave, whatever the text says', () => {
      expect(makeLineEntry(line({ text: 'ERROR looks bad', level: 'info' }), 1).level).toBe('info');
    });

    it('takes a feed fatal as error: the view tells five levels apart', () => {
      expect(makeLineEntry(line({ level: 'fatal' }), 1).level).toBe('error');
    });

    it.each(['trace', 'debug', 'info', 'warn', 'error'] as const)('keeps a feed %s as it is', (level) => {
      expect(makeLineEntry(line({ level }), 1).level).toBe(level);
    });

    it('is detected from the text when the feed gave none, through the escapes', () => {
      expect(makeLineEntry(line({ text: '\x1b[1;31mERROR\x1b[0m database down' }), 1).level).toBe('error');
      expect(makeLineEntry(line({ text: '2024-01-01 WARN disk almost full' }), 1).level).toBe('warn');
    });

    it('is detected after the widest timestamp a feed writes: RFC 3339 with nine fraction digits and a numeric offset, then its separator', () => {
      expect(makeLineEntry(line({ text: '2024-01-01T10:00:00.123456789+00:00 ERROR failed' }), 1).level).toBe('error');
    });

    it('is undefined for a line that says none', () => {
      expect(makeLineEntry(line({ text: 'just a plain line' }), 1).level).toBeUndefined();
    });
  });

  it('parses no JSON, however many JSON lines come: the old viewer parsed every one for a flag nothing read (HLT-15)', () => {
    const parse = vi.spyOn(JSON, 'parse');
    for (let n = 1; n <= 10_000; n += 1) {
      makeLineEntry(line({ text: `{"level":"info","n":${n},"msg":"request handled"}` }), n);
    }

    expect(parse).not.toHaveBeenCalled();
  });
});
