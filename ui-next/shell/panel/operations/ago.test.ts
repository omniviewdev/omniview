import { act, cleanup, renderHook } from '@testing-library/react';
import { useAge } from '@omniviewdev/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, stampOf } from './ago';

// The words of the Started column: the mock's `ago` (shell-panel.js:135: "just now", "N min ago", "N h ago", "N d ago") as a rule for the page's one age clock (`AgeFormatter`: the clock asks for the text and for the instant it
// changes, and sleeps until then). The mock ROUNDS and this is the same rule: the elapsed time to a second, "just now" below 45 s, the nearest minute, the nearest hour OF THAT MINUTE COUNT, the nearest day OF THAT HOUR COUNT. A row reads
// what the mock reads at every instant; `changesAt` is what the clock needs besides, and the mock's own function is the oracle of both: no value below is held up by anything but that function.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The mock's function (`app/OmniviewNativeLab/frontend/mock/shell-panel.js:135`), step for step: the same roundings in the same order. Only its layout is this file's. */
function mockAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) {
    return 'just now';
  }

  const m = Math.round(s / 60);
  if (m < 60) {
    return `${String(m)} min ago`;
  }

  const h = Math.round(m / 60);
  if (h < 24) {
    return `${String(h)} h ago`;
  }

  return `${String(Math.round(h / 24))} d ago`;
}

/** The first instant after `now` at which the mock says other words than it says at `now`, found by bisection: its words never go back, and a label lasts a day at the longest. */
function mockChange(start: number, now: number): number {
  const words = mockAgo(start, now);
  let held = now;
  let changed = now + 3 * DAY;
  while (changed - held > 1) {
    const middle = Math.floor((held + changed) / 2);
    if (mockAgo(start, middle) === words) {
      held = middle;
    } else {
      changed = middle;
    }
  }

  return changed;
}

const T = Date.UTC(2026, 10, 24, 10, 0, 0);
const date = new Date(T);
const text = (age: number) => ago(date, T + age).text;

describe('ago: the words', () => {
  // The mock rounds the elapsed time to a second first, so a second counts from its half: 44.499 s is 44 s and 44.5 s is 45 s.
  it.each([
    [0, 'just now'],
    [1, 'just now'],
    [44 * SECOND, 'just now'],
    [44_499, 'just now'],
    [44_500, '1 min ago'],
    [45 * SECOND, '1 min ago'],
    [59 * SECOND, '1 min ago'],
    [60 * SECOND, '1 min ago'],
    [89 * SECOND, '1 min ago'],
    [89_499, '1 min ago'],
    [89_500, '2 min ago'],
    [90 * SECOND, '2 min ago'],
    [2 * MINUTE, '2 min ago'],
    [17 * MINUTE + 40 * SECOND, '18 min ago'],
    [59 * MINUTE + 29 * SECOND, '59 min ago'],
    [59 * MINUTE + 29_499, '59 min ago'],
    [59 * MINUTE + 29_500, '1 h ago'],
    [59 * MINUTE + 30 * SECOND, '1 h ago'],
    [HOUR, '1 h ago'],
    [89 * MINUTE + 29 * SECOND, '1 h ago'],
    [89 * MINUTE + 30 * SECOND, '2 h ago'],
    [5 * HOUR + 29 * MINUTE, '5 h ago'],
    [5 * HOUR + 30 * MINUTE, '6 h ago'],
    [23 * HOUR + 29 * MINUTE + 29 * SECOND, '23 h ago'],
    [23 * HOUR + 29 * MINUTE + 30 * SECOND, '1 d ago'],
    [DAY, '1 d ago'],
    [35 * HOUR + 29 * MINUTE + 29 * SECOND, '1 d ago'],
    [35 * HOUR + 29 * MINUTE + 30 * SECOND, '2 d ago'],
    [2 * DAY, '2 d ago'],
    [17 * DAY + 5 * HOUR, '17 d ago'],
    [400 * DAY, '400 d ago'],
  ])('a start %i ms ago reads %s', (age, words) => {
    expect(text(age)).toBe(words);
  });

  it('reads "just now" for a start that is ahead of the clock (the host and the window disagree by a moment): never a negative age', () => {
    expect(text(-1)).toBe('just now');
    expect(text(-30 * SECOND)).toBe('just now');
    expect(text(-3 * DAY)).toBe('just now');
  });

  it('says nothing for a date that is not a date, and never changes it', () => {
    expect(ago(new Date(Number.NaN), T)).toEqual({ text: '', changesAt: Infinity });
  });
});

describe('ago: the mock\'s function is its oracle', () => {
  type Disagreement = { readonly age: number; readonly said: string; readonly mock: string };

  /** The ages where `text` says other than the mock does, the first few of them: an empty list is the claim. */
  function disagreements(ages: Iterable<number>): Disagreement[] {
    const found: Disagreement[] = [];
    for (const age of ages) {
      const said = text(age);
      const mock = mockAgo(T, T + age);
      if (said !== mock && found.length < 5) {
        found.push({ age, said, mock });
      }
    }

    return found;
  }

  function* ages(from: number, to: number, step: number, offset: number): Generator<number> {
    for (let age = from; age <= to; age += step) {
      yield age + offset;
    }
  }

  it.each([0, 1, 250, 499, 500, 501, 999])('says what the mock says at every second of the first 40 hours, with the clock %i ms into the second', (offset) => {
    expect(disagreements(ages(0, 40 * HOUR, SECOND, offset))).toEqual([]);
  });

  it('says what the mock says for the starts that are days and years old, and for the ones ahead of the clock', () => {
    expect(disagreements(ages(40 * HOUR, 1000 * DAY, 7 * MINUTE + 13 * SECOND + 501, 0))).toEqual([]);
    expect(disagreements(ages(-3 * DAY, -1, 9 * SECOND + 7, 0))).toEqual([]);
  });

  it('says what the mock says at every instant where its words change, and at the one before it', () => {
    // The changes of the first 3 days, as the mock says them: to 1 min, 58 more minutes, 1 h, 22 more hours, and 1, 2 and 3 days.
    const instants: number[] = [];
    for (let at = mockChange(T, T); at - T < 3 * DAY; at = mockChange(T, at)) {
      instants.push(at - T);
    }

    expect(instants).toHaveLength(85);
    expect(disagreements(instants.flatMap((instant) => [instant - 1, instant]))).toEqual([]);
  });
});

describe('ago: changesAt', () => {
  it.each([
    [0, 44_500],
    [44_499, 44_500],
    [44_500, 89_500],
    [89_499, 89_500],
    [89_500, 149_500],
    [17 * MINUTE + 40 * SECOND, 18 * MINUTE + 29_500],
    [59 * MINUTE + 29_499, 59 * MINUTE + 29_500],
    [59 * MINUTE + 29_500, 89 * MINUTE + 29_500],
    [89 * MINUTE + 29_999, 149 * MINUTE + 29_500],
    [5 * HOUR + 29 * MINUTE, 5 * HOUR + 29 * MINUTE + 29_500],
    [23 * HOUR + 29 * MINUTE + 29_499, 23 * HOUR + 29 * MINUTE + 29_500],
    [23 * HOUR + 29 * MINUTE + 29_500, 35 * HOUR + 29 * MINUTE + 29_500],
    [35 * HOUR + 29 * MINUTE + 29_500, 59 * HOUR + 29 * MINUTE + 29_500],
    [17 * DAY + 5 * HOUR, 17 * DAY + 11 * HOUR + 29 * MINUTE + 29_500],
  ])('with the clock %i ms after the start, the next words begin at %i ms', (age, changes) => {
    expect(ago(date, T + age).changesAt).toBe(T + changes);
  });

  it('is the instant at which the mock says other words, from every age of a sweep of the first 30 hours and three days past them', () => {
    const wrong: Array<{ readonly age: number; readonly changesAt: number; readonly mock: number }> = [];
    for (let age = -MINUTE; age <= 30 * HOUR + 3 * DAY; age += 4_999 + (age % 7)) {
      const { changesAt } = ago(date, T + age);
      const mock = mockChange(T, T + age);
      if (changesAt !== mock && wrong.length < 5) {
        wrong.push({ age, changesAt: changesAt - T, mock: mock - T });
      }
    }

    expect(wrong).toEqual([]);
  });

  it('is exact: the words hold to the millisecond before it and are the mock\'s others at it, at every instant where the mock\'s words change', () => {
    const wrong: number[] = [];
    for (let at = mockChange(T, T); at - T < 3 * DAY; at = mockChange(T, at)) {
      const before = ago(date, at - 1);
      if (before.changesAt !== at || before.text !== mockAgo(T, at - 1) || ago(date, at).text === before.text) {
        wrong.push(at - T);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('is after now for a start that is ahead of the clock, so the clock never wakes in a loop', () => {
    for (const offset of [-3 * DAY, -HOUR, -MINUTE, -30 * SECOND, -1]) {
      expect(ago(date, T + offset).changesAt).toBeGreaterThan(T + offset);
    }
  });

  /**
   * Walks `now` one step at a time. Whenever the words change, the label before must have named a change at or before that step and after the one before it; while they hold, `changesAt` lies ahead. At each change the exact
   * millisecond is checked too. Returns how many times the words changed.
   */
  function walk(from: number, span: number, step: number): number {
    let previous = ago(date, from);
    let changes = 0;
    for (let now = from + step; now <= from + span; now += step) {
      const current = ago(date, now);
      if (current.changesAt <= now) {
        throw new Error(`changesAt ${String(current.changesAt)} is not after ${String(now)}`);
      }

      if (now < previous.changesAt) {
        if (current.text !== previous.text) {
          throw new Error(`the words changed at ${String(now)}, before changesAt ${String(previous.changesAt)}`);
        }
      } else {
        if (current.text === previous.text) {
          throw new Error(`the words held at ${String(now)}, past changesAt ${String(previous.changesAt)}`);
        }

        if (previous.changesAt <= now - step) {
          throw new Error(`changesAt ${String(previous.changesAt)} was missed by more than a step`);
        }

        if (ago(date, previous.changesAt - 1).text !== previous.text || ago(date, previous.changesAt).text === previous.text) {
          throw new Error(`the words did not change exactly at ${String(previous.changesAt)}`);
        }

        previous = current;
        changes++;
      }
    }

    return changes;
  }

  it.each([0, 250, 999])('walks the first 40 hours second by second and changes exactly where it says (grid offset %i ms)', (offset) => {
    // "just now", then 59 minute labels, 23 hour labels, a day and the second day: 85 labels, 84 changes.
    expect(walk(T + offset, 40 * HOUR, SECOND)).toBe(84);
  });

  it('walks 400 days a minute at a time and changes exactly where it says: a day label lasts a day', () => {
    // 85 labels to the second day, then one for each day to the 400th: 84 + 398 changes.
    expect(walk(T, 400 * DAY, MINUTE)).toBe(84 + 398);
  });
});

describe('ago: the age clock of the page reads it', () => {
  /** How far the page's clock has moved since the start of the record, which is the instant the test began. */
  let elapsed = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    elapsed = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Moves the page's clock to `age` ms after the start. */
  const to = (age: number) => {
    act(() => {
      vi.advanceTimersByTime(age - elapsed);
    });
    elapsed = age;
  };

  it('turns "just now" into "1 min ago" at the half of the 45th second, and no earlier', () => {
    const { result } = renderHook(() => useAge(T, ago));
    expect(result.current).toBe('just now');
    to(44_499);
    expect(result.current).toBe('just now');
    to(44_500);
    expect(result.current).toBe('1 min ago');
  });

  it('turns "1 min ago" into "2 min ago" at the half of the 90th second', () => {
    const { result } = renderHook(() => useAge(T, ago));
    to(89_499);
    expect(result.current).toBe('1 min ago');
    to(89_500);
    expect(result.current).toBe('2 min ago');
  });

  it('turns "59 min ago" into "1 h ago" at the half of the 3,570th second, and "23 h ago" into "1 d ago" at the half of the 84,570th', () => {
    const { result } = renderHook(() => useAge(T, ago));
    to(59 * MINUTE + 29_499);
    expect(result.current).toBe('59 min ago');
    to(59 * MINUTE + 29_500);
    expect(result.current).toBe('1 h ago');
    to(23 * HOUR + 29 * MINUTE + 29_499);
    expect(result.current).toBe('23 h ago');
    to(23 * HOUR + 29 * MINUTE + 29_500);
    expect(result.current).toBe('1 d ago');
  });
});

describe('stampOf: the absolute start, in UTC', () => {
  it('is the instant in UTC to the minute, as the kit writes the stamp of an age: the tip of the words', () => {
    expect(stampOf(T)).toBe('2026-11-24 10:00 UTC');
    expect(stampOf(T + 59_999)).toBe('2026-11-24 10:00 UTC');
    expect(stampOf(T + MINUTE)).toBe('2026-11-24 10:01 UTC');
  });

  it('is UTC whatever the time zone of the machine is: the day turns at the midnight of UTC', () => {
    expect(stampOf(Date.UTC(2026, 10, 24, 23, 59, 59))).toBe('2026-11-24 23:59 UTC');
    expect(stampOf(Date.UTC(2026, 10, 25, 0, 0, 0))).toBe('2026-11-25 00:00 UTC');
    expect(stampOf(Date.UTC(2027, 0, 1, 0, 0, 0))).toBe('2027-01-01 00:00 UTC');
  });

  it('is nothing for a time that is not a time', () => {
    expect(stampOf(Number.NaN)).toBe('');
    expect(stampOf(Number.POSITIVE_INFINITY)).toBe('');
    expect(stampOf(8.64e15 + 1)).toBe('');
  });
});
