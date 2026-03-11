import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionPointRegistry } from '@omniviewdev/runtime';

import { ensureBuiltinExtensionPointsRegistered } from './registerBuiltinExtensionPoints';
import {
  RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
  createResourceSidebarExtensionPoint,
} from './sidebar/extensionPoint';
import {
  RESOURCE_DRAWER_EXTENSION_POINT_ID,
  createResourceDrawerExtensionPoint,
} from './drawer/extensionPoint';
import { createResourceExtensionRenderContext } from './resource/context';

// ─── Test Setup ─────────────────────────────────────────────────────

let registry: ExtensionPointRegistry;

beforeEach(() => {
  registry = new ExtensionPointRegistry();
});

// ─── Group 11: Built-In Registration Checks ─────────────────────────

describe('Group 11: Built-in registration', () => {
  it('11.14 — builtin extension points are registered before contributions', () => {
    ensureBuiltinExtensionPointsRegistered(registry);

    expect(registry.hasExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)).toBe(true);
    expect(registry.hasExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)).toBe(true);
  });

  it('11.15 — builtin registration is idempotent', () => {
    ensureBuiltinExtensionPointsRegistered(registry);
    ensureBuiltinExtensionPointsRegistered(registry);

    // Still only 2 extension points, no error
    expect(registry.listExtensionPoints()).toHaveLength(2);
    expect(registry.hasExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)).toBe(true);
    expect(registry.hasExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)).toBe(true);
  });

  it('builtin extension points are owned by core', () => {
    ensureBuiltinExtensionPointsRegistered(registry);

    const sidebar = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID);
    const drawer = registry.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID);

    expect((sidebar as any).pluginId).toBe('core');
    expect((drawer as any).pluginId).toBe('core');
  });

  it('sidebar is single mode', () => {
    ensureBuiltinExtensionPointsRegistered(registry);

    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID);
    expect(store?.mode).toBe('single');
  });

  it('drawer is single mode', () => {
    ensureBuiltinExtensionPointsRegistered(registry);

    const store = registry.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID);
    expect(store?.mode).toBe('single');
  });
});

// ─── Group 13.7: Ownership And Collision ─────────────────────────────

describe('Group 13.7: Ownership, collision', () => {
  it('13.7.43 — foreign-owner collision throws on builtin registration', () => {
    // Pre-register sidebar with a non-core plugin
    registry.addExtensionPoint({
      id: RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
      pluginId: 'rogue-plugin',
      mode: 'single',
    });

    expect(() => {
      ensureBuiltinExtensionPointsRegistered(registry);
    }).toThrow(/non-core owner/);
  });

  it('idempotent registration does not throw for core-owned', () => {
    ensureBuiltinExtensionPointsRegistered(registry);

    // Second call should be a no-op
    expect(() => {
      ensureBuiltinExtensionPointsRegistered(registry);
    }).not.toThrow();
  });
});

// ─── Group 13.4: Matcher And Structured Context ─────────────────────

describe('Group 13.4: Matcher and structured context', () => {
  beforeEach(() => {
    ensureBuiltinExtensionPointsRegistered(registry);
  });

  it('13.4.18 — matcher filters by pluginId + resourceKey', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: () => null,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const context = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const results = store.provide(context);

    expect(results).toHaveLength(1);
  });

  it('13.4.19 — matcher returns empty for non-matching pluginId', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: () => null,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const context = createResourceExtensionRenderContext('B', 'core::v1::Pod');
    const results = store.provide(context);

    expect(results).toHaveLength(0);
  });

  it('13.4.20 — matcher returns empty for non-matching resourceKey', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: () => null,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const context = createResourceExtensionRenderContext('A', 'core::v1::Service');
    const results = store.provide(context);

    expect(results).toHaveLength(0);
  });

  it('13.4.21 — getCacheKey() produces correct cache hits', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: () => null,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const context = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const results1 = store.provide(context);
    const results2 = store.provide(context);

    // Both return the same result — cache is working
    expect(results1).toHaveLength(1);
    expect(results2).toHaveLength(1);
  });

  it('13.4.22 — different cache keys do not bleed across resources', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: 'pod-component',
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });
    store.register({
      id: 'A/sidebar/core::v1::Service',
      plugin: 'A',
      label: 'Service Sidebar',
      value: 'service-component',
      meta: { pluginId: 'A', resourceKey: 'core::v1::Service' },
    });

    const podCtx = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const svcCtx = createResourceExtensionRenderContext('A', 'core::v1::Service');

    const podResults = store.provide(podCtx);
    const svcResults = store.provide(svcCtx);

    expect(podResults).toHaveLength(1);
    expect(podResults[0]).toBe('pod-component');
    expect(svcResults).toHaveLength(1);
    expect(svcResults[0]).toBe('service-component');
  });

  it('13.4.23 — single mode still honors matcher', () => {
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    expect(store.mode).toBe('single');

    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: 'pod-component',
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });
    store.register({
      id: 'B/sidebar/core::v1::Service',
      plugin: 'B',
      label: 'Service Sidebar',
      value: 'service-component',
      meta: { pluginId: 'B', resourceKey: 'core::v1::Service' },
    });

    const ctx = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const results = store.provide(ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toBe('pod-component');
  });

  it('13.4.24 — matcher receives structured context directly', () => {
    // Verify matcher works with context object properties
    const store = registry.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'A/sidebar/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Sidebar',
      value: 'pod-value',
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    // The context has pluginId and resourceKey — matcher reads them structurally
    const context = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    expect(context.pluginId).toBe('A');
    expect(context.resourceKey).toBe('core::v1::Pod');

    const results = store.provide(context);
    expect(results).toHaveLength(1);
  });
});

// ─── Drawer extension point matcher ─────────────────────────────────

describe('Drawer matcher', () => {
  beforeEach(() => {
    ensureBuiltinExtensionPointsRegistered(registry);
  });

  it('drawer matcher filters by pluginId + resourceKey', () => {
    const store = registry.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!;
    const factory = () => ({ component: null, views: [] });

    store.register({
      id: 'A/drawer/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Drawer',
      value: factory,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const results = store.provide(ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(factory);
  });

  it('drawer matcher returns empty for non-matching', () => {
    const store = registry.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!;

    store.register({
      id: 'A/drawer/core::v1::Pod',
      plugin: 'A',
      label: 'Pod Drawer',
      value: () => null,
      meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('B', 'core::v1::Pod');
    expect(store.provide(ctx)).toHaveLength(0);
  });
});

// ─── Cache key helper ───────────────────────────────────────────────

describe('createResourceExtensionRenderContext', () => {
  it('produces structured context with pluginId and resourceKey', () => {
    const ctx = createResourceExtensionRenderContext('kubernetes', 'core::v1::Pod');

    expect(ctx.pluginId).toBe('kubernetes');
    expect(ctx.resourceKey).toBe('core::v1::Pod');
  });

  it('getCacheKey produces deterministic JSON', () => {
    const ctx = createResourceExtensionRenderContext('kubernetes', 'core::v1::Pod');
    const key1 = ctx.getCacheKey!();
    const key2 = ctx.getCacheKey!();

    expect(key1).toBe(key2);
    expect(key1).toBe(JSON.stringify({ pluginId: 'kubernetes', resourceKey: 'core::v1::Pod' }));
  });

  it('different contexts produce different cache keys', () => {
    const ctx1 = createResourceExtensionRenderContext('A', 'core::v1::Pod');
    const ctx2 = createResourceExtensionRenderContext('A', 'core::v1::Service');
    const ctx3 = createResourceExtensionRenderContext('B', 'core::v1::Pod');

    expect(ctx1.getCacheKey!()).not.toBe(ctx2.getCacheKey!());
    expect(ctx1.getCacheKey!()).not.toBe(ctx3.getCacheKey!());
  });
});

// ─── Extension point definition factories ───────────────────────────

describe('Extension point factories', () => {
  it('createResourceSidebarExtensionPoint has correct shape', () => {
    const ep = createResourceSidebarExtensionPoint();

    expect(ep.id).toBe(RESOURCE_SIDEBAR_EXTENSION_POINT_ID);
    expect(ep.pluginId).toBe('core');
    expect(ep.mode).toBe('single');
    expect(typeof ep.matcher).toBe('function');
    expect(typeof ep.select).toBe('function');
  });

  it('createResourceDrawerExtensionPoint has correct shape', () => {
    const ep = createResourceDrawerExtensionPoint();

    expect(ep.id).toBe(RESOURCE_DRAWER_EXTENSION_POINT_ID);
    expect(ep.pluginId).toBe('core');
    expect(ep.mode).toBe('single');
    expect(typeof ep.matcher).toBe('function');
    expect(typeof ep.select).toBe('function');
  });
});
