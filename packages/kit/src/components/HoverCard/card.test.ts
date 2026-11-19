import { describe, expect, it } from 'vitest';
import { hoverCard, hoverCardAnchor, type HoverCardAttributes } from './card';
import type { DataAttributes } from '../../shared/dataAttributes';

describe('hoverCard', () => {
  it('is the one attribute the host reads: the key of the card, as data-ov-card', () => {
    expect(hoverCard('session-7')).toEqual({ 'data-ov-card': 'session-7' });
  });

  it('keeps the key as it is: it is the host\'s own, an identifier, never trimmed or changed', () => {
    expect(hoverCard(' a b ')).toEqual({ 'data-ov-card': ' a b ' });
  });

  it('emits nothing for a blank or missing key: a trigger with no card is not a trigger', () => {
    expect(hoverCard('')).toEqual({});
    expect(hoverCard('   \n ')).toEqual({});
    expect(hoverCard(undefined)).toEqual({});
    expect(Object.keys(hoverCard(undefined, { arrow: 'down' }))).toEqual([]);
  });

  it('asks for the Down arrow with { arrow: "down" }, and adds nothing else', () => {
    expect(hoverCard('session-7', { arrow: 'down' })).toEqual({ 'data-ov-card': 'session-7', 'data-ov-card-arrow': 'down' });
    expect(hoverCard('session-7', {})).toEqual({ 'data-ov-card': 'session-7' });
    expect(Object.keys(hoverCard('session-7', { arrow: 'down' })).sort()).toEqual(['data-ov-card', 'data-ov-card-arrow']);
  });

  it('is not a popup of the trigger\'s own: no aria-haspopup, no aria-describedby, no title, no id', () => {
    const keys = Object.keys(hoverCard('session-7', { arrow: 'down' }));
    for (const name of ['aria-haspopup', 'aria-describedby', 'aria-expanded', 'aria-controls', 'title', 'id', 'popovertarget']) {
      expect(keys).not.toContain(name);
    }
  });

  it('spreads onto any part, whose only pass-through is data-*', () => {
    // Types only: this is never rendered. A kit part takes `DataAttributes`; the result of hoverCard() and hoverCardAnchor() must be one.
    const spread: DataAttributes = { ...hoverCard('a'), ...hoverCard('b', { arrow: 'down' }), ...hoverCardAnchor() };
    const typed: HoverCardAttributes = hoverCard('a');
    // @ts-expect-error the only arrow a trigger can ask for is down
    hoverCard('a', { arrow: 'up' });
    // @ts-expect-error a key is text, not a number
    hoverCard(42);
    expect([spread, typed]).toHaveLength(2);
  });
});

describe('hoverCardAnchor', () => {
  it('marks the element the card is placed against: data-ov-card-anchor, with no value', () => {
    expect(hoverCardAnchor()).toEqual({ 'data-ov-card-anchor': '' });
  });

  it('is a fresh object each time: spreading it never shares one', () => {
    expect(hoverCardAnchor()).not.toBe(hoverCardAnchor());
  });
});
