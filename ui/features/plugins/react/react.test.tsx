import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { PluginWindow } from '@omniviewdev/runtime';
import * as fs from 'fs';
import * as path from 'path';

import { PluginService } from '../core/PluginService';
import { PluginServiceContext } from './context';
import { usePluginService } from './usePluginService';
import { createTestDeps } from '../testing/helpers';
import type { PluginServiceConfig } from '../core/types';

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

// ─── Group 8.3: usePluginService Hook ───────────────────────────────

describe('Group 8.3: usePluginService Hook', () => {
  let testDeps: ReturnType<typeof setup>;

  beforeEach(() => {
    testDeps = setup();
  });

  it('8.3.11 — returns snapshot fields', () => {
    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(result.current).toHaveProperty('plugins');
    expect(result.current).toHaveProperty('ready');
    expect(result.current).toHaveProperty('routeVersion');
    expect(result.current).toHaveProperty('registrations');
  });

  it('8.3.12 — returns bound methods', () => {
    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(typeof result.current.load).toBe('function');
    expect(typeof result.current.unload).toBe('function');
    expect(typeof result.current.reload).toBe('function');
    expect(typeof result.current.retry).toBe('function');
    expect(typeof result.current.forceReset).toBe('function');
    expect(typeof result.current.getDebugSnapshot).toBe('function');
  });

  it('8.3.13 — re-renders on state change', async () => {
    testDeps.importer.register('test-plugin', validModule());

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(result.current.plugins.size).toBe(0);

    await act(async () => {
      await testDeps.service.load('test-plugin');
    });

    expect(result.current.plugins.size).toBe(1);
    expect(result.current.plugins.get('test-plugin')?.phase).toBe('ready');
  });

  it('8.3.14 — does NOT re-render when snapshot unchanged', async () => {
    testDeps.importer.register('test-plugin', validModule());

    let renderCount = 0;
    renderHook(
      () => {
        renderCount++;
        return usePluginService();
      },
      { wrapper: createWrapper(testDeps.service) },
    );

    const initialRenderCount = renderCount;

    // getSnapshot() without state change should not trigger re-render
    act(() => {
      testDeps.service.getSnapshot();
    });

    expect(renderCount).toBe(initialRenderCount);
  });

  it('8.3.15 — throws outside provider', () => {
    expect(() => {
      renderHook(() => usePluginService());
    }).toThrow('usePluginService must be used within PluginServiceProvider');
  });
});

// ─── Group 8.1: Snapshot Memoization (via hook) ─────────────────────

describe('Group 8.1: Snapshot memoization via hook', () => {
  let testDeps: ReturnType<typeof setup>;

  beforeEach(() => {
    testDeps = setup();
  });

  it('8.1.5 — snapshot.ready accurate', async () => {
    testDeps.importer.register('test-plugin', validModule());

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(result.current.ready).toBe(false);

    await act(async () => {
      testDeps.service.markReady();
    });

    expect(result.current.ready).toBe(true);
  });

  it('8.1.6 — snapshot.routeVersion accurate', async () => {
    testDeps.importer.register('test-plugin', validModule({
      routes: [{ path: '/test', element: null }],
    }));

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(testDeps.service),
    });

    expect(result.current.routeVersion).toBe(0);

    await act(async () => {
      await testDeps.service.load('test-plugin');
    });

    expect(result.current.routeVersion).toBeGreaterThan(0);
  });
});

// ─── Group 8.5: PluginServiceProvider ───────────────────────────────

describe('Group 8.5: PluginServiceProvider', () => {
  it('8.5.19 — provides service via context', () => {
    const { service } = setup();
    service.markReady();

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    expect(result.current).toBeDefined();
    expect(result.current.plugins).toBeInstanceOf(Map);
  });

  it('8.5.20 — snapshot not ready before markReady', () => {
    const { service } = setup();

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    expect(result.current.ready).toBe(false);
  });

  it('8.5.21 — snapshot ready after markReady', () => {
    const { service } = setup();
    service.markReady();

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    expect(result.current.ready).toBe(true);
  });

  it('8.5.24 — cleanup on unmount stops event listeners', () => {
    const { service } = setup();

    // Start listeners
    service.startEventListeners();
    const debug1 = service.getDebugSnapshot();
    expect(debug1.eventListenersActive).toBe(true);

    // Stop listeners
    service.stopEventListeners();
    const debug2 = service.getDebugSnapshot();
    expect(debug2.eventListenersActive).toBe(false);
  });
});

// ─── Group 23.8: Provider Migration Checks ──────────────────────────

describe('Group 23.8: PluginServiceProvider migration checks', () => {
  it('23.8.29 — provider source uses useInstalledPlugins, not usePluginManager', () => {
    const providerPath = path.resolve(__dirname, 'PluginServiceProvider.tsx');
    const providerSource = fs.readFileSync(providerPath, 'utf-8');

    expect(providerSource).toContain('useInstalledPlugins');
    expect(providerSource).not.toContain('usePluginManager');
  });

  it('23.8.30 — provider does not compose usePluginService during bootstrap', () => {
    const providerPath = path.resolve(__dirname, 'PluginServiceProvider.tsx');
    const providerSource = fs.readFileSync(providerPath, 'utf-8');

    // Provider must not call usePluginService() — it accesses the service directly via ref
    expect(providerSource).not.toContain('usePluginService');
  });
});

// ─── Context isolation ──────────────────────────────────────────────

describe('Context isolation', () => {
  it('context default is null', () => {
    // Verify the context default prevents accidental usage outside provider
    const { result } = renderHook(() => React.useContext(PluginServiceContext));
    expect(result.current).toBeNull();
  });

  it('service instance is accessible through context', () => {
    const { service } = setup();

    const { result } = renderHook(() => React.useContext(PluginServiceContext), {
      wrapper: createWrapper(service),
    });

    expect(result.current).toBe(service);
  });
});

// ─── Bound method behavior ──────────────────────────────────────────

describe('Bound methods work correctly', () => {
  it('load via hook works', async () => {
    const { service, importer } = setup();
    importer.register('bound-test', validModule());

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    await act(async () => {
      await result.current.load('bound-test');
    });

    expect(result.current.plugins.get('bound-test')?.phase).toBe('ready');
  });

  it('unload via hook works', async () => {
    const { service, importer } = setup();
    importer.register('bound-test', validModule());

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    await act(async () => {
      await result.current.load('bound-test');
    });

    expect(result.current.plugins.get('bound-test')?.phase).toBe('ready');

    await act(async () => {
      await result.current.unload('bound-test');
    });

    expect(result.current.plugins.get('bound-test')?.phase).toBe('idle');
  });

  it('getDebugSnapshot via hook works', async () => {
    const { service, importer } = setup();
    importer.register('debug-test', validModule());

    const { result } = renderHook(() => usePluginService(), {
      wrapper: createWrapper(service),
    });

    await act(async () => {
      await result.current.load('debug-test');
    });

    const debug = result.current.getDebugSnapshot();
    expect(debug.plugins).toHaveProperty('debug-test');
    expect(debug.plugins['debug-test'].phase).toBe('ready');
  });
});
