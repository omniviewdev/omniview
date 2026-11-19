// The words of the status strip (the mock's `statText`, S120): how many lines, how fast, where the list is, and what was dropped. A pure function of
// numbers; the strip is its only reader.
export type StatInput = {
  /** Lines the view shows (after the level filter). */
  readonly shown: number;
  /** Lines the view holds. */
  readonly total: number;
  /** Lines a second over the last few seconds. */
  readonly rate: number;
  /** Whether the stream is still going: a log that is over has no rate and no end to follow. */
  readonly live: boolean;
  readonly paused: boolean;
  /** Lines the feed holds while it is paused. */
  readonly held: number;
  readonly following: boolean;
  /** Lines that came while the list was scrolled back. */
  readonly unseen: number;
  /** Older lines the view dropped to stay within its bound. */
  readonly dropped: number;
};

const NUMBER = new Intl.NumberFormat('en-US');
const RATE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const plural = (count: number, word: string): string => `${NUMBER.format(count)} ${word}${count === 1 ? '' : 's'}`;

/** The strip's text: parts separated by a middle dot, from the count to what was dropped. */
export function statText({ shown, total, rate, live, paused, held, following, unseen, dropped }: StatInput): string {
  const parts = [shown === total ? plural(total, 'line') : `${NUMBER.format(shown)} of ${plural(total, 'line')}`];
  if (live) {
    parts.push(`${RATE.format(rate)} lines/s`);
  }

  if (paused) {
    parts.push(held > 0 ? `Paused, ${plural(held, 'new line')} waiting` : 'Paused');
  } else if (!following) {
    parts.push(unseen > 0 ? `Scrolled back, ${plural(unseen, 'new line')}` : 'Scrolled back');
  } else if (live) {
    parts.push('Following');
  }

  if (dropped > 0) {
    parts.push(`${plural(dropped, 'older line')} dropped`);
  }

  return parts.join(' · ');
}
