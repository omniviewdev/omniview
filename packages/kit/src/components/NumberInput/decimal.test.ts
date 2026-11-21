import { describe, expect, it } from 'vitest';
import { add, compare, formatDecimal, fromNumber, isOnGrid, MAX_DIGITS, parseDecimal, times, type Decimal } from './decimal';

const must = (text: string): Decimal => {
  const parsed = parseDecimal(text);
  if (parsed === null) {
    throw new Error(`not a number: ${text}`);
  }

  return parsed;
};

// An oracle that shares nothing with the implementation but the language: exact fractions of two BigInts, read by a second parser.
type Q = { readonly n: bigint; readonly d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }

  return x;
};

const q = (n: bigint, d: bigint): Q => {
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};

const qOf = (text: string): Q => {
  const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (m === null) {
    throw new Error(`the oracle cannot read ${text}`);
  }

  const [, sign = '', whole = '', fraction = '', exponent = '0'] = m;
  const digits = BigInt(`${whole}${fraction}` === '' ? '0' : `${whole}${fraction}`) * (sign === '-' ? -1n : 1n);
  const power = Number(exponent) - fraction.length;
  return power >= 0 ? q(digits * 10n ** BigInt(power), 1n) : q(digits, 10n ** BigInt(-power));
};

const qSum = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qTimes = (a: Q, k: number): Q => q(a.n * BigInt(k), a.d);
const qEqual = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
/** (value - origin) / step is a whole number; the step is positive. */
const qOnGrid = (value: Q, origin: Q, step: Q): boolean => {
  const distance = qSum(value, qTimes(origin, -1));
  return q(distance.n * step.d, distance.d * step.n).d === 1n;
};

const generator = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('decimal', () => {
  describe('the text of a number (the field model\'s rule)', () => {
    it.each(['0', '12', '+12', '-12', '.5', '5.', '-.5', '1.50', '1e3', '1E3', '1e+3', '1.5e-7', ' 12 ', '000.100'])('reads %j', (text) => {
      expect(parseDecimal(text)).not.toBeNull();
    });

    it.each(['', ' ', '.', '+', '-', 'e5', '1e', '1e+', '1e1.5', '0x10', '1,5', '1 2', 'Infinity', 'NaN', '12abc', '--1', '1.2.3'])('does not read %j', (text) => {
      expect(parseDecimal(text)).toBeNull();
    });

    it('holds at most 1,000 digits and an exponent that moves the point at most 1,000 places, and says no beyond', () => {
      expect(parseDecimal('1'.repeat(MAX_DIGITS))).not.toBeNull();
      expect(parseDecimal('1'.repeat(MAX_DIGITS + 1))).toBeNull();
      expect(parseDecimal('1e1000')).not.toBeNull();
      expect(parseDecimal('1e1001')).toBeNull();
      expect(parseDecimal('1e-1000')).not.toBeNull();
      expect(parseDecimal('1e-1001')).toBeNull();
      expect(parseDecimal(`1e${'9'.repeat(400)}`)).toBeNull();
    });

    it('is exact for what a double cannot say', () => {
      expect(formatDecimal(must('1e21'))).toBe('1000000000000000000000');
      expect(formatDecimal(must('1.5e-7'))).toBe('0.00000015');
      expect(formatDecimal(must('0.1'))).toBe('0.1');
      expect(formatDecimal(must('-0.50'))).toBe('-0.5');
      expect(formatDecimal(must('-0'))).toBe('0');
      expect(formatDecimal(fromNumber(0.1)!)).toBe('0.1');
      expect(formatDecimal(fromNumber(1e-7)!)).toBe('0.0000001');
      expect(fromNumber(Number.NaN)).toBeNull();
      expect(fromNumber(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe('the grid and the next number', () => {
    it('puts 10000000.03 on the grid of 0.01 and 10000000.035 between two steps of it (a tolerance on a double could not)', () => {
      expect(isOnGrid(must('10000000.03'), must('0'), must('0.01'))).toBe(true);
      expect(isOnGrid(must('10000000.035'), must('0'), must('0.01'))).toBe(false);
    });

    it('starts the grid at the minimum: 0.15 is on the grid of 0.1 from 0.05, and 0.1 is not', () => {
      expect(isOnGrid(must('0.15'), must('0.05'), must('0.1'))).toBe(true);
      expect(isOnGrid(must('0.1'), must('0.05'), must('0.1'))).toBe(false);
    });

    it('adds without the error of doubles, and with the precision a step needs', () => {
      expect(formatDecimal(add(must('0.1'), must('0.2')))).toBe('0.3');
      expect(formatDecimal(add(must('1.1'), must('0.1')))).toBe('1.2');
      expect(formatDecimal(add(must('1.00000000000001'), must('1e-15')))).toBe('1.000000000000011');
      expect(formatDecimal(add(must('1e-101'), must('1e-101')))).toBe(`0.${'0'.repeat(100)}2`);
      expect(formatDecimal(add(must('1.00000000000001e-101'), must('1e-116')))).toBe(`0.${'0'.repeat(100)}1000000000000011`);
      expect(formatDecimal(add(must('-0.5'), times(must('0.5'), 1)))).toBe('0');
      expect(compare(must('1e21'), must('1000000000000000000000'))).toBe(0);
      expect(compare(must('-1'), must('0.0001'))).toBe(-1);
    });

    it('agrees with an oracle of exact fractions over random decimals, signs and exponents', () => {
      const next = generator(2026);
      const digits = (length: number) => Array.from({ length }, () => Math.floor(next() * 10)).join('');
      const text = (signed: boolean) => {
        const sign = signed && next() < 0.4 ? '-' : '';
        const whole = digits(Math.floor(next() * 7));
        const fraction = digits(Math.floor(next() * 9));
        const body = whole === '' && fraction === '' ? '0' : whole === '' ? `.${fraction}` : fraction === '' ? (next() < 0.5 ? whole : `${whole}.`) : `${whole}.${fraction}`;
        return `${sign}${body}${next() < 0.3 ? `e${Math.floor(next() * 41) - 20}` : ''}`;
      };

      let onGrid = 0;
      for (let round = 0; round < 600; round += 1) {
        const origin = text(true);
        let step = text(false);
        if (qOf(step).n === 0n) {
          step = '1';
        }

        // Half of the values are made to sit on the grid, so that both answers are exercised.
        const k = Math.floor(next() * 21) - 10;
        const value = next() < 0.5 ? text(true) : formatDecimal(add(must(origin), times(must(step), k)));
        const expected = qOnGrid(qOf(value), qOf(origin), qOf(step));
        expect(isOnGrid(must(value), must(origin), must(step)), `${value} from ${origin} by ${step}`).toBe(expected);
        onGrid += expected ? 1 : 0;
        for (const count of [-3, -1, 1, 2, 7]) {
          const written = formatDecimal(add(must(value), times(must(step), count)));
          expect(written, 'plain, with no trailing zeros').toMatch(/^-?\d+(?:\.\d*[1-9])?$/);
          expect(qEqual(qOf(written), qSum(qOf(value), qTimes(qOf(step), count))), `${value} + ${count} x ${step} = ${written}`).toBe(true);
        }
      }

      expect(onGrid).toBeGreaterThan(200);
      expect(onGrid).toBeLessThan(600);
    });
  });
});
