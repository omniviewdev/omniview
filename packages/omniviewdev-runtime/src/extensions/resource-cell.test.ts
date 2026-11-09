import { describe, expect, it } from 'vitest';
import { ExtensionPointRegistry } from './registry';
import type { ExtensionContributionRegistration } from '../types/extensions';
import {
  RESOURCE_CELL_EXTENSION_POINT_ID,
  type ResourceCellContext,
  type ResourceCellContribution,
} from '../types/resource-cell';
import {
  createResourceCellExtensionPoint,
  matchesResourceCell,
  resolveResourceCell,
  validateResourceCellContribution,
} from './resource-cell';

const cell: ResourceCellContribution = { contractVersion: 1, name: 'status', component: () => null };

const registration = (
  id: string,
  plugin: string,
  value: Partial<ResourceCellContribution> = {},
): ExtensionContributionRegistration<ResourceCellContribution> => ({ id, plugin, label: id, value: { ...cell, ...value } });

const context = (pluginId = 'native', resourceKey = 'widgets', component = 'status'): ResourceCellContext => ({ pluginId, resourceKey, component });

describe('validateResourceCellContribution', () => {
  it('admits function, memo-like and lazy-like components and optional narrowing', () => {
    expect(validateResourceCellContribution(cell)).toBeNull();
    expect(validateResourceCellContribution({ ...cell, component: { $$typeof: Symbol.for('react.memo') } })).toBeNull();
    expect(validateResourceCellContribution({ ...cell, component: { $$typeof: Symbol.for('react.lazy') } })).toBeNull();
    expect(validateResourceCellContribution({ ...cell, resourceKeys: ['widgets', 'gadgets'], providers: ['other'] })).toBeNull();
  });

  it.each([
    ['a non-object', 'status'],
    ['an unsupported contract version', { ...cell, contractVersion: 2 }],
    ['a missing name', { ...cell, name: undefined }],
    ['a blank name', { ...cell, name: '  ' }],
    ['a non-string name', { ...cell, name: 7 }],
    ['empty resource keys', { ...cell, resourceKeys: [] }],
    ['non-array resource keys', { ...cell, resourceKeys: 'widgets' }],
    ['non-string resource keys', { ...cell, resourceKeys: ['widgets', 4] }],
    ['blank resource keys', { ...cell, resourceKeys: [' '] }],
    ['duplicate resource keys', { ...cell, resourceKeys: ['widgets', 'widgets'] }],
    ['wildcard resource keys', { ...cell, resourceKeys: ['*'] }],
    ['empty providers', { ...cell, providers: [] }],
    ['duplicate providers', { ...cell, providers: ['other', 'other'] }],
    ['a missing component', { ...cell, component: undefined }],
    ['a string component', { ...cell, component: 'StatusCell' }],
    ['a plain object component', { ...cell, component: {} }],
  ])('rejects %s with a diagnostic', (_, value) => {
    expect(validateResourceCellContribution(value)).toEqual(expect.any(String));
  });

  it('never echoes contributor values in diagnostics', () => {
    const diagnostics = [
      validateResourceCellContribution({ ...cell, resourceKeys: ['secret-token*'] }),
      validateResourceCellContribution({ ...cell, providers: ['secret-token', 'secret-token'] }),
      validateResourceCellContribution({ ...cell, component: 'secret-token' }),
      validateResourceCellContribution({ ...cell, contractVersion: 'secret-token' }),
    ];
    for (const diagnostic of diagnostics) {
      expect(diagnostic).not.toBeNull();
      expect(diagnostic).not.toContain('secret-token');
    }
  });
});

describe('resource cell resolution', () => {
  it('resolves only the declaring plugin, from the host-assigned registration owner', () => {
    const own = registration('native/status', 'native');
    expect(resolveResourceCell([own], context('native'))).toEqual({ status: 'resolved', registration: own });
    expect(resolveResourceCell([own], context('other')).status).toBe('missing');
  });

  it('never grants ownership from descriptor fields', () => {
    const forged = registration('rogue/status', 'rogue', {
      ...({ plugin: 'native', pluginId: 'native', owner: 'native' } as object),
    });
    forged.meta = { pluginId: 'native', plugin: 'native' };
    expect(matchesResourceCell(forged, context('native'))).toBe(false);
    expect(resolveResourceCell([forged], context('native')).status).toBe('missing');
  });

  it('matches component names exactly', () => {
    const own = registration('native/status', 'native');
    expect(resolveResourceCell([own], context('native', 'widgets', 'Status')).status).toBe('missing');
    expect(resolveResourceCell([own], context('native', 'widgets', 'status ')).status).toBe('missing');
  });

  it('compares opaque resource type IDs for equality, without parsing them', () => {
    const scoped = registration('native/status', 'native', { resourceKeys: ['k8s:/pods'] });
    expect(resolveResourceCell([scoped], context('native', 'k8s:/pods')).status).toBe('resolved');
    expect(resolveResourceCell([scoped], context('native', 'k8s:core/pods')).status).toBe('missing');
    expect(resolveResourceCell([scoped], context('native', 'k8s:/pod')).status).toBe('missing');
    expect(resolveResourceCell([scoped], context('native', 'K8S:/PODS')).status).toBe('missing');
  });

  it('serves every resource type when the contribution does not narrow types', () => {
    const wide = registration('native/status', 'native');
    expect(resolveResourceCell([wide], context('native', 'anything')).status).toBe('resolved');
  });

  it('prefers an exact resource type over a type-agnostic renderer regardless of order', () => {
    const wide = registration('native/a-wide', 'native');
    const exact = registration('native/z-exact', 'native', { resourceKeys: ['widgets'] });
    expect(resolveResourceCell([wide, exact], context()).status).toBe('resolved');
    expect(resolveResourceCell([exact, wide], context())).toEqual({ status: 'resolved', registration: exact });
    expect(resolveResourceCell([exact, wide], context('native', 'gadgets'))).toEqual({ status: 'resolved', registration: wide });
  });

  it('lets a renderer serve another provider only when it lists that provider', () => {
    const unlisted = registration('helper/status', 'helper');
    const listed = registration('helper/status', 'helper', { providers: ['native'] });
    expect(resolveResourceCell([unlisted], context('native')).status).toBe('missing');
    expect(resolveResourceCell([listed], context('native'))).toEqual({ status: 'resolved', registration: listed });
    expect(resolveResourceCell([listed], context('third')).status).toBe('missing');
  });

  it('keeps a foreign opt-in subject to its resource type narrowing', () => {
    const listed = registration('helper/status', 'helper', { providers: ['native'], resourceKeys: ['gadgets'] });
    expect(resolveResourceCell([listed], context('native', 'widgets')).status).toBe('missing');
    expect(resolveResourceCell([listed], context('native', 'gadgets')).status).toBe('resolved');
  });

  it('prefers the provider’s own contribution over an opted-in foreign renderer', () => {
    const foreignExact = registration('helper/status', 'helper', { providers: ['native'], resourceKeys: ['widgets'] });
    const ownWide = registration('native/status', 'native');
    expect(resolveResourceCell([foreignExact, ownWide], context())).toEqual({ status: 'resolved', registration: ownWide });
  });

  it('reports equally specific candidates as ambiguous instead of picking by registration order', () => {
    const first = registration('helper-a/status', 'helper-a', { providers: ['native'] });
    const second = registration('helper-b/status', 'helper-b', { providers: ['native'] });
    expect(resolveResourceCell([first, second], context())).toEqual({ status: 'ambiguous', registrations: [first, second] });
    expect(resolveResourceCell([second, first], context())).toEqual({ status: 'ambiguous', registrations: [second, first] });
    const duplicateOwn = registration('native/status-2', 'native');
    expect(resolveResourceCell([registration('native/status', 'native'), duplicateOwn], context()).status).toBe('ambiguous');
  });

  it('resolves missing for empty inventories and never throws on malformed values', () => {
    expect(resolveResourceCell([], context())).toEqual({ status: 'missing' });
    const malformed = [
      { id: 'a', plugin: 'native', label: '', value: null },
      { id: 'b', plugin: 'native', label: '', value: 'status' },
      { id: 'c', plugin: 'native', label: '', value: { name: 'status', providers: 7, resourceKeys: 'widgets' } },
    ] as unknown as ExtensionContributionRegistration<ResourceCellContribution>[];
    expect(() => resolveResourceCell(malformed, context())).not.toThrow();
  });
});

describe('resource cell extension point', () => {
  const create = () => {
    const registry = new ExtensionPointRegistry({ initialStores: [createResourceCellExtensionPoint()] });
    return { registry, store: registry.getExtensionPoint<ResourceCellContribution, ResourceCellContext>(RESOURCE_CELL_EXTENSION_POINT_ID)! };
  };

  it('is core-owned', () => {
    const { store } = create();
    expect(store.pluginId).toBe('core');
    expect(store.id).toBe(RESOURCE_CELL_EXTENSION_POINT_ID);
  });

  it('rejects malformed and duplicate descriptors without storing them', () => {
    const { store } = create();
    const valid = registration('native/status', 'native');
    store.register(valid);
    expect(() => store.register(valid)).toThrow(/already exists/);
    expect(() => store.register(registration('native/bad', 'native', { contractVersion: 9 as 1 }))).toThrow('Unsupported resource cell contract.');
    expect(() => store.register(registration('native/worse', 'native', { name: '' }))).toThrow();
    expect(store.listAll()).toEqual([valid]);
  });

  it('applies the same matcher through the store as through resolution', () => {
    const { store } = create();
    store.register(registration('native/status', 'native', { resourceKeys: ['widgets'] }));
    store.register(registration('helper/status', 'helper'));
    store.register(registration('helper/other', 'helper', { name: 'other', providers: ['native'] }));
    expect(store.list(context('native', 'widgets')).map(entry => entry.id)).toEqual(['native/status']);
    expect(store.list(context('native', 'gadgets'))).toEqual([]);
    expect(store.list(context('native', 'widgets', 'other')).map(entry => entry.id)).toEqual(['helper/other']);

    const cached = { ...context('native', 'widgets'), getCacheKey: () => 'native|widgets|status' };
    expect(store.list(cached).map(entry => entry.id)).toEqual(['native/status']);
    store.unregister('native/status');
    expect(store.list(cached)).toEqual([]);
  });

  it('drops a plugin’s contributions on removal so no renderer reference remains', () => {
    const { registry, store } = create();
    store.register(registration('native/status', 'native'));
    store.register(registration('helper/status', 'helper', { providers: ['native'] }));
    registry.removeContributions('native');
    expect(store.listAll().map(entry => entry.id)).toEqual(['helper/status']);
    registry.removeContributions('helper');
    expect(store.listAll()).toEqual([]);
    expect(resolveResourceCell(store.listAll(), context()).status).toBe('missing');
  });
});
