import { describe, expect, it } from 'vitest';
import type { Muted } from '../core/notices';
import { view } from '../core/notices/testing';
import { dayLabel, listOf, nameOfSource, SHOWN, sourcesOf, type CentreList } from './centreList';

// The list of the notification centre from the model's history (ch16 S80; the mock's `centerModel` and `listHtml`, shell-feedback.js): the records the source filter leaves, the first fifty of them, and the
// headings that stand between them: Recent, then a heading for each day. Pure: the clock is an argument, and every date is built from local fields so no zone changes an answer.

const at = (day: number, hour: number, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(21, 12);

const record = (id: string, time: number, extra: Parameters<typeof view>[0] = {}) => view({ id, createdAt: time, finishedAt: time, updatedAt: time, ...extra });

describe('dayLabel', () => {
  it('says Today for a time on the same date as now, and Yesterday for the date before', () => {
    expect(dayLabel(at(21, 0, 1), NOW)).toBe('Today');
    expect(dayLabel(at(21, 11, 59), NOW)).toBe('Today');
    expect(dayLabel(at(20, 23, 59), NOW)).toBe('Yesterday');
    expect(dayLabel(at(20, 0, 0), NOW)).toBe('Yesterday');
  });

  it('says the weekday, month and day of any other date, in the viewer\'s locale', () => {
    expect(dayLabel(at(14, 10), NOW)).toBe(new Date(at(14, 10)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    expect(dayLabel(at(19, 10), NOW)).not.toBe('Yesterday');
  });

  it('is not fooled by the length of a day: the date decides, not 24 hours', () => {
    const lateNow = at(21, 0, 30);
    expect(dayLabel(at(20, 23, 50), lateNow)).toBe('Yesterday');
    expect(dayLabel(at(20, 0, 10), lateNow)).toBe('Yesterday');
    expect(dayLabel(at(19, 23, 50), lateNow)).not.toBe('Yesterday');
  });
});

describe('listOf', () => {
  it('has no item for an empty history', () => {
    const list = listOf([], { source: '', more: false, now: NOW });
    expect(list.items).toEqual([]);
    expect(list.matched).toEqual([]);
    expect(list.shown).toEqual([]);
    expect(list.older).toBe(0);
  });

  it('heads the list with Recent, then a heading for each day, and keeps the model\'s order (newest first)', () => {
    const a = record('a', at(21, 11));
    const b = record('b', at(21, 9));
    const c = record('c', at(20, 22));
    const d = record('d', at(14, 10));
    const list = listOf([a, b, c, d], { source: '', more: false, now: NOW });
    expect(list.items.map((item) => (item.kind === 'label' ? `# ${item.text}` : item.record.id))).toEqual([
      '# Recent',
      '# Today',
      'a',
      'b',
      '# Yesterday',
      'c',
      `# ${dayLabel(at(14, 10), NOW)}`,
      'd',
    ]);
  });

  it('puts a record under the day it finished, and under the day it was created when it has no end', () => {
    const finished = record('f', at(20, 23, 30), { finishedAt: at(21, 0, 20) });
    const created = record('c', at(21, 8), { finishedAt: undefined });
    const list = listOf([created, finished], { source: '', more: false, now: NOW });
    expect(list.items.map((item) => (item.kind === 'label' ? `# ${item.text}` : item.record.id))).toEqual(['# Recent', '# Today', 'c', 'f']);
  });

  it('gives each heading and row a key that is stable for the same content', () => {
    const rows = [record('a', at(21, 11)), record('b', at(20, 10))];
    const keys = (list: CentreList) => list.items.map((item) => (item.kind === 'label' ? item.key : `row:${item.record.id}`));
    const first = keys(listOf(rows, { source: '', more: false, now: NOW }));
    expect(new Set(first).size).toBe(first.length);
    expect(keys(listOf(rows, { source: '', more: false, now: NOW + 1000 }))).toEqual(first);
  });

  it('keeps only the records of the chosen source, and counts nothing for another', () => {
    const rows = [record('a', at(21, 11), { source: 'cloud' }), record('b', at(21, 10), { source: 'stack' }), record('c', at(21, 9), { source: 'cloud' })];
    const list = listOf(rows, { source: 'cloud', more: false, now: NOW });
    expect(list.matched.map((one) => one.id)).toEqual(['a', 'c']);
    expect(listOf(rows, { source: 'nobody', more: false, now: NOW }).items).toEqual([]);
  });

  it('draws the first fifty and says how many are older, and draws them all once asked', () => {
    const rows = Array.from({ length: 120 }, (_, index) => record(`r${String(index)}`, at(21, 11) - index * 60_000));
    const list = listOf(rows, { source: '', more: false, now: NOW });
    expect(SHOWN).toBe(50);
    expect(list.shown).toHaveLength(50);
    expect(list.shown[49]?.id).toBe('r49');
    expect(list.matched).toHaveLength(120);
    expect(list.older).toBe(70);
    expect(list.items.filter((item) => item.kind === 'row')).toHaveLength(50);
    const all = listOf(rows, { source: '', more: true, now: NOW });
    expect(all.shown).toHaveLength(120);
    expect(all.older).toBe(0);
  });

  it('narrows first and then takes the fifty, so the filter never hides a record behind the cut', () => {
    const rows = Array.from({ length: 80 }, (_, index) => record(`r${String(index)}`, at(21, 11) - index * 60_000, { source: index < 60 ? 'cloud' : 'stack' }));
    const list = listOf(rows, { source: 'stack', more: false, now: NOW });
    expect(list.matched).toHaveLength(20);
    expect(list.shown).toHaveLength(20);
    expect(list.older).toBe(0);
  });

  it('does not rebuild a record: the rows are the model\'s own objects', () => {
    const one = record('a', at(21, 11));
    const list = listOf([one], { source: '', more: false, now: NOW });
    const row = list.items.find((item) => item.kind === 'row');
    expect(row?.kind === 'row' && row.record).toBe(one);
  });
});

describe('sourcesOf', () => {
  it('lists All sources first, then each source by name with how many records it has', () => {
    const rows = [
      record('a', at(21, 11), { source: 'stack', sourceName: 'Stack' }),
      record('b', at(21, 10), { source: 'cloud', sourceName: 'Cloud' }),
      record('c', at(21, 9), { source: 'cloud', sourceName: 'Cloud' }),
    ];
    expect(sourcesOf(rows, '')).toEqual([
      { id: '', label: 'All sources' },
      { id: 'cloud', label: 'Cloud (2)' },
      { id: 'stack', label: 'Stack (1)' },
    ]);
  });

  it('keeps the chosen source in the list with none when its records are gone, so the filter can still be read and cleared', () => {
    const rows = [record('a', at(21, 11), { source: 'stack', sourceName: 'Stack' })];
    expect(sourcesOf(rows, 'cloud')).toEqual([
      { id: '', label: 'All sources' },
      { id: 'cloud', label: 'cloud (0)' },
      { id: 'stack', label: 'Stack (1)' },
    ]);
  });

  it('has only All sources for an empty history', () => {
    expect(sourcesOf([], '')).toEqual([{ id: '', label: 'All sources' }]);
  });
});

describe('nameOfSource', () => {
  const rows = [record('a', at(21, 11), { source: 'cloud', sourceName: 'Cloud Atlas' })];
  const muted: readonly Muted[] = [{ source: 'stack', name: 'Stack Overflow', until: 'forever' }];

  it('is the name the records of the source carry', () => {
    expect(nameOfSource(rows, muted, 'cloud')).toBe('Cloud Atlas');
  });

  it('is the name of its mute when it has no record left', () => {
    expect(nameOfSource(rows, muted, 'stack')).toBe('Stack Overflow');
  });

  it('is the id of a source that has neither', () => {
    expect(nameOfSource(rows, muted, 'bank')).toBe('bank');
  });
});
