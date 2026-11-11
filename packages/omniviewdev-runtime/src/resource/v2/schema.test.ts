import { describe, expect, it } from 'vitest';
import type { SchemaTarget } from './domain';
import { resourceEditorModelURI, type ResourceEditorModelIdentity } from './schema';

const identity: ResourceEditorModelIdentity = {
  pluginID: 'provider', route: { connection: 'cluster' }, type: 'k8s:/pods',
  target: { representation: { id: 'native', revision: 'format-1' } }, name: 'drawer-1/draft',
};
const auxiliary: SchemaTarget = { auxiliary: {
  key: 'team/release', sourceRevision: 'installed-1',
  reference: { address: {
    provider: 'helm', authority: 'host-authority', type: 'helm:releases',
    scope: [{ dimension: 'namespace', value: 'team' }, { dimension: 'region', value: 'west' }],
    id: 'release',
  }, incarnation: 'installed-release' },
} };

describe('stable editor model identity', () => {
  it('exists without schema and ignores format/source revisions', () => {
    const original = resourceEditorModelURI(identity);
    expect(original).toBe('file:///omniview-editor/vprovider/vcluster/vk8s%3A%2Fpods/vrepresentation/vnative/vdrawer-1%2Fdraft.yaml');
    expect(resourceEditorModelURI({ ...identity, target: { representation: { id: 'native', revision: 'format-2' } } })).toBe(original);
    const values = resourceEditorModelURI({ ...identity, target: auxiliary });
    expect(resourceEditorModelURI({ ...identity, target: { auxiliary: { ...auxiliary.auxiliary, sourceRevision: 'installed-2' } } })).toBe(values);
  });

  it('keeps opaque identity segments distinct and never creates dot path segments', () => {
    const names = ['a/b', 'a%2Fb', 'a?b#c', '*', '[ab]', '{a,b}', '.', '..', '', '雪/é::🚀|', '雪/e\u0301::🚀|'];
    const paths = names.map(name => resourceEditorModelURI({ ...identity, name }));
    expect(new Set(paths).size).toBe(names.length);
    for (const path of paths) {
      const parsed = new URL(path);
      expect(parsed.hash).toBe('');
      expect(parsed.search).toBe('');
      expect(parsed.pathname.split('/')).not.toContain('.');
      expect(path).not.toMatch(/[*?\[\]{}]/);
      expect(parsed.pathname.split('/')).not.toContain('..');
    }
    const plugin = resourceEditorModelURI({ ...identity, pluginID: 'provider/cluster' });
    const connection = resourceEditorModelURI({ ...identity, route: { connection: 'provider/cluster' } });
    expect(plugin).not.toBe(connection);
  });

  it('partitions plugin, route, type, format, and editor owner without a content hash', () => {
    const paths = [
      identity,
      { ...identity, pluginID: 'other' },
      { ...identity, route: { connection: 'other' } },
      { ...identity, type: 'other' },
      { ...identity, target: { representation: { id: 'other', revision: 'format-1' } } },
      { ...identity, name: 'drawer-2/draft' },
      { ...identity, target: auxiliary },
    ].map(resourceEditorModelURI);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('binds auxiliary models to exact admitted resource identity with canonical scope ordering', () => {
    const selected = auxiliary.auxiliary;
    const address = selected.reference.address;
    const original = resourceEditorModelURI({ ...identity, target: auxiliary });
    const reordered = { ...selected, reference: { ...selected.reference, address: { ...address, scope: [...address.scope].reverse() } } };
    expect(resourceEditorModelURI({ ...identity, target: { auxiliary: reordered } })).toBe(original);
    const targets: SchemaTarget[] = [
      { auxiliary: { ...selected, key: 'other/key' } },
      { auxiliary: { ...selected, reference: { ...selected.reference, incarnation: 'other' } } },
      { auxiliary: { ...selected, reference: { address } } },
      ...[
        { ...address, provider: 'other' },
        { ...address, authority: 'other' },
        { ...address, type: 'other' },
        { ...address, id: 'other' },
        { ...address, scope: [{ dimension: 'namespace', value: 'other' }] },
      ].map(next => ({ auxiliary: { ...selected, reference: { ...selected.reference, address: next } } })),
    ];
    const paths = targets.map(target => resourceEditorModelURI({ ...identity, target }));
    expect(paths).not.toContain(original);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
