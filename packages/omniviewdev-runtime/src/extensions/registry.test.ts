import { describe, it, expect, vi } from 'vitest';
import { ExtensionPointRegistry } from './registry';
import { ExtensionPointStore } from '../types/extensions';
import type { ExtensionContributionRegistration } from '../types/extensions';

// ─── helpers ──────────────────────────────────────────────────────────

function makeContext(pluginId: string, resourceKey: string): { pluginId: string; resourceKey: string; getCacheKey: () => string } {
  return {
    pluginId,
    resourceKey,
    getCacheKey: () => JSON.stringify({ pluginId, resourceKey }),
  };
}

function resourceMatcher(
  contribution: ExtensionContributionRegistration<unknown>,
  context?: { pluginId?: string; resourceKey?: string },
): boolean {
  const meta = contribution.meta as { resourceKey?: string } | undefined;
  return (
    meta?.resourceKey === context?.resourceKey &&
    contribution.plugin === context?.pluginId
  );
}

// ─── Group 15.5: Runtime Extension Registry Contract ──────────────────

describe('ExtensionPointStore', () => {
  describe('generic value type', () => {
    it('stores and provides non-component values (e.g. DrawerFactory)', () => {
      // Group 15.5 #24
      type DrawerFactory = (close: () => void) => { component: string };
      const factory: DrawerFactory = (_close) => ({ component: 'drawer' });

      const store = new ExtensionPointStore<DrawerFactory>({
        id: 'test/drawer',
        mode: 'single',
      });

      store.register({
        id: 'drawer-1',
        plugin: 'pluginA',
        label: 'Drawer',
        value: factory,
      });

      const result = store.provide();
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(factory);
      // Synchronous — not a promise
      expect(result[0]).not.toBeInstanceOf(Promise);
    });
  });

  describe('provide() synchronous guarantee', () => {
    it('returns values synchronously (Group 26.1 #1)', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/sync',
        mode: 'multiple',
      });
      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'hello' });
      const result = store.provide();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['hello']);
    });

    it('single mode provide() is synchronous and matcher-aware (Group 26.1 #4)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/single-sync',
        mode: 'single',
        matcher: (c, ctx) => c.plugin === ctx?.pluginId,
        select: (matched) => matched[0],
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val-A' });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'val-B' });

      const ctx = makeContext('B', 'any');
      const result = store.provide(ctx);
      expect(result).toEqual(['val-B']);
    });
  });

  describe('matcher in single and multiple modes', () => {
    it('matcher filters in multiple mode', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/multi-match',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'sidebar-A', meta: { resourceKey: 'core::v1::Pod' } });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'sidebar-B', meta: { resourceKey: 'core::v1::Service' } });

      const ctx = makeContext('A', 'core::v1::Pod');
      const result = store.provide(ctx);
      expect(result).toEqual(['sidebar-A']);
    });

    it('matcher honored in single mode (Group 15.5 #19)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/single-match',
        mode: 'single',
        matcher: resourceMatcher,
        select: (matched) => matched[0],
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val-A', meta: { resourceKey: 'core::v1::Pod' } });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'val-B', meta: { resourceKey: 'core::v1::Pod' } });

      const ctxA = makeContext('A', 'core::v1::Pod');
      expect(store.provide(ctxA)).toEqual(['val-A']);

      const ctxB = makeContext('B', 'core::v1::Pod');
      expect(store.provide(ctxB)).toEqual(['val-B']);
    });

    it('matcher returns empty for non-matching pluginId (Group 13.4 #19)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/no-match',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val', meta: { resourceKey: 'core::v1::Pod' } });

      const ctx = makeContext('B', 'core::v1::Pod');
      expect(store.provide(ctx)).toEqual([]);
    });

    it('matcher returns empty for non-matching resourceKey (Group 13.4 #20)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/no-match-res',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val', meta: { resourceKey: 'core::v1::Pod' } });

      const ctx = makeContext('A', 'core::v1::Service');
      expect(store.provide(ctx)).toEqual([]);
    });
  });

  describe('cache invalidation', () => {
    it('register() invalidates lookup cache (Group 15.5 #20, Group 13.5 #26)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/cache-inv',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      const ctx = makeContext('A', 'core::v1::Pod');

      // Prime cache — empty result
      expect(store.provide(ctx)).toEqual([]);

      // Register a new matching contribution
      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'new-val', meta: { resourceKey: 'core::v1::Pod' } });

      // Cache must be invalidated — new value visible
      expect(store.provide(ctx)).toEqual(['new-val']);
    });

    it('unregister() invalidates lookup cache (Group 13.5 #27)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/cache-unreg',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val', meta: { resourceKey: 'core::v1::Pod' } });

      const ctx = makeContext('A', 'core::v1::Pod');
      expect(store.provide(ctx)).toEqual(['val']);

      store.unregister('c1');
      expect(store.provide(ctx)).toEqual([]);
    });

    it('removeContributionsByPlugin() invalidates cache (Group 15.5 #21)', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/cache-remove',
        mode: 'multiple',
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val-A' });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'val-B' });

      // Prime cache
      const result1 = store.provide();
      expect(result1).toContain('val-A');
      expect(result1).toContain('val-B');

      store.removeContributionsByPlugin('A');

      const result2 = store.provide();
      expect(result2).toEqual(['val-B']);
      expect(result2).not.toContain('val-A');
    });

    it('different cache keys do not bleed results (Group 13.4 #22)', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/cache-bleed',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'Pod', value: 'pod-val', meta: { resourceKey: 'core::v1::Pod' } });
      store.register({ id: 'c2', plugin: 'A', label: 'Svc', value: 'svc-val', meta: { resourceKey: 'core::v1::Service' } });

      const podCtx = makeContext('A', 'core::v1::Pod');
      const svcCtx = makeContext('A', 'core::v1::Service');

      expect(store.provide(podCtx)).toEqual(['pod-val']);
      expect(store.provide(svcCtx)).toEqual(['svc-val']);
    });
  });

  describe('deterministic ordering', () => {
    it('list() returns results sorted by plugin then id (Group 13.7 #44)', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/order',
        mode: 'multiple',
      });

      // Register in non-alphabetical order
      store.register({ id: 'z-contrib', plugin: 'B', label: 'Z', value: 'z' });
      store.register({ id: 'a-contrib', plugin: 'B', label: 'A', value: 'a' });
      store.register({ id: 'b-contrib', plugin: 'A', label: 'B', value: 'b' });
      store.register({ id: 'c-contrib', plugin: 'A', label: 'C', value: 'c' });

      const result = store.list();
      const ids = result.map((c) => c.id);
      expect(ids).toEqual(['b-contrib', 'c-contrib', 'a-contrib', 'z-contrib']);
    });
  });

  describe('subscriptions', () => {
    it('subscribe fires on register (Group 15.5 #22)', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/sub',
        mode: 'multiple',
      });

      const listener = vi.fn();
      store.subscribe(listener);

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribe fires on unregister', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/sub-unreg',
        mode: 'multiple',
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val' });

      const listener = vi.fn();
      store.subscribe(listener);

      store.unregister('c1');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops notifications', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/unsub',
        mode: 'multiple',
      });

      const listener = vi.fn();
      const unsub = store.subscribe(listener);

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.register({ id: 'c2', plugin: 'A', label: 'C2', value: 'val2' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribe fires on removeContributionsByPlugin', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/sub-remove',
        mode: 'multiple',
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val' });

      const listener = vi.fn();
      store.subscribe(listener);

      store.removeContributionsByPlugin('A');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicate contribution ID', () => {
    it('throws on duplicate contribution ID', () => {
      const store = new ExtensionPointStore<string>({
        id: 'test/dup',
        mode: 'multiple',
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val' });
      expect(() =>
        store.register({ id: 'c1', plugin: 'B', label: 'C1b', value: 'val2' }),
      ).toThrow(/already exists/);
    });
  });

  describe('listAll', () => {
    it('returns all contributions regardless of matcher', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/listall',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val1', meta: { resourceKey: 'core::v1::Pod' } });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'val2', meta: { resourceKey: 'core::v1::Service' } });

      expect(store.listAll()).toHaveLength(2);
    });
  });

  describe('list() and provide() consistency', () => {
    it('list() and provide() use the same matching semantics', () => {
      const store = new ExtensionPointStore<string, { pluginId: string; resourceKey: string; getCacheKey: () => string }>({
        id: 'test/consistency',
        mode: 'multiple',
        matcher: resourceMatcher,
      });

      store.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'val-A', meta: { resourceKey: 'core::v1::Pod' } });
      store.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'val-B', meta: { resourceKey: 'core::v1::Pod' } });

      const ctx = makeContext('A', 'core::v1::Pod');
      const listed = store.list(ctx);
      const provided = store.provide(ctx);

      expect(listed.map((c) => c.value)).toEqual(provided);
    });
  });
});

// ─── ExtensionPointRegistry ──────────────────────────────────────────

describe('ExtensionPointRegistry', () => {
  describe('addExtensionPoint', () => {
    it('adds an extension point', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'test/ep', mode: 'multiple' });
      expect(registry.hasExtensionPoint('test/ep')).toBe(true);
    });

    it('throws on duplicate extension point ID (Group 13.7 #42)', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'test/ep', pluginId: 'A', mode: 'multiple' });
      expect(() =>
        registry.addExtensionPoint({ id: 'test/ep', pluginId: 'B', mode: 'single' }),
      ).toThrow(/already exists/);
    });
  });

  describe('getExtensionPoint', () => {
    it('returns the store for an existing EP', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'my-ep', mode: 'multiple' });
      const store = registry.getExtensionPoint('my-ep');
      expect(store).toBeDefined();
      expect(store!.id).toBe('my-ep');
    });

    it('returns undefined for non-existent EP', () => {
      const registry = new ExtensionPointRegistry();
      expect(registry.getExtensionPoint('nope')).toBeUndefined();
    });
  });

  describe('listExtensionPoints', () => {
    it('lists all EP IDs', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'ep1', mode: 'multiple' });
      registry.addExtensionPoint({ id: 'ep2', mode: 'single' });
      expect(registry.listExtensionPoints()).toEqual(['ep1', 'ep2']);
    });
  });

  describe('removeExtensionPoints(pluginId)', () => {
    it('removes extension points owned by the plugin (Group 15.5 #23)', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'plugin-ep', pluginId: 'pluginA', mode: 'multiple' });
      registry.addExtensionPoint({ id: 'core-ep', pluginId: 'core', mode: 'multiple' });

      registry.removeExtensionPoints('pluginA');

      expect(registry.hasExtensionPoint('plugin-ep')).toBe(false);
      expect(registry.hasExtensionPoint('core-ep')).toBe(true);
    });

    it('notifies subscribers on removal (Group 13.5 #28)', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'plugin-ep', pluginId: 'A', mode: 'multiple' });

      const listener = vi.fn();
      registry.subscribe(listener);

      registry.removeExtensionPoints('A');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeContributions(pluginId)', () => {
    it('removes all contributions from a plugin across all EPs', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'ep1', mode: 'multiple' });
      registry.addExtensionPoint({ id: 'ep2', mode: 'multiple' });

      const ep1 = registry.getExtensionPoint<string>('ep1')!;
      const ep2 = registry.getExtensionPoint<string>('ep2')!;

      ep1.register({ id: 'c1', plugin: 'A', label: 'C1', value: 'v1' });
      ep1.register({ id: 'c2', plugin: 'B', label: 'C2', value: 'v2' });
      ep2.register({ id: 'c3', plugin: 'A', label: 'C3', value: 'v3' });

      registry.removeContributions('A');

      expect(ep1.listAll()).toHaveLength(1);
      expect(ep1.listAll()[0].plugin).toBe('B');
      expect(ep2.listAll()).toHaveLength(0);
    });
  });

  describe('subscriptions', () => {
    it('subscribe fires on addExtensionPoint', () => {
      const registry = new ExtensionPointRegistry();
      const listener = vi.fn();
      registry.subscribe(listener);

      registry.addExtensionPoint({ id: 'ep1', mode: 'multiple' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribe fires on removeExtensionPoints', () => {
      const registry = new ExtensionPointRegistry();
      registry.addExtensionPoint({ id: 'ep1', pluginId: 'A', mode: 'multiple' });

      const listener = vi.fn();
      registry.subscribe(listener);

      registry.removeExtensionPoints('A');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops notifications', () => {
      const registry = new ExtensionPointRegistry();
      const listener = vi.fn();
      const unsub = registry.subscribe(listener);

      registry.addExtensionPoint({ id: 'ep1', mode: 'multiple' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      registry.addExtensionPoint({ id: 'ep2', mode: 'single' });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('initialStores constructor option', () => {
    it('accepts initial stores', () => {
      const registry = new ExtensionPointRegistry({
        initialStores: [{ id: 'init-ep', mode: 'multiple' }],
      });
      expect(registry.hasExtensionPoint('init-ep')).toBe(true);
    });
  });
});
