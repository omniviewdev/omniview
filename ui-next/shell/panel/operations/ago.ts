import type { AgeFormatter } from '@omniviewdev/kit';

// The words of the Started column (ch16 S122): the mock's `ago` (shell-panel.js:135: "just now", "N min ago", "N h ago", "N d ago") as a rule for the page's one age clock (`useAge`: the clock asks for the words and for the instant
// they change, and sleeps until then, so a column of 200 starts costs one timer). The rule is the mock's, with its roundings in its order: the elapsed time to a second, "just now" below 45 s, then the nearest minute, the nearest hour
// OF THAT MINUTE COUNT, the nearest day OF THAT HOUR COUNT. It is not the kit's age, which floors one unit: the mock is the reference of the words, and a row says what the mock says at every instant (a start 90 s old is "2 min ago").
// Only `changesAt` is not the mock's: it is what the clock needs, and it is the first instant at which the mock says other words.

const SECOND = 1000;

/**
 * How long ago the host first had the record, as the mock says it. A start that is ahead of this window's clock (the host's and the window's disagree by a moment) reads "just now": an age is never negative. A day is 24 hours, with no
 * calendar and no daylight-saving rule. A date that is not a date has no words and never changes.
 *
 * `changesAt` is exact. The mock rounds the elapsed time to a whole second, and `n` seconds are reached at the half second before `n`. Each count is reached where the one below it, rounded, reaches the half of its unit: the minute count
 * `m` when the seconds reach 60 m - 30, the hour count `h` when the minutes reach 60 h - 30 (the seconds reach 3,600 h - 1,830) and the day count `d` when the hours reach 24 d - 12 (the seconds reach 86,400 d - 45,030). So a label lasts
 * until the next count is reached: 45 s for "just now", 60 m + 30 s for "m min ago", 3,600 h + 1,770 s for "h h ago" and 86,400 d + 41,370 s for "d d ago". The words hold up to the millisecond before it, and are others at it.
 */
export const ago: AgeFormatter = (date, now) => {
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return { text: '', changesAt: Infinity };
  }

  /** These words, until the elapsed time reaches `until` seconds: its first millisecond is the half of a second before it. */
  const said = (text: string, until: number) => ({ text, changesAt: time + until * SECOND - SECOND / 2 });
  const seconds = Math.max(0, Math.round((now - time) / SECOND));
  if (seconds < 45) {
    return said('just now', 45);
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return said(`${String(minutes)} min ago`, 60 * minutes + 30);
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return said(`${String(hours)} h ago`, 3600 * hours + 1770);
  }

  const days = Math.round(hours / 24);
  return said(`${String(days)} d ago`, 86_400 * days + 41_370);
};

/**
 * The tip of a start: the absolute instant, as the mock says it (`H.tip(stamp(...))`, shell-panel.js:2324; `stamp` is shell-panel.js:133): the medium date and the medium time, seconds included, in the time zone and the language of the
 * machine, which is what `toLocaleString(undefined, ...)` gives and what a person reads on their own clock. `locale` is for a test that must not depend on the machine's language; the page never gives one. It carries no words of its own: the
 * cell's words are the mock's rule, and a second rule in the tip would disagree with them for a start 90 s old. A time that is not a time has no stamp.
 */
export function stampOf(at: number, locale?: string): string {
  const instant = new Date(at);
  return Number.isNaN(instant.getTime()) ? '' : instant.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' });
}
