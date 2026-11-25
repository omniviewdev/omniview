import type { ActivityProgress } from '../activity';
import type { ProgressFace } from './types';

// What a row of Operations says of how far the work is (ch16 S122; the mock's `progressFace`, shell-panel.js:2268, "the record's own progress, never a percentage the panel derived (X6)"): the producer's words, and the
// part of the 4 px bar that is done. The producer's numbers are decimal STRINGS (`ActivityProgress`: a counter of the host's is a uint64, which a double cannot hold), so the arithmetic is BigInt and exact for a count of any
// size, and the bar is told a fraction of at most six decimals, never a ratio of two doubles that may both be rounded to the same number.

const DIGITS = /^[0-9]+$/;

/** The finest part of the bar the model says: a millionth. A part below it is nothing yet: it is truncated, never rounded up, so a bar is full only when the work is. */
const SCALE = 1_000_000;

/**
 * A count in the producer's own words, with its thousands grouped by a comma as the mock's `num()` and the collection footer do (the kit's `grouped`: `BigInt.toLocaleString`, exact for any size). Whatever is not decimal digits is not a
 * count and is said as it came.
 */
const say = (value: string): string => (DIGITS.test(value) ? BigInt(value).toLocaleString('en-US') : value);

/** `min(current, total) / total`, exactly; `undefined` when either number is not decimal digits or the whole is zero (a part of nothing). */
function fractionOf(current: string, total: string): number | undefined {
  if (!DIGITS.test(current) || !DIGITS.test(total)) {
    return undefined;
  }

  const whole = BigInt(total);
  if (whole === 0n) {
    return undefined;
  }

  const done = BigInt(current);
  return Number(((done < whole ? done : whole) * BigInt(SCALE)) / whole) / SCALE;
}

/**
 * The face of a progress: `units` read "<current> of <total> <unit>" (a unit of `%` reads "<current>%", and no unit "<current> of <total>"), `steps` read "<current> of <total>". Work that cannot be measured (`indeterminate`) and
 * work that said nothing have no face: the table draws a dash, never a bar that moves and says nothing.
 */
export function progressOf(progress: ActivityProgress | undefined): ProgressFace | undefined {
  if (progress === undefined || progress.kind === 'indeterminate') {
    return undefined;
  }

  const { current, total } = progress;
  const fraction = fractionOf(current, total);
  if (progress.kind === 'steps') {
    return { text: `${say(current)} of ${say(total)}`, fraction };
  }

  if (progress.unit === '%') {
    return { text: `${say(current)}%`, fraction };
  }

  return { text: `${say(current)} of ${say(total)}${progress.unit === '' ? '' : ` ${progress.unit}`}`, fraction };
}
