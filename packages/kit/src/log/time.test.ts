// The time column: the clock of a line, `HH:MM:SS.mmm` (the mock's `clock(l.t)`), read from the RFC 3339 text the backend sent. Done for the few rows
// in the window when they render, never for every line at ingest.
import { describe, expect, it } from 'vitest';
import { formatClock } from './time';

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
