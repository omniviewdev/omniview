import type { AgeFormatter } from './ageClock';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The compact label of the design mock (`compactAge`, `Cell.age`; design 13 D5): ONE unit, floored. `17d` from 86,400 s, `5h` from
 * 3,600 s, `12m` from 60 s, else `45s`; never negative. A timestamp in the future reads `in 5m`, with the same units. A day is 86,400
 * seconds: no calendar day, no time zone and no daylight-saving rule is involved.
 *
 * `changesAt` is exact for whole-millisecond arguments. A past label holds until the next whole unit after the timestamp. A future
 * label holds while the time remaining is at least `count` units, so `in 5m` becomes `in 4m` one millisecond after the remaining
 * time falls to 299,999 ms; `in 0s` becomes `0s` at the timestamp. Either way the text changes exactly there, so `changesAt` is
 * both the first instant of the new text and the first instant the old one is wrong.
 */
export const compactAge: AgeFormatter = (date, now) => {
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return { text: '', changesAt: Infinity };
  }

  const elapsed = now - time;
  const past = elapsed >= 0;
  const span = Math.abs(elapsed);
  const unit = span >= DAY ? DAY : span >= HOUR ? HOUR : span >= MINUTE ? MINUTE : SECOND;
  const count = Math.floor(span / unit);
  const name = unit === DAY ? 'd' : unit === HOUR ? 'h' : unit === MINUTE ? 'm' : 's';
  if (past) {
    return { text: `${count}${name}`, changesAt: time + (count + 1) * unit };
  }

  return { text: `in ${count}${name}`, changesAt: count === 0 ? time : time - count * unit + 1 };
};

const counted = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

/** The span in words, one unit and floored: minutes under an hour, hours under a day, days under 60, months under 730 days, then years. */
function wordsOf(seconds: number): string {
  if (seconds < 3600) {
    return counted(Math.max(1, Math.floor(seconds / 60)), 'minute');
  }

  if (seconds < 86_400) {
    return counted(Math.floor(seconds / 3600), 'hour');
  }

  if (seconds < 86_400 * 60) {
    return counted(Math.floor(seconds / 86_400), 'day');
  }

  if (seconds < 86_400 * 730) {
    return counted(Math.floor(seconds / 86_400 / 30), 'month');
  }

  return counted(Math.floor(seconds / 86_400 / 365), 'year');
}

/**
 * The long text of the mock's Age tip: the instant in UTC and the span in words, `2026-11-14 11:03 UTC · 2 days ago`. UTC always,
 * never the viewer's local time. Empty for an invalid date.
 */
export function ageTip(date: Date, now: number): string {
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return '';
  }

  const stamp = `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const delta = (now - time) / SECOND;
  const seconds = Math.abs(delta);
  if (delta < 0) {
    return `${stamp} · ${seconds < 60 ? 'now' : `in ${wordsOf(seconds)}`}`;
  }

  return `${stamp} · ${seconds < 60 ? 'just now' : `${wordsOf(seconds)} ago`}`;
}
