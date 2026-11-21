import { describe, expect, it } from 'vitest';
import { hostFacets, qualify, type QualifyItem } from './identity';
import { boot, cloudPage, dest, hostPage, stackPage, tabOf, type Harness } from './testing';
import type { Face } from './index';

// Tab identity (ch16 TI1, S17, S61): the title `{name} · {Kind}`, and the shortest qualifier that tells two tabs that read alike apart.
// `qualify` is the design lab's `Shell.tabs.qualify`; the cases follow its documented rules and the cases of the harness's view() and facets checks
// (tests/shell-model-harness/R2Store/unit.cjs), with the vocabulary of no real plugin.

const item = (id: string, title: string, facets: readonly string[], extra: Partial<QualifyItem> = {}): QualifyItem => ({ id, icon: 'box', title, facets, ...extra });
const qualifiers = (items: readonly QualifyItem[]) => Object.fromEntries([...qualify(items)].map(([id, parts]) => [id, parts.join(' · ')]));
const service = (name: string, group: string, connection: string) => stackPage('service', { name, group, connection });
const identity = (h: Harness, id: string) => {
  const found = h.store.selectors.identity(h.state(), id);
  if (!found) {
    throw new Error(`no identity for ${id}`);
  }

  return found;
};

describe('qualify: the shortest text that tells tabs apart', () => {
  it('gives nothing to a tab that reads differently from every other', () => {
    expect(qualifiers([item('a', 'Lists', ['x']), item('b', 'Nodes', ['x'])])).toEqual({});
    expect(qualify([item('a', 'api', ['x'])]).size).toBe(0);
  });

  it('takes the first facet that tells them all apart', () => {
    expect(qualifiers([item('a', 'api', ['checkout', 'one']), item('b', 'api', ['payments', 'one'])])).toEqual({ a: 'checkout', b: 'payments' });
    // The first facet is the same: the next one does it, alone.
    expect(qualifiers([item('a', 'api', ['shop', 'one']), item('b', 'api', ['shop', 'two'])])).toEqual({ a: 'one', b: 'two' });
  });

  it('joins the first facets only when no single one does', () => {
    expect(qualifiers([item('a', 'api', ['g1', 'c1']), item('b', 'api', ['g1', 'c2']), item('c', 'api', ['g2', 'c1'])])).toEqual({ a: 'g1 · c1', b: 'g1 · c2', c: 'g2 · c1' });
  });

  it('counts twins once: tabs identical in every facet need nothing, and share the text a third tab makes them need', () => {
    expect(qualifiers([item('a', 'api', ['shop']), item('b', 'api', ['shop'])])).toEqual({});
    expect(qualifiers([item('a', 'api', ['shop']), item('b', 'api', ['shop']), item('c', 'api', ['cart'])])).toEqual({ a: 'shop', b: 'shop', c: 'cart' });
  });

  it('reads one title in any case and spacing, and keeps different icons apart', () => {
    expect(qualifiers([item('a', 'Api', ['x']), item('b', ' api ', ['y'])])).toEqual({ a: 'x', b: 'y' });
    expect(qualifiers([item('a', 'api', ['x']), { ...item('b', 'api', ['y']), icon: 'other' }])).toEqual({});
  });

  it('never qualifies a singleton page', () => {
    expect(qualifiers([item('a', 'Settings', ['x'], { singleton: true }), item('b', 'Settings', ['y'], { singleton: true })])).toEqual({});
  });

  it('leaves a tab with no value for the chosen facet reading plain, and pads facets of unequal length', () => {
    expect(qualifiers([item('a', 'api', ['', 'x']), item('b', 'api', ['y'])])).toEqual({ b: 'y' });
    expect(qualifiers([item('a', 'api', ['a']), item('b', 'api', ['a', 'b'])])).toEqual({ b: 'b' });
  });
});

describe('the facets the host adds to a plugin\'s own: scope, the parent crumb, the plugin name (T1)', () => {
  const face = (overrides: Partial<Face>): Face => ({ title: 'x', icon: '', path: [], facets: [], pluginName: '', singleton: false, identity: 'key', ...overrides });
  const crumbs = (...labels: string[]) => labels.map((label) => ({ label }));

  it('takes the crumb before the page\'s own, leaving the plugin\'s name out of the path', () => {
    expect(hostFacets(face({ pluginName: 'Cloud', path: crumbs('Cloud', 'Compute', 'Instances'), scope: { id: 'r', label: 'us-east-1' } }))).toEqual(['us-east-1', 'Compute', 'Cloud']);
    // The leaf is the page's own even when its title says something else: an object page's leaf crumb is the object's id.
    expect(hostFacets(face({ title: 'alice.chen', pluginName: 'Access plugin', path: crumbs('IAM', 'Users', 'u-9') }))).toEqual(['', 'Users', 'Access plugin']);
    expect(hostFacets(face({ pluginName: 'Cloud', path: crumbs('COMPUTE', 'Instances') }))).toEqual(['', 'COMPUTE', 'Cloud']);
  });

  it('is blank for a host page, which says no scope, no path and no plugin name', () => {
    expect(hostFacets(face({}))).toEqual(['', '', '']);
    expect(hostFacets(face({ path: crumbs('Settings') }))).toEqual(['', '', '']);
  });
});

describe('what every surface reads from a tab (ch16 TI1)', () => {
  it('appends the qualifier to the label, the accessible name, the tooltip and the path leaf, and nothing builds its own', () => {
    const h = boot({ home: false });
    const a = h.open(service('api', 'checkout', 'one'));
    const b = h.open(service('api', 'payments', 'one'), { how: 'new' });
    const c = h.open(service('worker', 'checkout', 'one'), { how: 'new' });

    const ia = identity(h, a);
    expect(ia.title).toBe('api · Service');
    expect(ia.qualifier).toBe('checkout');
    expect(ia.label).toBe('api · Service · checkout');
    expect(ia.name).toBe('api · Service, one, checkout');
    expect(ia.tip).toBe('Stack › one › Services › api · checkout');
    expect(ia.path.map((crumb) => crumb.label)).toEqual(['Stack', 'one', 'Services', 'api · checkout']);
    expect(identity(h, b).label).toBe('api · Service · payments');
    // A tab that reads differently from every other carries no qualifier.
    expect(identity(h, c)).toMatchObject({ qualifier: '', label: 'worker · Service', tip: 'Stack › one › Services › worker' });
  });

  it('tells two objects of one name in two connections apart, by the connection', () => {
    const h = boot({ home: false });
    const a = h.open(service('api', 'shop', 'one'));
    const b = h.open(service('api', 'shop', 'two'), { how: 'new' });
    expect(identity(h, a).label).toBe('api · Service · one');
    expect(identity(h, b).label).toBe('api · Service · two');
    // The path already names the connection, so the leaf does not repeat it.
    expect(identity(h, a).path.map((crumb) => crumb.label)).toEqual(['Stack', 'one', 'Services', 'api']);
    expect(identity(h, a).tip).toBe('Stack › one › Services › api');
  });

  it('gives two pages of one title the plugin\'s own section crumb, and drops the qualifier again when the twin closes', () => {
    const h = boot({ home: false });
    const a = h.open(dest('compute', 'instances'));
    const b = h.open(dest('database', 'instances'), { how: 'new' });
    expect(identity(h, a).label).toBe('Instances · COMPUTE');
    expect(identity(h, b).label).toBe('Instances · DATABASE');
    h.store.close(b);
    expect(identity(h, a).label).toBe('Instances');
  });

  it('does not qualify twins, a singleton, or a host page', () => {
    const h = boot();
    const home = h.current();
    const s = h.open(hostPage('settings'), { how: 'new' });
    const a = h.open(cloudPage('instances', { region: 'us-east-1' }));
    const b = h.open(cloudPage('instances', { region: 'us-east-1' }), { how: 'new' });
    expect([identity(h, a).qualifier, identity(h, b).qualifier]).toEqual(['', '']);
    expect(identity(h, s)).toMatchObject({ label: 'Settings', tip: '', name: 'Settings', qualifier: '' });
    expect(identity(h, home).label).toBe('Home');
  });

  it('does not repeat the plugin name in the tooltip when the path starts with it, and puts the scope first when the path leaves it out', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'eu-1' }));
    expect(identity(h, a).tip).toBe('Cloud › eu-1 › Compute › Instances');
    // A path that does not start with the plugin's name is untouched.
    const database = h.store.open(dest('database', 'instances'), { how: 'new' });
    expect(database.status).toBe('done');
    const id = database.status === 'done' ? database.id : '';
    expect(identity(h, id).tip).toBe('Cloud › DATABASE › Instances');
  });

  it('says what a tab\'s accessible name holds: the title, the scope, and the qualifier unless the scope already is it', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'us-east-1' }));
    const b = h.open(cloudPage('instances', { region: 'eu-west-1' }), { how: 'new' });
    expect(identity(h, a)).toMatchObject({ qualifier: 'us-east-1', name: 'Instances, us-east-1' });
    expect(identity(h, b)).toMatchObject({ qualifier: 'eu-west-1', name: 'Instances, eu-west-1' });
  });

  it('reads the scope\'s label and never its id (C1g): the id tells places apart, and no surface of a tab says it', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'us-east-1' }));
    const b = h.open(cloudPage('instances', { region: 'eu-west-1' }), { how: 'new' });
    for (const id of [a, b]) {
      const { label, name, tip, qualifier, path } = identity(h, id);
      // The harness's scope has the id `acme/<region>` and the label `<region>`.
      expect(JSON.stringify([label, name, tip, qualifier, path.map((crumb) => crumb.label)])).not.toContain('acme/');
    }
  });

  it('keeps the identity object of a tab whose face and whose neighbours did not change', () => {
    const h = boot({ home: false });
    const a = h.open(service('api', 'shop', 'one'));
    const b = h.open(cloudPage('instances'), { how: 'new' });
    const before = identity(h, a);
    h.store.setPageState(b, { scroll: 1 });
    h.store.pin(b);
    expect(identity(h, a)).toBe(before);
    expect(tabOf(h, a).face.title).toBe('api · Service');
  });
});
