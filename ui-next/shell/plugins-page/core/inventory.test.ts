import { describe, expect, it } from 'vitest';
import { BOUNDS, compareInstalled, installedOf, listOf } from './inventory';
import type { InventoryEntry } from './types';

// What the page keeps of the host's inventory: the manifest facts a plugin says of itself, bounded and typed, in the order the list draws them. The inventory comes from the host over the wire (Go's nil slices arrive
// as `null`), and the text in it is a plugin's own, so it is read defensively and cut to what a row and a card can hold; the member that holds the text of the last error (`lastError`) is never read.

const entry = (patch: Partial<Omit<InventoryEntry, 'metadata'>> & { readonly metadata?: Partial<InventoryEntry['metadata']> } = {}): InventoryEntry => {
  const { metadata, ...rest } = patch;
  return {
    id: 'alpha',
    origin: 'external',
    enabled: true,
    phase: 'Running',
    devMode: false,
    releaseChannel: '',
    metadata: {
      name: 'Alpha Metrics',
      version: '1.8.2',
      description: 'Dashboards and data sources for the alpha service.',
      category: 'Monitoring',
      license: 'Apache-2.0',
      author: { name: 'Fixture Labs' },
      repository: 'https://example.test/alpha',
      website: '',
      tags: ['metrics'],
      dependencies: [],
      capabilities: ['resource', 'log'],
      ...metadata,
    },
    ...rest,
  };
};

describe('installedOf', () => {
  it('keeps what the manifest says of the plugin, with the publisher the author names', () => {
    expect(installedOf(entry())).toEqual({
      id: 'alpha',
      name: 'Alpha Metrics',
      version: '1.8.2',
      description: 'Dashboards and data sources for the alpha service.',
      publisher: 'Fixture Labs',
      license: 'Apache-2.0',
      category: 'Monitoring',
      repository: 'https://example.test/alpha',
      website: '',
      tags: ['metrics'],
      dependencies: [],
      capabilities: ['resource', 'log'],
      builtin: false,
      enabled: true,
      devMode: false,
      releaseChannel: '',
      phase: 'Running',
    });
  });

  it('names a plugin by its id when its manifest gives no name', () => {
    expect(installedOf(entry({ metadata: { name: '  ' } })).name).toBe('alpha');
  });

  it('says the product\'s own plugin is built in, and takes any other origin as external', () => {
    expect(installedOf(entry({ origin: 'builtin' })).builtin).toBe(true);
    expect(installedOf(entry({ origin: 'external' })).builtin).toBe(false);
    expect(installedOf(entry({ origin: '' })).builtin).toBe(false);
  });

  it('has no publisher when the manifest names no author', () => {
    expect(installedOf(entry({ metadata: { author: null } })).publisher).toBe('');
    expect(installedOf(entry({ metadata: { author: undefined } })).publisher).toBe('');
  });

  it('reads the lists Go sends as null as empty, and keeps only the words that are text', () => {
    const hostile = entry({ metadata: { capabilities: null as unknown as string[], tags: null as unknown as string[], dependencies: ['beta', 7 as unknown as string, '', '  '] } });
    const read = installedOf(hostile);

    expect(read.capabilities).toEqual([]);
    expect(read.tags).toEqual([]);
    expect(read.dependencies).toEqual(['beta']);
  });

  it('cuts the text of a plugin to what a row and a card can hold, with an ellipsis, and the lists to a few', () => {
    const long = 'x'.repeat(2000);
    const read = installedOf(entry({ metadata: { name: long, description: long, capabilities: Array.from({ length: 50 }, (_, index) => `kind-${String(index)}`), tags: Array.from({ length: 50 }, (_, index) => `tag-${String(index)}`), author: { name: long } } }));

    expect(read.name).toHaveLength(BOUNDS.name);
    expect(read.name.endsWith('…')).toBe(true);
    expect(read.description).toHaveLength(BOUNDS.description);
    expect(read.publisher).toHaveLength(BOUNDS.publisher);
    expect(read.tags).toHaveLength(BOUNDS.tags);
    expect(read.capabilities).toHaveLength(BOUNDS.capabilities);
  });

  it('keeps an address only when it is a web address, and no other text: a link that is not one is no link', () => {
    expect(installedOf(entry({ metadata: { repository: 'javascript:alert(1)', website: 'file:///etc/passwd' } }))).toMatchObject({ repository: '', website: '' });
    expect(installedOf(entry({ metadata: { repository: ' https://example.test/a b', website: 'http://example.test/' } }))).toMatchObject({ repository: '', website: 'http://example.test/' });
  });

  it('never reads the text of the last error: the host holds it raw, and the page says why in the host\'s own words', () => {
    const read = installedOf({ ...entry(), lastError: 'plugin start: exec /Users/me/.omniview/plugins/alpha/bin/alpha: token=abc' } as InventoryEntry);

    expect(JSON.stringify(read)).not.toMatch(/Users|token|exec/);
  });
});

describe('listOf', () => {
  const named = (id: string, name: string) => entry({ id, metadata: { name } });

  it('lists the plugins by name as plain text, whatever order the host sends them in (a Go map has none), and by id when two share a name', () => {
    const list = listOf([named('b', 'beta'), named('z', 'Zeta'), named('d2', 'Delta'), named('a', 'alpha'), named('d1', 'Delta')]);

    expect(list.map((plugin) => plugin.id)).toEqual(['a', 'b', 'd1', 'd2', 'z']);
  });

  it('is the same order whichever order the host sends', () => {
    const rows = [named('b', 'beta'), named('a', 'alpha'), named('c', 'gamma')];

    expect(listOf(rows).map((plugin) => plugin.id)).toEqual(listOf([...rows].reverse()).map((plugin) => plugin.id));
  });

  it('lists a plugin once: the last the host sent says what it is now', () => {
    const list = listOf([entry({ phase: 'Starting' }), entry({ phase: 'Running' })]);

    expect(list).toHaveLength(1);
    expect(list[0]?.phase).toBe('Running');
  });

  it('is nothing for nothing, and for what is not a list', () => {
    expect(listOf([])).toEqual([]);
    expect(listOf(null as unknown as InventoryEntry[])).toEqual([]);
  });

  it('skips an entry that names no plugin', () => {
    expect(listOf([entry({ id: '' }), named('a', 'alpha')]).map((plugin) => plugin.id)).toEqual(['a']);
  });
});

describe('compareInstalled', () => {
  it('compares names as plain text, so a machine\'s locale moves no plugin: capitals do not come first, accents are not folded', () => {
    const names = ['zeta', 'Alpha', 'Éclair', 'beta'].map((name) => installedOf(entry({ id: name, metadata: { name } })));

    expect([...names].sort(compareInstalled).map((plugin) => plugin.name)).toEqual(['Alpha', 'beta', 'zeta', 'Éclair']);
  });
});
