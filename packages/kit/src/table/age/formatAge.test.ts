import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageTip, compactAge } from './formatAge';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const T = Date.UTC(2026, 10, 16, 14, 3, 0);
const text = (age: number) => compactAge(new Date(T), T + age).text;
const futureText = (remaining: number) => compactAge(new Date(T), T - remaining).text;

describe('compactAge: the label is one unit, floored (design 13 D5)', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [1000, '1s'],
    [45 * SECOND, '45s'],
    [59_999, '59s'],
    [60_000, '1m'],
    [12 * MINUTE + 59_999, '12m'],
    [HOUR - 1, '59m'],
    [HOUR, '1h'],
    [5 * HOUR + 30 * MINUTE, '5h'],
    [DAY - 1, '23h'],
    [DAY, '1d'],
    [17 * DAY + 5 * HOUR, '17d'],
    [400 * DAY, '400d'],
  ])('a past age of %i ms reads %s', (age, label) => {
    expect(text(age)).toBe(label);
  });

  it.each([
    [1, 'in 0s'],
    [999, 'in 0s'],
    [1000, 'in 1s'],
    [59_999, 'in 59s'],
    [5 * MINUTE, 'in 5m'],
    [5 * MINUTE + 59_999, 'in 5m'],
    [HOUR, 'in 1h'],
    [DAY, 'in 1d'],
    [3 * DAY - 1, 'in 2d'],
  ])('a future timestamp %i ms ahead reads %s', (remaining, label) => {
    expect(futureText(remaining)).toBe(label);
  });

  it('never reads a negative number, and a timestamp at the present reads 0s', () => {
    expect(text(0)).toBe('0s');
    expect(futureText(1)).toBe('in 0s');
  });

  it('counts a day as 86,400 seconds: no calendar days, no daylight-saving rule', () => {
    expect(text(DAY - 1)).toBe('23h');
    expect(text(DAY)).toBe('1d');
    expect(text(2 * DAY - 1)).toBe('1d');
    expect(text(2 * DAY)).toBe('2d');
  });

  it('gives an invalid date no label and no change', () => {
    expect(compactAge(new Date(Number.NaN), T)).toEqual({ text: '', changesAt: Infinity });
  });
});

describe('compactAge: changesAt', () => {
  it('is the next whole unit after the timestamp for a past age', () => {
    expect(compactAge(new Date(T), T).changesAt).toBe(T + SECOND);
    expect(compactAge(new Date(T), T + 5250).changesAt).toBe(T + 6 * SECOND);
    expect(compactAge(new Date(T), T + 59_500).changesAt).toBe(T + MINUTE);
    expect(compactAge(new Date(T), T + 5 * MINUTE + 20 * SECOND).changesAt).toBe(T + 6 * MINUTE);
    expect(compactAge(new Date(T), T + HOUR + 1).changesAt).toBe(T + 2 * HOUR);
    expect(compactAge(new Date(T), T + 3 * DAY + 1).changesAt).toBe(T + 4 * DAY);
  });

  it('is the moment the remaining time drops below a whole unit for a future timestamp', () => {
    // `in 5m` holds for 300,000 ms down to 240,000 ms ahead; one millisecond later it is `in 4m`.
    expect(compactAge(new Date(T), T - 5 * MINUTE).changesAt).toBe(T - 5 * MINUTE + 1);
    expect(compactAge(new Date(T), T - 5 * MINUTE - 500).changesAt).toBe(T - 5 * MINUTE + 1);
    // `in 1m` becomes `in 59s`; `in 1h` becomes `in 59m`; `in 1d` becomes `in 23h`.
    expect(futureText(MINUTE)).toBe('in 1m');
    expect(compactAge(new Date(T), T - MINUTE).changesAt).toBe(T - MINUTE + 1);
    expect(compactAge(new Date(T), T - HOUR).changesAt).toBe(T - HOUR + 1);
    expect(compactAge(new Date(T), T - DAY).changesAt).toBe(T - DAY + 1);
    // `in 0s` becomes `0s` at the timestamp itself.
    expect(compactAge(new Date(T), T - 400).changesAt).toBe(T);
  });

  it('is always after now', () => {
    for (const offset of [-3 * DAY, -DAY, -HOUR, -MINUTE, -1, 0, 1, SECOND, MINUTE, HOUR, DAY, 40 * DAY]) {
      expect(compactAge(new Date(T), T + offset).changesAt).toBeGreaterThan(T + offset);
    }
  });
});

/**
 * Walks `now` one second at a time. Whenever the text changes, the previous label must have named a change at or before that second
 * and after the one before it; while the text holds, `changesAt` must lie ahead. At every change, the exact millisecond is checked:
 * the old text holds at `changesAt - 1` and a different text reads at `changesAt`.
 */
function walk(timestamp: number, from: number, seconds: number): number {
  const date = new Date(timestamp);
  let previous = compactAge(date, from);
  let changes = 0;
  for (let step = 1; step <= seconds; step++) {
    const now = from + step * SECOND;
    const current = compactAge(date, now);
    expect(current.changesAt).toBeGreaterThan(now);
    if (now < previous.changesAt) {
      if (current.text !== previous.text) {
        throw new Error(`text changed at ${now} before changesAt ${previous.changesAt}`);
      }
    } else {
      if (current.text === previous.text) {
        throw new Error(`text held at ${now} past changesAt ${previous.changesAt}`);
      }

      if (previous.changesAt <= now - SECOND) {
        throw new Error(`changesAt ${previous.changesAt} was missed by more than a second`);
      }

      expect(compactAge(date, previous.changesAt - 1).text).toBe(previous.text);
      expect(compactAge(date, previous.changesAt).text).not.toBe(previous.text);
      previous = current;
      changes++;
    }
  }

  return changes;
}

describe('compactAge: the label changes exactly when changesAt says', () => {
  it.each([0, 250, 999])('walks a past day second by second (grid offset %i ms)', (offset) => {
    // 60 second labels, 59 minute labels, 23 hour labels, then 1d: 143 labels, 142 changes.
    expect(walk(T, T + offset, DAY / SECOND + 5)).toBe(142);
  });

  it.each([0, 250, 999])('walks the last day before a future timestamp (grid offset %i ms)', (offset) => {
    walk(T, T - DAY - 5 * SECOND + offset, DAY / SECOND + 10);
  });
});

describe('compactAge: daylight-saving dates of America/New_York change nothing', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (zone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = zone;
    }
  });

  // 2026-03-08 07:00 UTC is 02:00 EST turning into 03:00 EDT; 2026-11-01 06:00 UTC is 02:00 EDT turning back to 01:00 EST.
  const spring = Date.UTC(2026, 2, 8, 7);
  const fall = Date.UTC(2026, 10, 1, 6);
  const transitions = [spring, fall];

  it('runs with the zone on, and the zone does have both transitions', () => {
    expect(new Date(spring - HOUR).getTimezoneOffset()).toBe(300);
    expect(new Date(spring + HOUR).getTimezoneOffset()).toBe(240);
    expect(new Date(fall - HOUR).getTimezoneOffset()).toBe(240);
    expect(new Date(fall + HOUR).getTimezoneOffset()).toBe(300);
  });

  it.each(transitions)('a day is 86,400 s on both sides of the transition at %i', (transition) => {
    const start = transition - DAY - 30 * MINUTE;
    expect(compactAge(new Date(start), start + DAY - 1).text).toBe('23h');
    expect(compactAge(new Date(start), start + DAY).text).toBe('1d');
    expect(compactAge(new Date(start), start + 2 * DAY - 1).text).toBe('1d');
    expect(compactAge(new Date(start), start + 2 * DAY).text).toBe('2d');
  });

  it.each(transitions)('walks the two days around the transition at %i, past and future', (transition) => {
    walk(transition - DAY, transition - DAY, (2 * DAY) / SECOND);
    walk(transition, transition - 2 * DAY, (2 * DAY) / SECOND);
    walk(transition - 1500, transition - 1500 - 30 * HOUR, (60 * HOUR) / SECOND);
  });
});

describe('ageTip: the long text, in UTC', () => {
  const tip = (age: number) => ageTip(new Date(T), T + age);

  it('reads the stamp and the words, the mock way (stampOf, agoText, untilText)', () => {
    expect(tip(2 * DAY + 3 * HOUR)).toBe('2026-11-16 14:03 UTC · 2 days ago');
    expect(tip(30 * SECOND)).toBe('2026-11-16 14:03 UTC · just now');
    expect(tip(0)).toBe('2026-11-16 14:03 UTC · just now');
    expect(tip(MINUTE)).toBe('2026-11-16 14:03 UTC · 1 minute ago');
    expect(tip(17 * MINUTE)).toBe('2026-11-16 14:03 UTC · 17 minutes ago');
    expect(tip(HOUR)).toBe('2026-11-16 14:03 UTC · 1 hour ago');
    expect(tip(23 * HOUR)).toBe('2026-11-16 14:03 UTC · 23 hours ago');
    expect(tip(DAY)).toBe('2026-11-16 14:03 UTC · 1 day ago');
    expect(tip(59 * DAY)).toBe('2026-11-16 14:03 UTC · 59 days ago');
    expect(tip(60 * DAY)).toBe('2026-11-16 14:03 UTC · 2 months ago');
    expect(tip(729 * DAY)).toBe('2026-11-16 14:03 UTC · 24 months ago');
    expect(tip(730 * DAY)).toBe('2026-11-16 14:03 UTC · 2 years ago');
  });

  it('reads a timestamp in the future as "in ..." and "now"', () => {
    expect(tip(-30 * SECOND)).toBe('2026-11-16 14:03 UTC · now');
    expect(tip(-5 * MINUTE)).toBe('2026-11-16 14:03 UTC · in 5 minutes');
    expect(tip(-2 * HOUR)).toBe('2026-11-16 14:03 UTC · in 2 hours');
    expect(tip(-3 * DAY)).toBe('2026-11-16 14:03 UTC · in 3 days');
  });

  it('is empty for an invalid date', () => {
    expect(ageTip(new Date(Number.NaN), T)).toBe('');
  });

  describe('in another time zone', () => {
    const zone = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'Asia/Tokyo';
    });
    afterAll(() => {
      if (zone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = zone;
      }
    });

    it('still reads UTC, never local time', () => {
      expect(new Date(T).getTimezoneOffset()).toBe(-540);
      expect(tip(DAY)).toBe('2026-11-16 14:03 UTC · 1 day ago');
    });
  });
});
