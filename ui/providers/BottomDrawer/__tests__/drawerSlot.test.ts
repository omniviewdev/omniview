import type { BottomDrawerTab } from '@omniviewdev/runtime';
import {
  buildDrawerSlot,
  collectDrawerTabIdsClaimedByOtherWindows,
  hydrateDrawerTab,
  parseDrawerSlot,
  parseSerializedDrawerTab,
  serializeDrawerTab,
  type SerializedDrawerTab,
} from '../drawerSlot';

const created = '2026-10-29T08:00:00.000Z';

function serializedTab(id: string, variant: SerializedDrawerTab['variant'] = 'terminal'): SerializedDrawerTab {
  return { id, title: id, variant, createdAt: created, updatedAt: created };
}

describe('parseDrawerSlot', () => {
  it('accepts a complete slot', () => {
    const slot = {
      version: 1,
      tabs: [{ ...serializedTab('sess-1'), properties: { status: 'connected' } }, serializedTab('log-1', 'logs')],
      focusedId: 'log-1',
      mode: 'expanded',
      height: 420,
    };

    expect(parseDrawerSlot(slot)).toEqual(slot);
  });

  it('accepts a minimal panel slot without mode and height', () => {
    expect(parseDrawerSlot({ version: 1, tabs: [serializedTab('sess-1')], focusedId: 'sess-1' }))
      .toEqual({ version: 1, tabs: [serializedTab('sess-1')], focusedId: 'sess-1' });
  });

  it.each([
    ['a non-object', 'nope'],
    ['an unknown version', { version: 2, tabs: [], focusedId: null }],
    ['tabs that are not an array', { version: 1, tabs: {}, focusedId: null }],
    ['duplicate tab ids', { version: 1, tabs: [serializedTab('a'), serializedTab('a')], focusedId: null }],
    ['a focusedId that is not one of its tabs', { version: 1, tabs: [serializedTab('a')], focusedId: 'b' }],
    ['an unknown mode', { version: 1, tabs: [], focusedId: null, mode: 'docked' }],
    ['a non-positive height', { version: 1, tabs: [], focusedId: null, height: 0 }],
    ['a tab with an unknown variant', { version: 1, tabs: [serializedTab('a', 'shell' as 'terminal')], focusedId: null }],
    ['a tab with an invalid timestamp', { version: 1, tabs: [{ ...serializedTab('a'), createdAt: 'yesterday' }], focusedId: null }],
    ['a tab with an empty id', { version: 1, tabs: [serializedTab('')], focusedId: null }],
    ['a tab with array properties', { version: 1, tabs: [{ ...serializedTab('a'), properties: [] }], focusedId: null }],
  ])('rejects %s', (_case, value) => {
    expect(() => parseDrawerSlot(value)).toThrow();
  });
});

describe('drawer tab serialization', () => {
  it('drops the icon and restores it from the variant', () => {
    const tab: BottomDrawerTab = {
      id: 'log-1',
      title: 'Logs',
      variant: 'logs',
      icon: 'LuCustomPluginIcon',
      properties: { follow: true },
      createdAt: new Date(created),
      updatedAt: new Date(created),
    };

    const serialized = serializeDrawerTab(tab);
    expect(serialized).not.toHaveProperty('icon');
    expect(parseSerializedDrawerTab(JSON.parse(JSON.stringify(serialized)))).toEqual(serialized);
    expect(hydrateDrawerTab(serialized)).toEqual({ ...tab, icon: 'LuLogs' });
  });
});

describe('buildDrawerSlot', () => {
  it('leaves out pending terminals and drops focus that pointed at one', () => {
    const tabs = [hydrateDrawerTab(serializedTab('sess-1')), hydrateDrawerTab(serializedTab('pending-1'))];

    expect(buildDrawerSlot(tabs, 'pending-1', 'minimized', 300)).toEqual({
      version: 1,
      tabs: [serializedTab('sess-1')],
      focusedId: null,
      mode: 'minimized',
      height: 300,
    });
  });
});

describe('collectDrawerTabIdsClaimedByOtherWindows', () => {
  it('collects tab ids of other windows only and ignores invalid drawer states', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    try {
      const claimed = collectDrawerTabIdsClaimedByOtherWindows({
        'main': { drawer: JSON.stringify({ version: 1, tabs: [serializedTab('own')], focusedId: null }) },
        'w-panel': { drawer: JSON.stringify({ version: 1, tabs: [serializedTab('moved')], focusedId: 'moved' }) },
        'w-pages': { pages: '{}' },
        'w-broken': { drawer: '{"version":7}' },
      }, 'main');

      expect([...claimed]).toEqual(['moved']);
    } finally {
      errorLog.mockRestore();
    }
  });
});
