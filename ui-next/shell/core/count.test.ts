import { describe, expect, it } from 'vitest';
import { countText } from './count';

// The text of a count in the sidebar's 12 px slot: what a number, an approximate number and no number draw. The mock groups the thousands of every collection count (`H.count`, core.js:1874,
// `groupedDecimal`), and the kit's footer does it with a comma whatever the locale of the window; a count that is not a whole number of at least zero is no count (a wrong count is worse than none).

describe('countText: a number is the count', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [89, '89'],
    [999, '999'],
    [1000, '1,000'],
    [1234, '1,234'],
    [12345, '12,345'],
    [1234567, '1,234,567'],
    [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991'],
  ])('draws %d as %s, in grouped digits and with nothing before them', (value, digits) => {
    expect(countText(value)).toEqual({ text: digits, digits, approximate: false });
  });
});

describe('countText: an approximate count is drawn with a tilde and said as "about"', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [326, '326'],
    [1234, '1,234'],
  ])('draws about %d as ~%s', (value, digits) => {
    expect(countText({ value, approximate: true })).toEqual({ text: `~${digits}`, digits, approximate: true });
  });
});

describe('countText: no count is nothing', () => {
  it('has nothing to draw for an absent count and for a slot that has no number yet', () => {
    expect(countText(undefined)).toBeUndefined();
    expect(countText(null)).toBeUndefined();
  });

  it.each([
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a number beyond the safe integers', Number.MAX_SAFE_INTEGER + 2],
  ])('draws nothing for %s: a plugin that sends one has no count, and the sidebar must not throw', (_name, value) => {
    expect(countText(value)).toBeUndefined();
    expect(countText({ value, approximate: true })).toBeUndefined();
  });

  it('draws nothing for an object that is not an approximate count', () => {
    expect(countText({ value: 3, approximate: false } as never)).toBeUndefined();
    expect(countText({ value: 3 } as never)).toBeUndefined();
    expect(countText({ approximate: true } as never)).toBeUndefined();
    expect(countText('3' as never)).toBeUndefined();
  });
});
