import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Muted } from '../core/notices';
import { view } from '../core/notices/testing';
import { dayAge, dayLabel, listOf, nameOfSource, SHOWN, sourcesOf, startOfDay, startOfNextDay, type CentreList, type Item } from './centreList';
import { ZONES } from './testing';

// The list of the notification centre from the model's history (ch16 S80; the mock's `centerModel` and `listHtml`, shell-feedback.js): the records the source filter leaves, the first fifty of them, and the
// headings that stand between them: Recent, then a heading for each day. Pure: the clock is an argument. A day is a LOCAL day, so every date here is built from local fields (`at`) or checked against `Intl` with the
// zone NAMED (`civil`), and the tests that depend on the zone put the process in each of the zones of `ZONES` and `CLOCK_ZONES` (`vi.stubEnv('TZ', zone)`: V8 follows `process.env.TZ` as it is written, as the kit's
// own tests rely on): no zone changes an answer, and a test that passes on a laptop and fails on a CI runner in UTC (O1b-2) cannot be written by accident.

afterEach(() => {
  vi.unstubAllEnvs();
});

const at = (day: number, hour: number, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(21, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const record = (id: string, time: number, extra: Parameters<typeof view>[0] = {}) => view({ id, createdAt: time, finishedAt: time, updatedAt: time, ...extra });

/** The list as it reads: a heading as `# words` (a day's by what it says at `now`), a row as its id. */
const outline = (list: CentreList, now: number): string[] => list.items.map((item) => (item.kind === 'label' ? `# ${item.text}` : item.kind === 'day' ? `# ${dayLabel(item.day, now)}` : item.record.id));

describe.each(ZONES)('dayLabel in %s', (zone) => {
  beforeEach(() => {
    vi.stubEnv('TZ', zone);
  });

  it('says Today for a time on the same date as now, and Yesterday for the date before', () => {
    const now = at(21, 12);
    expect(dayLabel(at(21, 0, 1), now)).toBe('Today');
    expect(dayLabel(at(21, 11, 59), now)).toBe('Today');
    expect(dayLabel(at(20, 23, 59), now)).toBe('Yesterday');
    expect(dayLabel(at(20, 0, 0), now)).toBe('Yesterday');
  });

  it('says the weekday, month and day of any other date, in the viewer\'s locale', () => {
    const now = at(21, 12);
    expect(dayLabel(at(14, 10), now)).toBe(new Date(at(14, 10)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    expect(dayLabel(at(19, 10), now)).not.toBe('Yesterday');
  });

  it('is not fooled by the length of a day: the date decides, not 24 hours', () => {
    const lateNow = at(21, 0, 30);
    expect(dayLabel(at(20, 23, 50), lateNow)).toBe('Yesterday');
    expect(dayLabel(at(20, 0, 10), lateNow)).toBe('Yesterday');
    expect(dayLabel(at(19, 23, 50), lateNow)).not.toBe('Yesterday');
  });

  it('turns at the local midnight and not a moment before or after it', () => {
    const midnight = at(21, 0);
    expect(dayLabel(midnight - 1, midnight - 1)).toBe('Today');
    expect(dayLabel(midnight - 1, midnight)).toBe('Yesterday');
    expect(dayLabel(midnight, midnight)).toBe('Today');
    expect(dayLabel(midnight - DAY - 1, midnight)).not.toBe('Yesterday');
  });

  it('knows that yesterday was the last day of a month and of a year, and of February in a leap year', () => {
    const when = (year: number, month: number, day: number, hour: number, minute: number) => new Date(year, month, day, hour, minute).getTime();
    expect(dayLabel(when(2026, 9, 31, 23, 0), when(2026, 10, 1, 0, 30))).toBe('Yesterday');
    expect(dayLabel(when(2026, 11, 31, 23, 0), when(2027, 0, 1, 0, 30))).toBe('Yesterday');
    expect(dayLabel(when(2027, 1, 28, 23, 0), when(2027, 2, 1, 0, 30))).toBe('Yesterday');
    expect(dayLabel(when(2028, 1, 29, 23, 0), when(2028, 2, 1, 0, 30))).toBe('Yesterday');
    expect(dayLabel(when(2028, 1, 28, 23, 0), when(2028, 2, 1, 0, 30))).not.toBe('Yesterday');
  });
});

describe.each(ZONES)('startOfDay, startOfNextDay and dayAge in %s', (zone) => {
  beforeEach(() => {
    vi.stubEnv('TZ', zone);
  });

  it('start the local day at midnight, and the next one at the following midnight', () => {
    expect(startOfDay(at(21, 15, 45))).toBe(at(21, 0));
    expect(startOfNextDay(at(21, 15, 45))).toBe(at(22, 0));
    // Midnight itself belongs to the day it starts, and the instant before it to the day that ends.
    expect(startOfDay(at(21, 0))).toBe(at(21, 0));
    expect(startOfNextDay(at(21, 0))).toBe(at(22, 0));
    expect(startOfDay(at(21, 0) - 1)).toBe(at(20, 0));
    expect(startOfNextDay(at(21, 0) - 1)).toBe(at(21, 0));
    // The last day of a month is followed by the first of the next.
    expect(startOfNextDay(at(30, 23, 59))).toBe(new Date(2026, 11, 1).getTime());
  });

  it('say Today until the next local midnight and then Yesterday, and when it is', () => {
    const now = at(21, 15);
    expect(dayAge(new Date(at(21, 9)), now)).toEqual({ text: 'Today', changesAt: at(22, 0) });
    expect(dayAge(new Date(at(20, 9)), now)).toEqual({ text: 'Yesterday', changesAt: at(22, 0) });
    expect(dayAge(new Date(at(14, 10)), now)).toEqual({ text: dayLabel(at(14, 10), now), changesAt: at(22, 0) });
    // The words of the day of a record after midnight are the next day's.
    expect(dayAge(new Date(at(21, 9)), at(22, 0)).text).toBe('Yesterday');
    expect(dayAge(new Date(at(21, 9)), at(22, 0) - 1).text).toBe('Today');
  });
});

describe('listOf', () => {
  it('has no item for an empty history', () => {
    const list = listOf([], { source: '', more: false });
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
    const list = listOf([a, b, c, d], { source: '', more: false });
    expect(outline(list, NOW)).toEqual(['# Recent', '# Today', 'a', 'b', '# Yesterday', 'c', `# ${dayLabel(at(14, 10), NOW)}`, 'd']);
  });

  it('gives a day\'s heading the first instant of that day, so that its words are the age of the day and follow the clock', () => {
    const list = listOf([record('a', at(21, 11)), record('b', at(21, 9)), record('c', at(20, 22))], { source: '', more: false });
    const days = list.items.filter((item): item is Extract<Item, { kind: 'day' }> => item.kind === 'day');
    expect(days.map((item) => item.day)).toEqual([at(21, 0), at(20, 0)]);
    // Later, the same day's heading says the next thing: the list has no words of its own for a day.
    expect(outline(list, at(22, 9))).toEqual(['# Recent', '# Yesterday', 'a', 'b', `# ${dayLabel(at(20, 22), at(22, 9))}`, 'c']);
  });

  it('puts a record under the day it finished, and under the day it was created when it has no end', () => {
    const finished = record('f', at(20, 23, 30), { finishedAt: at(21, 0, 20) });
    const created = record('c', at(21, 8), { finishedAt: undefined });
    const list = listOf([created, finished], { source: '', more: false });
    expect(outline(list, NOW)).toEqual(['# Recent', '# Today', 'c', 'f']);
  });

  it('gives each heading and row a key that is stable for the same content, and one for each day', () => {
    const rows = [record('a', at(21, 11)), record('b', at(20, 10))];
    const keys = (list: CentreList) => list.items.map((item) => (item.kind === 'row' ? `row:${item.record.id}` : item.key));
    const first = keys(listOf(rows, { source: '', more: false }));
    expect(new Set(first).size).toBe(first.length);
    expect(keys(listOf(rows, { source: '', more: false }))).toEqual(first);
    // A newer record of a day that is already there leaves its heading's key as it was.
    expect(keys(listOf([record('n', at(21, 12)), ...rows], { source: '', more: false }))).toEqual([first[0], first[1], 'row:n', ...first.slice(2)]);
  });

  it('keeps only the records of the chosen source, and counts nothing for another', () => {
    const rows = [record('a', at(21, 11), { source: 'cloud' }), record('b', at(21, 10), { source: 'stack' }), record('c', at(21, 9), { source: 'cloud' })];
    const list = listOf(rows, { source: 'cloud', more: false });
    expect(list.matched.map((one) => one.id)).toEqual(['a', 'c']);
    expect(listOf(rows, { source: 'nobody', more: false }).items).toEqual([]);
  });

  it('draws the first fifty and says how many are older, and draws them all once asked', () => {
    const rows = Array.from({ length: 120 }, (_, index) => record(`r${String(index)}`, at(21, 11) - index * 60_000));
    const list = listOf(rows, { source: '', more: false });
    expect(SHOWN).toBe(50);
    expect(list.shown).toHaveLength(50);
    expect(list.shown[49]?.id).toBe('r49');
    expect(list.matched).toHaveLength(120);
    expect(list.older).toBe(70);
    expect(list.items.filter((item) => item.kind === 'row')).toHaveLength(50);
    const all = listOf(rows, { source: '', more: true });
    expect(all.shown).toHaveLength(120);
    expect(all.older).toBe(0);
  });

  it('narrows first and then takes the fifty, so the filter never hides a record behind the cut', () => {
    const rows = Array.from({ length: 80 }, (_, index) => record(`r${String(index)}`, at(21, 11) - index * 60_000, { source: index < 60 ? 'cloud' : 'stack' }));
    const list = listOf(rows, { source: 'stack', more: false });
    expect(list.matched).toHaveLength(20);
    expect(list.shown).toHaveLength(20);
    expect(list.older).toBe(0);
  });

  it('does not rebuild a record: the rows are the model\'s own objects', () => {
    const one = record('a', at(21, 11));
    const list = listOf([one], { source: '', more: false });
    const row = list.items.find((item) => item.kind === 'row');
    expect(row?.kind === 'row' && row.record).toBe(one);
  });
});

// WHAT A DAY IS, checked against something that does not know the machine's zone: `Intl` with the zone named. For each zone, the hours around every clock change of 2026 (found by looking at each hour of the year), around the
// end of a month, of a year and of a leap February, hour by hour: every record against every `now`. A day of 23 or 25 hours is one day, a clock change at midnight (Havana, Beirut, Cairo: the hour that is skipped is the first
// of a day, the hour that is repeated is the last of one) is no new day, and the same history is on the same local days of the zone whatever the zone of the machine that runs the test is.
const CLOCK_ZONES: Array<[zone: string, changes: number | undefined]> = [
  ['UTC', 0],
  ['Asia/Kolkata', 0],
  ['Asia/Kathmandu', 0],
  ['Pacific/Kiritimati', 0],
  ['Pacific/Pago_Pago', 0],
  ['Europe/London', 2],
  ['America/New_York', 2],
  ['Australia/Lord_Howe', 2],
  ['Pacific/Chatham', 2],
  // Clock changes at midnight; their rules have changed in the zone database before, so the number of changes is not asserted.
  ['America/Havana', undefined],
  ['Asia/Beirut', undefined],
  ['Africa/Cairo', undefined],
];

const formats = new Map<string, Intl.DateTimeFormat>();
/** The date a zone's calendar shows at an instant, `2026-03-08`: `Intl` with the zone named, not the machine's. */
function civil(time: number, zone: string): string {
  let format = formats.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formats.set(zone, format);
  }

  return format.format(time);
}

/** Whole days from one date to a later one. */
const daysApart = (later: string, earlier: string): number => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY);

/** The instants of a year at which the machine's clock changes: the first hour whose offset is not the hour before's. */
function clockChanges(year: number): number[] {
  const found: number[] = [];
  let before = new Date(Date.UTC(year, 0, 1)).getTimezoneOffset();
  for (let time = Date.UTC(year, 0, 1) + HOUR; time < Date.UTC(year + 1, 0, 1); time += HOUR) {
    const offset = new Date(time).getTimezoneOffset();
    if (offset !== before) {
      found.push(time);
      before = offset;
    }
  }

  return found;
}

/** The middles of the windows to look at: each clock change of 2026, and a plain Sunday, the end of a year, of February and of a leap February. */
const windows = (): number[] => [...clockChanges(2026), Date.UTC(2026, 10, 15, 12), Date.UTC(2026, 11, 31, 12), Date.UTC(2027, 1, 28, 12), Date.UTC(2028, 1, 29, 12)];

/** Every hour from two days before a time to two days after it, oldest first. */
const around = (middle: number): number[] => Array.from({ length: 97 }, (_, index) => middle + (index - 48) * HOUR);

const every = (times: readonly number[], step: number): number[] => times.filter((_, index) => index % step === 0);

describe.each(CLOCK_ZONES)('the days of %s', (zone, changes) => {
  beforeEach(() => {
    vi.stubEnv('TZ', zone);
  });

  it('has the clock changes the other tests are about', () => {
    if (changes !== undefined) {
      expect(clockChanges(2026)).toHaveLength(changes);
    }

    expect(windows().length).toBeGreaterThanOrEqual(4);
  });

  it('says Today, Yesterday or the date by the zone\'s own calendar, for every record against every moment around a clock change and the end of a month or a year', () => {
    const wrong: string[] = [];
    let compared = 0;
    for (const middle of windows()) {
      const times = around(middle);
      for (const now of every(times, 3)) {
        const today = civil(now, zone);
        for (const time of times) {
          const gap = daysApart(today, civil(time, zone));
          const wanted = gap === 0 ? 'Today' : gap === 1 ? 'Yesterday' : new Date(time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone });
          const got = dayLabel(time, now);
          compared += 1;
          if (got !== wanted) {
            wrong.push(`${new Date(time).toISOString()} at ${new Date(now).toISOString()}: ${got}, wanted ${wanted}`);
          }
        }
      }
    }

    expect(wrong.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThan(3000);
  });

  it('starts and ends a local day at the instants the zone\'s calendar changes its date, whether the day has 23, 24 or 25 hours', () => {
    const wrong: string[] = [];
    for (const middle of windows()) {
      for (const now of every(around(middle), 2)) {
        const date = civil(now, zone);
        const start = startOfDay(now);
        const next = startOfNextDay(now);
        if (civil(start, zone) !== date || civil(start - 1, zone) === date) {
          wrong.push(`${new Date(now).toISOString()}: the day starts at ${new Date(start).toISOString()}`);
        }

        if (civil(next - 1, zone) !== date || daysApart(civil(next, zone), date) !== 1) {
          wrong.push(`${new Date(now).toISOString()}: the day ends at ${new Date(next).toISOString()}`);
        }
      }
    }

    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('is one day for as long as the zone says, where its clock changes: 23 hours when it goes forward, 25 when it goes back, and the half hours of Lord Howe', () => {
    for (const change of clockChanges(2026)) {
      const before = new Date(change - HOUR).getTimezoneOffset();
      const after = new Date(change).getTimezoneOffset();
      // `getTimezoneOffset` is UTC minus local, in minutes: when it falls the clock went forward and the day is shorter by that.
      expect(startOfNextDay(change) - startOfDay(change)).toBe(DAY - (before - after) * 60_000);
    }
  });

  it('makes one heading for each local day of the history and puts every row under the heading of its own date', () => {
    for (const middle of windows()) {
      const times = around(middle).reverse();
      const list = listOf(times.map((time, index) => record(`r${String(index)}`, time)), { source: '', more: true });
      const days = list.items.filter((item): item is Extract<Item, { kind: 'day' }> => item.kind === 'day');
      expect(days.map((item) => civil(item.day, zone))).toEqual([...new Set(times.map((time) => civil(time, zone)))]);
      expect(new Set(list.items.map((item) => (item.kind === 'row' ? item.record.id : item.key))).size).toBe(list.items.length);
      let heading = '';
      for (const item of list.items) {
        if (item.kind === 'day') {
          heading = civil(item.day, zone);
        } else if (item.kind === 'row') {
          expect(civil(item.record.createdAt, zone)).toBe(heading);
        }
      }
    }
  });

  it('keeps a day\'s words until the next local midnight, and says when it comes', () => {
    const wrong: string[] = [];
    for (const middle of windows()) {
      const times = around(middle);
      for (const now of every(times, 6)) {
        const next = startOfNextDay(now);
        for (const time of every(times, 2)) {
          const label = dayAge(new Date(time), now);
          if (label.text !== dayLabel(time, now) || label.changesAt !== next || next <= now || dayLabel(time, next - 1) !== label.text) {
            wrong.push(`${new Date(time).toISOString()} at ${new Date(now).toISOString()}: ${JSON.stringify(label)}`);
          }
        }
      }
    }

    expect(wrong.slice(0, 5)).toEqual([]);
  });
});

// A DAY OF 23 OR 25 HOURS, in words: in New York the clocks go forward on the second Sunday of March and back on the first Sunday of November. Each of those days has one heading, is Today all day and Yesterday all
// of the next, and the day before it is not Yesterday on the day after.
const CHANGE_DAYS: Array<[name: string, month: number, day: number, hours: number]> = [
  ['the day the clocks go forward', 2, 8, 23],
  ['the day the clocks go back', 10, 1, 25],
];

describe('a day on which the clocks change', () => {
  it.each(CHANGE_DAYS)('in New York, %s, is one day', (_name, month, day, hours) => {
    vi.stubEnv('TZ', 'America/New_York');
    const when = (dayOfMonth: number, hour: number, minute = 0) => new Date(2026, month, dayOfMonth, hour, minute).getTime();
    expect(startOfNextDay(when(day, 12)) - startOfDay(when(day, 12))).toBe(hours * HOUR);
    const first = when(day, 0, 30);
    const last = when(day, 23, 30);
    const before = when(day - 1, 23, 30);
    const noon = when(day, 12);
    const next = when(day + 1, 10);
    expect([dayLabel(first, noon), dayLabel(last, noon), dayLabel(before, noon)]).toEqual(['Today', 'Today', 'Yesterday']);
    expect([dayLabel(first, next), dayLabel(last, next)]).toEqual(['Yesterday', 'Yesterday']);
    expect(dayLabel(before, next)).not.toBe('Yesterday');
    const list = listOf([record('last', last), record('first', first), record('before', before)], { source: '', more: false });
    expect(outline(list, next)).toEqual(['# Recent', '# Yesterday', 'last', 'first', `# ${dayLabel(before, next)}`, 'before']);
  });

  it('in New York, the hour that is lived twice is one hour of one day: both of its half hours are under the heading of the 1st', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const firstHalf = new Date(2026, 10, 1, 1, 30).getTime();
    const secondHalf = firstHalf + HOUR;
    expect(new Date(secondHalf).getHours()).toBe(1);
    const list = listOf([record('b', secondHalf), record('a', firstHalf)], { source: '', more: false });
    expect(outline(list, new Date(2026, 10, 1, 12).getTime())).toEqual(['# Recent', '# Today', 'b', 'a']);
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
