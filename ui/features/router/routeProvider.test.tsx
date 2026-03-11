import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { PluginWindow } from '@omniviewdev/runtime';
import * as fs from 'fs';
import * as path from 'path';

import { PluginService } from '../plugins/core/PluginService';
import { PluginServiceContext } from '../plugins/react/context';
import { usePluginRoutes } from '../plugins/react/usePluginRoutes';
import { createTestDeps } from '../plugins/testing/helpers';
import type { PluginServiceConfig, PluginDescriptor } from '../plugins/core/types';

// ─── Module Factories ───────────────────────────────────────────────

function validModule(overrides?: {
  routes?: any[];
  sidebars?: Record<string, () => null>;
  drawers?: Record<string, () => any>;
  extensionRegistrations?: any[];
}) {
  const pw = new PluginWindow();
  if (overrides?.routes) {
    pw.withRoutes(overrides.routes);
  }
  return {
    plugin: pw,
    extensionRegistrations: overrides?.extensionRegistrations ?? [],
    sidebars: overrides?.sidebars ?? {},
    drawers: overrides?.drawers ?? {},
  };
}

// ─── Test Setup ─────────────────────────────────────────────────────

function setup(config?: Partial<PluginServiceConfig>) {
  const testDeps = createTestDeps();
  const service = new PluginService(testDeps.deps, config);
  return { service, ...testDeps };
}

function createWrapper(service: PluginService) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PluginServiceContext.Provider value={service}>
        {children}
      </PluginServiceContext.Provider>
    );
  };
}

// ─── Group 22: Route Building ───────────────────────────────────────

describe('Group 22: Route Building', () => {
  let testDeps: ReturnType<typeof setup>;

  beforeEach(() => {
    testDeps = setup();
  });

  it('22.1 — routes built from plugin modules', async () => {
    const route1 = { path: 'pluginA/page1', element: React.createElement('div') };
    const route2 = { path: 'pluginA/page2', element: React.createElement('div') };
    const route3 = { path: 'pluginB/page1', element: React.createElement('div') };

    testDeps.importer.register('pluginA', validModule({ routes: [route1, route2] }));
    testDeps.importer.register('pluginB', validModule({ routes: [route3] }));

    const descriptors: PluginDescriptor[] = [
      { id: 'pluginA', dev: false },
      { id: 'pluginB', dev: false },
    ];

    await testDeps.service.loadAll(descriptors);
    testDeps.service.markReady();

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    // Each plugin gets a wrapper route — 2 plugins = 2 wrapper routes
    expect(result.current.routes).toHaveLength(2);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[1].path).toBe('pluginB');
    // Children include plugin routes + catch-all not-found
    expect(result.current.routes[0].children).toHaveLength(3); // 2 routes + notFound
    expect(result.current.routes[1].children).toHaveLength(2); // 1 route + notFound
    expect(result.current.ready).toBe(true);
  });

  it('22.2 — route version tracks changes', async () => {
    testDeps.importer.register('pluginA', validModule({
      routes: [{ path: 'a', element: React.createElement('div') }],
    }));
    testDeps.importer.register('pluginB', validModule({
      routes: [{ path: 'b', element: React.createElement('div') }],
    }));

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    const v0 = result.current.routeVersion;

    await act(async () => {
      await testDeps.service.load('pluginA');
    });
    const v1 = result.current.routeVersion;
    expect(v1).toBeGreaterThan(v0);

    await act(async () => {
      await testDeps.service.unload('pluginA');
    });
    const v2 = result.current.routeVersion;
    expect(v2).toBeGreaterThan(v1);

    await act(async () => {
      await testDeps.service.load('pluginB');
    });
    const v3 = result.current.routeVersion;
    expect(v3).toBeGreaterThan(v2);
  });

  it('22.3 — empty Routes array OK', async () => {
    testDeps.importer.register('pluginA', validModule({ routes: [] }));

    await act(async () => {
      await testDeps.service.load('pluginA');
    });

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    // Plugin still gets a wrapper route even with empty routes (contains only catch-all)
    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[0].children).toHaveLength(1); // only notFound
  });

  it('22.4 — Routes undefined OK', async () => {
    // Plugin with no routes at all
    testDeps.importer.register('pluginA', validModule());

    await act(async () => {
      await testDeps.service.load('pluginA');
    });

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    // Plugin still gets a wrapper route (contains only catch-all)
    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[0].children).toHaveLength(1); // only notFound
  });

  it('22.5 — route deduplication — both present', async () => {
    const samePath = 'shared/path';
    testDeps.importer.register('pluginA', validModule({
      routes: [{ path: samePath, element: React.createElement('div') }],
    }));
    testDeps.importer.register('pluginB', validModule({
      routes: [{ path: samePath, element: React.createElement('div') }],
    }));

    const descriptors: PluginDescriptor[] = [
      { id: 'pluginA', dev: false },
      { id: 'pluginB', dev: false },
    ];

    await testDeps.service.loadAll(descriptors);
    testDeps.service.markReady();

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    // Both plugins get wrapper routes — routes are namespaced by plugin ID
    expect(result.current.routes).toHaveLength(2);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[1].path).toBe('pluginB');
    // Each wrapper's children contain the same path (namespacing prevents conflicts)
    expect(result.current.routes[0].children![0].path).toBe(samePath);
    expect(result.current.routes[1].children![0].path).toBe(samePath);
  });

  it('22.6 — reload replaces routes', async () => {
    const route1 = { path: 'a/old', element: React.createElement('div') };
    const route2 = { path: 'a/new', element: React.createElement('div') };

    testDeps.importer.register('pluginA', validModule({ routes: [route1] }));

    await act(async () => {
      await testDeps.service.load('pluginA');
    });

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[0].children![0].path).toBe('a/old');

    // Replace module and reload
    testDeps.importer.register('pluginA', validModule({ routes: [route2] }));

    await act(async () => {
      await testDeps.service.reload('pluginA');
    });

    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0].path).toBe('pluginA');
    expect(result.current.routes[0].children![0].path).toBe('a/new');
  });

  it('22.7 — routeVersion triggers rebuild detection', async () => {
    testDeps.importer.register('pluginA', validModule({
      routes: [{ path: 'a', element: React.createElement('div') }],
    }));

    const { result } = renderHook(() => usePluginRoutes(), {
      wrapper: createWrapper(testDeps.service),
    });

    const versionBefore = result.current.routeVersion;

    await act(async () => {
      await testDeps.service.load('pluginA');
    });

    expect(result.current.routeVersion).toBeGreaterThan(versionBefore);
    expect(result.current.routes).toHaveLength(1);
  });
});

// ─── Group 23.6: RouteProvider Consumer Migration Checks ────────────

describe('Group 23.6: RouteProvider Consumer Migration', () => {
  const routeProviderPath = path.resolve(__dirname, 'RouteProvider.tsx');

  it('23.6.19 — uses usePluginRoutes for routes', () => {
    const source = fs.readFileSync(routeProviderPath, 'utf-8');
    expect(source).toContain('usePluginRoutes');
    // Imported from barrel
    expect(source).toMatch(/@\/features\/plugins/);
  });

  it('23.6.20 — no import of PluginRegistryContext', () => {
    const source = fs.readFileSync(routeProviderPath, 'utf-8');
    expect(source).not.toContain('PluginRegistryContext');
  });

  it('23.6.21 — no getAllPluginRoutes import', () => {
    const source = fs.readFileSync(routeProviderPath, 'utf-8');
    expect(source).not.toContain('getAllPluginRoutes');
    expect(source).not.toContain('PluginManager');
  });

  it('23.6.bonus — no recalc_routes listener', () => {
    const source = fs.readFileSync(routeProviderPath, 'utf-8');
    expect(source).not.toContain('recalc_routes');
    expect(source).not.toContain('EventsOn');
  });

  it('23.6.app — App.tsx uses PluginServiceProvider, not PluginRegistryProvider', () => {
    const appPath = path.resolve(__dirname, '..', '..', 'App.tsx');
    const source = fs.readFileSync(appPath, 'utf-8');
    expect(source).toContain('PluginServiceProvider');
    expect(source).not.toContain('PluginRegistryProvider');
  });
});
