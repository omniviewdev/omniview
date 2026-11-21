// The time column: the clock of a line, `HH:MM:SS.mmm` (the mock's `clock(l.t)`), read from the RFC 3339 text the backend sent. Done for the few rows
// in the window when they render, never for every line at ingest. The mock shows it in the viewer's local time, and in UTC (with a `Z` after it) when the reader
// chose that (`shell-panel.js` 129-132 `clock`, 1572 `ts: 'local'`, 1708 the UTC span, 2666 the Timestamps option).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatClock, formatStamp, instantOf } from './time';

// Local time is the machine's: a test that tells it from UTC puts the process in a zone of its own (V8 follows `process.env.TZ` as it is written) and takes it out again.
afterEach(() => {
  vi.unstubAllEnvs();
});

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const local = (text: string) => {
  const date = new Date(text);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

describe('formatClock', () => {
  it('writes the UTC clock of a Z timestamp when asked for UTC', () => {
    expect(formatClock('2024-01-15T10:30:00.123Z', { utc: true })).toBe('10:30:00.123');
    expect(formatClock('2024-01-15T23:59:59.999Z', { utc: true })).toBe('23:59:59.999');
  });

  it('writes the local clock by default, the same one a Date gives', () => {
    for (const text of ['2024-01-15T10:30:00.123Z', '2024-07-04T00:00:01.500Z', '2024-12-31T23:59:59.001Z']) {
      expect(formatClock(text)).toBe(local(text));
    }
  });

  it('keeps a time zone offset: the clock of the instant, not of the text', () => {
    expect(formatClock('2024-01-15T10:30:00.000+02:00', { utc: true })).toBe('08:30:00.000');
    expect(formatClock('2024-01-15T10:30:00.000-05:30', { utc: true })).toBe('16:00:00.000');
    expect(formatClock('2024-01-15T10:30:00.000+02:00')).toBe(local('2024-01-15T10:30:00.000+02:00'));
  });

  it('cuts nanoseconds to milliseconds and pads a short fraction', () => {
    expect(formatClock('2024-01-15T10:30:00.123456789Z', { utc: true })).toBe('10:30:00.123');
    expect(formatClock('2024-01-15T10:30:00.5Z', { utc: true })).toBe('10:30:00.500');
    expect(formatClock('2024-01-15T10:30:00.05Z', { utc: true })).toBe('10:30:00.050');
    expect(formatClock('2024-01-15T10:30:00Z', { utc: true })).toBe('10:30:00.000');
  });

  it('is empty for a line with no time, and for text that is not a time', () => {
    expect(formatClock('')).toBe('');
    expect(formatClock('yesterday')).toBe('');
    expect(formatClock('2024-13-45T99:99:99Z')).toBe('');
  });
});

describe('formatStamp: the clock as a row shows it and a copy carries it', () => {
  it('is the local clock in local time, with no mark of a zone: the mock\'s `clock(l.t)`', () => {
    for (const text of ['2024-01-15T10:30:00.123Z', '2024-07-04T00:00:01.500Z', '2024-12-31T23:59:59.001+05:30']) {
      expect(formatStamp(text, 'local')).toBe(local(text));
    }

    // In a zone that is not UTC and not a whole hour from it, local is not UTC in the hour or the minute.
    vi.stubEnv('TZ', 'Asia/Kolkata');
    expect(formatStamp('2024-01-15T10:30:00.123Z', 'local')).toBe('16:00:00.123');
    expect(formatStamp('2024-01-15T10:30:00.123Z', 'utc')).toBe('10:30:00.123Z');
  });

  it('is the UTC clock with a Z after it in UTC: the mock\'s `clock(l.t, { utc: true })` and the `Z` it writes (shell-panel.js 1708)', () => {
    expect(formatStamp('2024-01-15T10:30:00.123Z', 'utc')).toBe('10:30:00.123Z');
    expect(formatStamp('2024-01-15T23:59:59.999Z', 'utc')).toBe('23:59:59.999Z');
    // The clock of the instant, whatever zone the text was written in.
    expect(formatStamp('2024-01-15T10:30:00.000+02:00', 'utc')).toBe('08:30:00.000Z');
    expect(formatStamp('2024-01-15T10:30:00.123456789Z', 'utc')).toBe('10:30:00.123Z');
  });

  it('is empty for a line with no time or text that is not a time, in either zone: no lone Z', () => {
    for (const zone of ['local', 'utc'] as const) {
      expect(formatStamp('', zone)).toBe('');
      expect(formatStamp('yesterday', zone)).toBe('');
      expect(formatStamp('2024-13-45T99:99:99Z', zone)).toBe('');
    }
  });
});

describe('instantOf: the instant a line says it was written', () => {
  it('reads the backend\'s text, nine digits of fraction and all, to the millisecond', () => {
    expect(instantOf('2026-11-21T09:29:00.123456789Z')).toBe(Date.UTC(2026, 10, 21, 9, 29, 0, 123));
    expect(instantOf('2026-11-21T09:29:00Z')).toBe(Date.UTC(2026, 10, 21, 9, 29, 0, 0));
    expect(instantOf('2026-11-21T11:29:00.5+02:00')).toBe(Date.UTC(2026, 10, 21, 9, 29, 0, 500));
  });

  it('has none for a line with no time or text that is not one', () => {
    expect(instantOf('')).toBeUndefined();
    expect(instantOf('0001-13-01T00:00:00Z')).toBeUndefined();
    expect(instantOf('yesterday')).toBeUndefined();
  });
});
