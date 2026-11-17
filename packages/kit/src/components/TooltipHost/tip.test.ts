import { describe, expect, it } from 'vitest';
import { tip, type TipAttributes } from './tip';
import type { DataAttributes } from '../../shared/dataAttributes';

describe('tip', () => {
  it('is the one attribute the host reads: the plain text, as data-ov-tip', () => {
    expect(tip('Refresh list')).toEqual({ 'data-ov-tip': 'Refresh list' });
  });

  it('keeps the text as it is, newlines included: the host draws them as lines', () => {
    expect(tip('Created\n2026-11-05 10:42 UTC')).toEqual({ 'data-ov-tip': 'Created\n2026-11-05 10:42 UTC' });
  });

  it('emits nothing for a blank text: a tip with nothing to say is not drawn (design 12, H.tip)', () => {
    expect(tip('')).toEqual({});
    expect(tip('   \n ')).toEqual({});
    expect(tip(undefined)).toEqual({});
  });

  it('skips the delay for the triggers that ask: data-ov-tip-delay="0", the mock\'s data-tooltip-delay', () => {
    expect(tip('Resources', { delay: 0 })).toEqual({ 'data-ov-tip': 'Resources', 'data-ov-tip-delay': '0' });
    expect(tip('Resources', {})).toEqual({ 'data-ov-tip': 'Resources' });
  });

  it('spreads onto any part, whose only pass-through is data-*', () => {
    // Types only: this is never rendered. A kit part takes `DataAttributes`; the result of tip() must be one.
    const spread: DataAttributes = { ...tip('Refresh list'), ...tip('x', { delay: 0 }) };
    const typed: TipAttributes = tip('x');
    // @ts-expect-error the only delay a trigger can ask for is none: the default is the design's 500 ms
    tip('x', { delay: 250 });
    // @ts-expect-error a tip is plain text: not a number, not markup
    tip(42);
    expect([spread, typed]).toHaveLength(2);
  });

  it('never sets a native title: the host is the one owner of a trigger\'s tooltip (design 12 §4, 14 P1)', () => {
    expect(Object.keys(tip('Refresh list'))).not.toContain('title');
  });
});
