/**
 * Exact decimal arithmetic on the digits of a number, for the stepper. A number's text is read as an integer and a scale (`digits` times ten to the
 * power of minus `scale`), so that deciding whether a value is on the grid of its step, and finding the next one, are exact: no tolerance and no
 * rounding, however large the value or small the step (a double cannot say that 10000000.03 is a whole number of hundredths from 0, and it loses a
 * step of 1e-15 added to 1.00000000000001).
 *
 * The text follows the field model's rule for a number (`ui-next/shell/core/fields/values.ts`, `NUMBER`):
 * `^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`, so `1e-7` is a number and `0x10`, `1,5`, `Infinity` and `12abc` are not. What the part holds is
 * stated: at most `MAX_DIGITS` digits, and an exponent that moves the point at most `MAX_DIGITS` places; a text beyond that is not a number the field
 * can hold (the keys do nothing and a stepper starts from the minimum, as for any text that is not a number).
 */
export type Decimal = { readonly digits: bigint; readonly scale: number };

/** The most digits a number holds, and the most places an exponent may move its point. */
export const MAX_DIGITS = 1000;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A number's text as an exact decimal, or null when it is not a number the field can hold. */
export function parseDecimal(text: string): Decimal | null {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed)) {
    return null;
  }

  const [mantissa = '', exponent = '0'] = trimmed.toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.replace(/^[+-]/, '').split('.');
  const written = `${whole}${fraction}`.replace(/^0+/, '');
  const scale = fraction.length - Number(exponent);
  if (written.length > MAX_DIGITS || !(Math.abs(scale) <= MAX_DIGITS)) {
    return null;
  }

  const digits = BigInt(written === '' ? '0' : written) * (mantissa.startsWith('-') ? -1n : 1n);
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** The shortest decimal a number is written with (0.1 is one tenth, not the double nearest to it), or null when it has none. */
export const fromNumber = (value: number): Decimal | null => (Number.isFinite(value) ? parseDecimal(String(value)) : null);

const scaleTo = (value: Decimal, scale: number): bigint => value.digits * 10n ** BigInt(scale - value.scale);

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const x = scaleTo(a, scale);
  const y = scaleTo(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { digits: scaleTo(a, scale) + scaleTo(b, scale), scale };
}

/** `count` times the value; `count` is a whole number, and may be negative. */
export const times = (value: Decimal, count: number): Decimal => ({ digits: value.digits * BigInt(count), scale: value.scale });

/** Whether `value` is a whole number of `step`s from `origin`: exactly, with no tolerance. */
export function isOnGrid(value: Decimal, origin: Decimal, step: Decimal): boolean {
  const scale = Math.max(value.scale, origin.scale, step.scale);
  const unit = scaleTo(step, scale);
  return unit !== 0n && (scaleTo(value, scale) - scaleTo(origin, scale)) % unit === 0n;
}

/** The plain decimal text of a number: no exponent and no trailing zeros ("1.2", "12", "-0.5", "0.00000000002"). */
export function formatDecimal({ digits, scale }: Decimal): string {
  const negative = digits < 0n;
  const raw = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
  const whole = raw.slice(0, raw.length - scale);
  const fraction = raw.slice(raw.length - scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
