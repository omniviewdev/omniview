import { findEntryIndexByTime } from './binarySearchTimestamp';
import type { LogEntry } from '../types';

function makeEntry(timestamp: string, lineNumber = 0): LogEntry {
  return {
    lineNumber,
    sessionId: 'sess',
    sourceId: 'src',
    labels: {},
    timestamp,
    content: '',
    origin: 'CURRENT',
  };
}

describe('findEntryIndexByTime', () => {
  it('returns -1 for empty array', () => {
    expect(findEntryIndexByTime([], new Date('2024-01-01T00:00:00Z'))).toBe(-1);
  });

  it('returns 0 when target is before all entries', () => {
    const entries = [
      makeEntry('2024-01-15T10:00:00Z'),
      makeEntry('2024-01-15T11:00:00Z'),
    ];
    expect(findEntryIndexByTime(entries, new Date('2024-01-01T00:00:00Z'))).toBe(0);
  });

  it('returns -1 when target is after all entries', () => {
    const entries = [
      makeEntry('2024-01-15T10:00:00Z'),
      makeEntry('2024-01-15T11:00:00Z'),
    ];
    expect(findEntryIndexByTime(entries, new Date('2025-01-01T00:00:00Z'))).toBe(-1);
  });

  it('returns exact match index', () => {
    const entries = [
      makeEntry('2024-01-15T10:00:00Z'),
      makeEntry('2024-01-15T11:00:00Z'),
      makeEntry('2024-01-15T12:00:00Z'),
    ];
    expect(findEntryIndexByTime(entries, new Date('2024-01-15T11:00:00Z'))).toBe(1);
  });

  it('returns index of first entry >= target when between entries', () => {
    const entries = [
      makeEntry('2024-01-15T10:00:00Z'),
      makeEntry('2024-01-15T12:00:00Z'),
      makeEntry('2024-01-15T14:00:00Z'),
    ];
    // Target 11:00 is between 10:00 and 12:00 → should return index 1
    expect(findEntryIndexByTime(entries, new Date('2024-01-15T11:00:00Z'))).toBe(1);
  });

  it('treats entries without timestamps as epoch 0', () => {
    const entries = [
      makeEntry(''),  // treated as epoch 0
      makeEntry('2024-01-15T10:00:00Z'),
    ];
    // Target before epoch 0 → index 0
    expect(findEntryIndexByTime(entries, new Date('1969-01-01T00:00:00Z'))).toBe(0);
  });

  it('returns first index when multiple entries have same timestamp', () => {
    const entries = [
      makeEntry('2024-01-15T10:00:00Z', 0),
      makeEntry('2024-01-15T11:00:00Z', 1),
      makeEntry('2024-01-15T11:00:00Z', 2),
      makeEntry('2024-01-15T11:00:00Z', 3),
      makeEntry('2024-01-15T12:00:00Z', 4),
    ];
    expect(findEntryIndexByTime(entries, new Date('2024-01-15T11:00:00Z'))).toBe(1);
  });

  it('handles single entry (exact match)', () => {
    const entries = [makeEntry('2024-01-15T10:00:00Z')];
    expect(findEntryIndexByTime(entries, new Date('2024-01-15T10:00:00Z'))).toBe(0);
  });

  it('handles single entry (target before)', () => {
    const entries = [makeEntry('2024-01-15T10:00:00Z')];
    expect(findEntryIndexByTime(entries, new Date('2024-01-01T00:00:00Z'))).toBe(0);
  });

  it('handles single entry (target after)', () => {
    const entries = [makeEntry('2024-01-15T10:00:00Z')];
    expect(findEntryIndexByTime(entries, new Date('2025-01-01T00:00:00Z'))).toBe(-1);
  });
});
