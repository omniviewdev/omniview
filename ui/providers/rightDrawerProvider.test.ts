import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';

import { createTestDeps } from '../features/plugins/testing/helpers';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '../features/extensions/drawer/extensionPoint';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '../features/extensions/sidebar/extensionPoint';
import { createResourceSidebarExtensionPoint } from '../features/extensions/sidebar/extensionPoint';
import { createResourceDrawerExtensionPoint } from '../features/extensions/drawer/extensionPoint';
import { createResourceExtensionRenderContext } from '../features/extensions/resource/context';

// ─── Group 23.7: RightDrawerProvider Consumer Migration ─────────────

describe('Group 23.7: RightDrawerProvider Consumer Migration', () => {
  const rightDrawerPath = path.resolve(__dirname, 'RightDrawerProvider.tsx');

  it('23.7.22 — no import of getSidebarComponent', () => {
    const source = fs.readFileSync(rightDrawerPath, 'utf-8');
    expect(source).not.toContain('getSidebarComponent');
  });

  it('23.7.23 — no import of getDrawerFactory from PluginManager', () => {
    const source = fs.readFileSync(rightDrawerPath, 'utf-8');
    expect(source).not.toContain('getDrawerFactory');
    expect(source).not.toContain('PluginManager');
  });

  it('23.7.24 — uses useExtensionPoint for sidebars and drawers', () => {
    const source = fs.readFileSync(rightDrawerPath, 'utf-8');
    expect(source).toContain('useExtensionPoint');
    // Uses the imported constant names for extension point IDs
    expect(source).toContain('RESOURCE_DRAWER_EXTENSION_POINT_ID');
    expect(source).toContain('RESOURCE_SIDEBAR_EXTENSION_POINT_ID');
  });

  it('23.7.25 — calls provide() with structured render context', () => {
    const source = fs.readFileSync(rightDrawerPath, 'utf-8');
    expect(source).toContain('createResourceExtensionRenderContext');
    // Uses structured context via provide()
    expect(source).toMatch(/\.provide\(/);
  });

  it('23.7.26 — no flattened pluginId::resourceKey lookup strings', () => {
    const source = fs.readFileSync(rightDrawerPath, 'utf-8');
    // No flattened string pattern like ${pluginId}::${resourceKey}
    expect(source).not.toMatch(/\$\{.*\}::\$\{.*\}/);
    expect(source).not.toMatch(/pluginI[dD]\s*\+\s*['"]::['"]|['"]::[']\s*\+\s*resource/);
  });
});

// ─── Group 26: Synchronous Render Guarantee (applicable checks) ─────

describe('Group 26: Synchronous Render Guarantee', () => {
  it('26.1 — provide() returns synchronously (not a Promise)', () => {
    const { extensions } = createTestDeps();

    // Register sidebar extension point
    extensions.addExtensionPoint(createResourceSidebarExtensionPoint());

    // Register a sidebar contribution
    const sidebarComponent = () => React.createElement('div');
    const store = extensions.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'test/sidebar/core::v1::Pod',
      plugin: 'test-plugin',
      label: 'Test Sidebar',
      value: sidebarComponent,
      meta: { pluginId: 'test-plugin', resourceKey: 'core::v1::Pod' },
    });

    // Call provide with structured context
    const context = createResourceExtensionRenderContext('test-plugin', 'core::v1::Pod');
    const result = store.provide(context);

    // Must be synchronous — not a Promise
    expect(result).toBeInstanceOf(Array);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sidebarComponent);
  });

  it('26.2 — provide() with structured sidebar context returns synchronously', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceSidebarExtensionPoint());

    const SidebarComp = () => React.createElement('div', null, 'sidebar');
    const store = extensions.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'pluginA/sidebar/core::v1::Pod',
      plugin: 'pluginA',
      label: 'Pod Sidebar',
      value: SidebarComp,
      meta: { pluginId: 'pluginA', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('pluginA', 'core::v1::Pod');
    const values = store.provide(ctx);
    expect(values).toHaveLength(1);
    expect(values[0]).toBe(SidebarComp);
  });

  it('26.3 — provide() with structured drawer context returns synchronously', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceDrawerExtensionPoint());

    const drawerFactory = (_close: () => void) => ({ component: 'drawer' });
    const store = extensions.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!;
    store.register({
      id: 'pluginA/drawer/core::v1::Pod',
      plugin: 'pluginA',
      label: 'Pod Drawer',
      value: drawerFactory,
      meta: { pluginId: 'pluginA', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('pluginA', 'core::v1::Pod');
    const values = store.provide(ctx);
    expect(values).toHaveLength(1);
    expect(values[0]).toBe(drawerFactory);
  });

  it('26.4 — single mode provide() is synchronous and matcher-aware', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceSidebarExtensionPoint());

    const SidebarA = () => React.createElement('div', null, 'A');
    const SidebarB = () => React.createElement('div', null, 'B');
    const store = extensions.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;

    store.register({
      id: 'pluginA/sidebar/core::v1::Pod',
      plugin: 'pluginA',
      label: 'A',
      value: SidebarA,
      meta: { pluginId: 'pluginA', resourceKey: 'core::v1::Pod' },
    });
    store.register({
      id: 'pluginB/sidebar/core::v1::Service',
      plugin: 'pluginB',
      label: 'B',
      value: SidebarB,
      meta: { pluginId: 'pluginB', resourceKey: 'core::v1::Service' },
    });

    // Query for pluginA's Pod sidebar
    const ctxA = createResourceExtensionRenderContext('pluginA', 'core::v1::Pod');
    const resultA = store.provide(ctxA);
    expect(resultA).toHaveLength(1);
    expect(resultA[0]).toBe(SidebarA);

    // Query for pluginB's Service sidebar
    const ctxB = createResourceExtensionRenderContext('pluginB', 'core::v1::Service');
    const resultB = store.provide(ctxB);
    expect(resultB).toHaveLength(1);
    expect(resultB[0]).toBe(SidebarB);
  });

  it('26.6 — drawer factory call is synchronous', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceDrawerExtensionPoint());

    const factoryResult = { header: 'test', body: 'body' };
    const drawerFactory = (_close: () => void) => factoryResult;
    const store = extensions.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!;
    store.register({
      id: 'pluginA/drawer/core::v1::Pod',
      plugin: 'pluginA',
      label: 'Pod Drawer',
      value: drawerFactory,
      meta: { pluginId: 'pluginA', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('pluginA', 'core::v1::Pod');
    const factory = store.provide(ctx)[0] as (_close: () => void) => any;
    const result = factory(() => {});

    // Factory call returns immediately — not a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBe(factoryResult);
  });

  // ─── 26.2 Prohibited Pattern Grep Checks ───────────────────────────

  it('26.9 — no dynamic import() in RightDrawerProvider render paths', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'RightDrawerProvider.tsx'),
      'utf-8',
    );
    // No dynamic import() calls in the file
    expect(source).not.toMatch(/\bimport\s*\(/);
  });

  it('26.12 — no extension point consumer triggers load()/importPlugin() during lookup', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'RightDrawerProvider.tsx'),
      'utf-8',
    );
    expect(source).not.toContain('importPlugin');
    expect(source).not.toContain('.load(');
  });
});

// ─── Group 26.2 Prohibited Pattern: Legacy normalization path ────────

describe('Group 26.2: Legacy exports work through normalized contributions', () => {
  it('legacy sidebar exports are accessible via extension point after normalization', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceSidebarExtensionPoint());

    // Simulate what normalization + PluginService does: registers contributions
    // from legacy sidebars into the extension point
    const LegacySidebar = () => React.createElement('div', null, 'legacy');
    const store = extensions.getExtensionPoint(RESOURCE_SIDEBAR_EXTENSION_POINT_ID)!;
    store.register({
      id: 'legacy-plugin/sidebar/core::v1::Pod',
      plugin: 'legacy-plugin',
      label: 'Legacy Pod Sidebar',
      value: LegacySidebar,
      meta: { pluginId: 'legacy-plugin', resourceKey: 'core::v1::Pod' },
    });

    // Consumer resolves via extension point — same path as new plugins
    const ctx = createResourceExtensionRenderContext('legacy-plugin', 'core::v1::Pod');
    const result = store.provide(ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(LegacySidebar);
  });

  it('legacy drawer exports are accessible via extension point after normalization', () => {
    const { extensions } = createTestDeps();
    extensions.addExtensionPoint(createResourceDrawerExtensionPoint());

    const legacyFactory = (_close: () => void) => ({ component: 'legacy-drawer' });
    const store = extensions.getExtensionPoint(RESOURCE_DRAWER_EXTENSION_POINT_ID)!;
    store.register({
      id: 'legacy-plugin/drawer/core::v1::Pod',
      plugin: 'legacy-plugin',
      label: 'Legacy Pod Drawer',
      value: legacyFactory,
      meta: { pluginId: 'legacy-plugin', resourceKey: 'core::v1::Pod' },
    });

    const ctx = createResourceExtensionRenderContext('legacy-plugin', 'core::v1::Pod');
    const result = store.provide(ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(legacyFactory);
  });
});
