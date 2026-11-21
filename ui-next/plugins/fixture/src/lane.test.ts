import { describe, expect, it } from 'vitest';
import { laneOf } from './lane';

describe('the fixture\'s scope lane (C1f, C1g)', () => {
  it('names a connection by its name: the key the host makes (`<name>-<10 hex>`) without its suffix, in the face the contract marks as the connection', () => {
    expect(laneOf('north-57a082bd74')).toEqual([{ label: 'Connection', icon: 'server', text: 'north', role: 'connection' }]);
    expect(laneOf('kind-kind-57a082bd74')).toEqual([{ label: 'Connection', icon: 'server', text: 'kind-kind', role: 'connection' }]);
  });

  it('keeps a key of another shape as its own name', () => {
    expect(laneOf('north')).toEqual([{ label: 'Connection', icon: 'server', text: 'north', role: 'connection' }]);
    expect(laneOf('north-57a082bd7')).toEqual([{ label: 'Connection', icon: 'server', text: 'north-57a082bd7', role: 'connection' }]);
  });

  it('says a page with no connection under a label that is not Connection, and with no marker, so a placeholder is never read as a connection', () => {
    expect(laneOf(undefined)).toEqual([{ label: 'Scope', icon: 'server', text: 'none' }]);
  });
});
