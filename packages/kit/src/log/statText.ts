// The words of the status strip (the mock's `statText`, S120): how many lines, how fast, where the list is, and what was dropped. A pure function of
// numbers; the strip is its only reader.
export type StatInput = {
  /** Lines the view shows (after the level filter). */
  readonly shown: number;
  /** Lines the view holds. */
  readonly total: number;
  /** Lines a second over the last few seconds; undefined when the feed has no count to tell it from (its sources are replaying, or it never says): the strip says so, and not 0.0. */
  readonly rate: number | undefined;
  /** Whether the stream is still going: a log that is over has no rate and no end to follow. */
  readonly live: boolean;
  readonly paused: boolean;
  /** Lines the feed holds while it is paused. */
  readonly held: number;
  readonly following: boolean;
  /** Lines that came while the list was scrolled back. */
  readonly unseen: number;
  /** Lines that were dropped and are not in the view: the ones the view evicted to stay within its bound and the ones the feed dropped before the view read them. */
  readonly dropped: number;
  /** Of `dropped`, the lines the feed dropped before the view read them: only the note says it. */
  readonly unread: number;
  /** The most lines the view keeps: only the note says it. */
  readonly capacity: number;
};

const NUMBER = new Intl.NumberFormat('en-US');
const RATE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const plural = (count: number, word: string): string => `${NUMBER.format(count)} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the strip says where the rate would be when none is known: the mock's words for a rate that is absent (cat-msg-c-eventbridge4.js:91, `['Rate', r.rate ? `${M.nf(r.rate)}/s` : EB.none('No rate')]`, the dash of
 * its `H.none` named "No rate"). A source that writes nothing reads 0.0 lines/s, and that is a known rate; this is the rate nobody has said.
 */
export const NO_RATE = 'No rate';

/**
 * What the one number of dropped lines is made of, for the tooltip and the accessible description of the strip's text; undefined while nothing was dropped. The strip says one
 * total in the mock's words ("N older lines dropped"); a person who wants to know whether the lines were ever on screen finds it here: the lines the feed dropped never were, and the ones
 * the view evicted had been.
 */
export function droppedNote({ dropped, unread, capacity }: Pick<StatInput, 'dropped' | 'unread' | 'capacity'>): string | undefined {
  if (dropped <= 0) {
    return undefined;
  }

  const evicted = dropped - unread;
  const sentences: string[] = [];
  if (unread > 0) {
    sentences.push(`${plural(unread, 'line')} never reached the view: the feed held too many while the view was not reading.`);
  }

  if (evicted > 0) {
    sentences.push(`${plural(evicted, 'older line')} ${evicted === 1 ? 'was' : 'were'} pushed out of the view, which keeps the latest ${NUMBER.format(capacity)}.`);
  }

  return sentences.join(' ');
}

/** The strip's text: parts separated by a middle dot, from the count to what was dropped. */
export function statText({ shown, total, rate, live, paused, held, following, unseen, dropped }: StatInput): string {
  const parts = [shown === total ? plural(total, 'line') : `${NUMBER.format(shown)} of ${plural(total, 'line')}`];
  if (live) {
    parts.push(rate === undefined ? NO_RATE : `${RATE.format(rate)} lines/s`);
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
