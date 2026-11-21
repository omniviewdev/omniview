import { describe, expect, it } from 'vitest';
import { laneOf } from './lane';

describe('the fixture\'s scope lane (C1f)', () => {
  it('names a connection by its name: the key the host makes (`<name>-<10 hex>`) without its suffix', () => {
    expect(laneOf('north-57a082bd74')).toEqual([{ label: 'Connection', icon: 'server', text: 'north' }]);
    expect(laneOf('kind-kind-57a082bd74')).toEqual([{ label: 'Connection', icon: 'server', text: 'kind-kind' }]);
  });

  it('keeps a key of another shape as its own name', () => {
    expect(laneOf('north')).toEqual([{ label: 'Connection', icon: 'server', text: 'north' }]);
    expect(laneOf('north-57a082bd7')).toEqual([{ label: 'Connection', icon: 'server', text: 'north-57a082bd7' }]);
  });

  it('says a page with no connection under a label that is not Connection, so the palette does not say a placeholder as a connection', () => {
    expect(laneOf(undefined)).toEqual([{ label: 'Scope', icon: 'server', text: 'none' }]);
  });
});
