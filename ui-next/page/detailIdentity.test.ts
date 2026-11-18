import { describe, expect, it } from 'vitest';
import { facetsOf, nameOf, titleOf } from './detailIdentity';

// The host knows no plugin: the object is invented (a widget in a bay), and so is its kind.
const definition = { kind: 'Widget', identity: { name: 'name', facets: ['bay', 'site'] } } as const;

describe('nameOf', () => {
  it('reads the parameter the definition names, trimmed', () => {
    expect(nameOf(definition, { name: '  lathe-4 ' })).toBe('lathe-4');
  });

  it('is empty when the route lacks it, or holds something that is not text', () => {
    expect(nameOf(definition, {})).toBe('');
    expect(nameOf(definition, { name: 4 })).toBe('');
    expect(nameOf(definition, { name: ['lathe-4'] })).toBe('');
  });
});

describe('titleOf', () => {
  it('is {name} · {Kind}, the name as one word and the kind as the platform spells it (design 16 TI1)', () => {
    expect(titleOf(definition, { name: 'lathe-4', bay: 'north' })).toBe('lathe-4 · Widget');
  });

  it('is the kind alone for a route with no name', () => {
    expect(titleOf(definition, { bay: 'north' })).toBe('Widget');
  });
});

describe('facetsOf', () => {
  it('lists the parameters the definition names that the route has, in the definition\'s order', () => {
    expect(facetsOf(definition, { name: 'lathe-4', site: 'plant-2', bay: 'north' })).toEqual(['north', 'plant-2']);
  });

  it('leaves out a parameter the route lacks or leaves empty, and says each facet once', () => {
    expect(facetsOf(definition, { name: 'lathe-4', bay: ' ', site: 'plant-2' })).toEqual(['plant-2']);
    expect(facetsOf({ identity: { name: 'name', facets: ['bay', 'site'] } }, { bay: 'north', site: 'north' })).toEqual(['north']);
  });

  it('is empty for a definition with no facets', () => {
    expect(facetsOf({ identity: { name: 'name' } }, { name: 'lathe-4', bay: 'north' })).toEqual([]);
  });
});
