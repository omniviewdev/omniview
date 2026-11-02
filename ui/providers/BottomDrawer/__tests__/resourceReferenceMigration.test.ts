import { describe, expect, it } from 'vitest';
import { buildDrawerSlot, hydrateDrawerTab, parseDrawerSlot, type DrawerSlot, type SerializedDrawerTab } from '../drawerSlot';
import { hasUnresolvedResourceReference, migrateDrawerResourceReferences } from '../resourceReferenceMigration';

function slot(opts: Record<string, unknown>, properties: Record<string, unknown> = {}): DrawerSlot {
  const tab: SerializedDrawerTab = {
    id: 'saved-session', title: 'Saved terminal', variant: 'terminal',
    properties: { pluginID: 'plugin', connectionID: 'route', opts, ...properties },
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  };
  return { version: 1, tabs: [tab], focusedId: tab.id, mode: 'expanded', height: 400 };
}

const canonical = {
  resource_plugin: 'plugin', resource_key: 'opaque/type', route: { connection: 'route' },
  reference: { address: {
    provider: 'provider', authority: 'host-issued', type: 'opaque/type',
    scope: [{ dimension: 'node', value: 'node/雪::|' }], id: '100/::|雪',
  }, incarnation: 'opaque/incarnation' },
  command: ['/bin/sh'], tty: true,
};

it('keeps complete canonical references, incarnation and utility options through save and reload', () => {
  const original = slot(canonical);
  expect(migrateDrawerResourceReferences(original)).toBe(original);
  const saved = buildDrawerSlot(original.tabs.map(hydrateDrawerTab), original.focusedId!, 'expanded', 400);
  const reloaded = migrateDrawerResourceReferences(parseDrawerSlot(JSON.parse(JSON.stringify(saved))));
  expect(reloaded).toEqual(original);
  expect(reloaded.tabs[0].properties?.opts).toEqual(canonical);
});

it('converts a complete saved reference with the tab route and retains the original options once', () => {
  const { route: _route, ...opts } = canonical;
  const original = slot(opts);
  Object.freeze(opts.reference.address.scope);
  Object.freeze(opts);
  const migrated = migrateDrawerResourceReferences(original);
  expect(migrated.tabs[0].properties?.opts).toEqual(canonical);
  expect(migrated.tabs[0].properties?.resourceReferenceMigration).toEqual({
    version: 1, status: 'converted', legacy: { opts },
  });
  expect(original.tabs[0].properties?.opts).not.toHaveProperty('route');
  expect(hasUnresolvedResourceReference(migrated.tabs[0])).toBe(false);
  const reloaded = parseDrawerSlot(JSON.parse(JSON.stringify(migrated)));
  expect(migrateDrawerResourceReferences(reloaded)).toBe(reloaded);
  expect(reloaded).toEqual(migrated);
});

it('backs up unconvertible selectors once and never guesses the missing authority or scope', () => {
  const opts = { resource_plugin: 'kubernetes', resource_key: 'core::v1::pods', params: { namespace: 'team', name: 'same' }, command: ['/bin/sh'] };
  const original = slot(opts, { legacy: { unrelated: 'keep' } });
  Object.freeze(opts.params);
  Object.freeze(opts);
  Object.freeze(original.tabs[0].properties);
  const migrated = migrateDrawerResourceReferences(original);
  expect(original.tabs[0].properties?.opts).toBe(opts);
  expect(migrated.tabs[0].properties).not.toHaveProperty('opts');
  expect(migrated.tabs[0].properties).toMatchObject({
    legacy: { unrelated: 'keep' },
    resourceReferenceMigration: { version: 1, status: 'unconvertible', legacy: { opts } },
  });
  expect(hasUnresolvedResourceReference(migrated.tabs[0])).toBe(true);
  expect(migrated.tabs[0]).toMatchObject({ id: 'saved-session', title: 'Saved terminal' });
  const saved = buildDrawerSlot(migrated.tabs.map(hydrateDrawerTab), migrated.focusedId!, 'expanded', 400);
  const reloaded = parseDrawerSlot(JSON.parse(JSON.stringify(saved)));
  expect(migrateDrawerResourceReferences(reloaded)).toBe(reloaded);
  expect(reloaded).toEqual(migrated);
});

it('retains an unknown previous migration payload without overwriting its originals', () => {
  const previous = { version: 0, legacy: 'original' };
  const opts = { resource_key: 'legacy-type' };
  const migrated = migrateDrawerResourceReferences(slot(opts, { resourceReferenceMigration: previous }));
  expect(migrated.tabs[0].properties?.resourceReferenceMigration).toEqual({
    version: 1, status: 'unconvertible', legacy: { opts, resourceReferenceMigration: previous },
  });
});

it('leaves local terminals and provider-neutral utility parameters alone', () => {
  for (const opts of [{ command: ['/bin/sh'] }, { params: { endpoint: 'https://example.test/a/b' } }]) {
    const original = slot(opts);
    expect(migrateDrawerResourceReferences(original)).toBe(original);
  }
});

describe('incomplete canonical data cannot become a guessed reference', () => {
  it.each([
    { ...canonical, route: {} },
    { ...canonical, reference: { ...canonical.reference, address: { ...canonical.reference.address, authority: '' } } },
    { ...canonical, reference: { ...canonical.reference, address: { ...canonical.reference.address, scope: undefined } } },
    { ...canonical, reference: { ...canonical.reference, address: { ...canonical.reference.address, scope: [{ dimension: 'node', value: 'one' }, { dimension: 'node', value: 'two' }] } } },
  ])('retains incomplete options in the legacy backup', opts => {
    const migrated = migrateDrawerResourceReferences(slot(opts));
    expect(hasUnresolvedResourceReference(migrated.tabs[0])).toBe(true);
    expect(migrated.tabs[0].properties).not.toHaveProperty('opts');
    expect(migrated.tabs[0].properties?.resourceReferenceMigration).toMatchObject({ legacy: { opts } });
  });
});
