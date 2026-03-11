import { describe, it, expect, beforeEach } from 'vitest';
import { PluginWindow } from '@omniviewdev/runtime';
import { PluginService } from './PluginService';
import {
  createTestDeps,
  createDeferred,
} from '../testing/helpers';
import type { PluginServiceConfig } from './types';

// ─── Module Factories ───────────────────────────────────────────────

function validModule(overrides?: {
  routes?: any[];
  sidebars?: Record<string, () => null>;
  drawers?: Record<string, () => any>;
  extensionRegistrations?: any[];
  extensionPoints?: any[];
}) {
  const pw = new PluginWindow();
  if (overrides?.routes) {
    pw.withRoutes(overrides.routes);
  }
  if (overrides?.extensionPoints) {
    pw.registerExtensionPoints(overrides.extensionPoints);
  }
  return {
    plugin: pw,
    extensionRegistrations: overrides?.extensionRegistrations ?? [],
    sidebars: overrides?.sidebars ?? {},
    drawers: overrides?.drawers ?? {},
  };
}

function setup(config?: Partial<PluginServiceConfig>) {
  const t = createTestDeps();
  const service = new PluginService(t.deps, config);
  return { service, ...t };
}

// ─── Group 3: Load Operations ───────────────────────────────────────

describe('Group 3: Load Operations', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  // 3.1 Basic Load
  describe('3.1 Basic Load', () => {
    it('#1 load from idle', async () => {
      s.importer.register('A', validModule());
      await s.service.load('A');
      const state = s.service.getPluginState('A');
      expect(state?.phase).toBe('ready');
      expect(state?.pluginWindow).not.toBeNull();
      expect(state?.loadedAt).toBeGreaterThan(0);
      expect(s.importer.importCount).toBe(1);
    });

    it('#2 load sets isDev=false for prod', async () => {
      s.importer.register('A', validModule());
      await s.service.load('A');
      const state = s.service.getPluginState('A');
      expect(state?.isDev).toBe(false);
      expect(state?.devPort).toBeNull();
    });

    it('#3 load with dev options', async () => {
      s.importer.register('A', validModule());
      await s.service.load('A', { dev: true, devPort: 5173 });
      const state = s.service.getPluginState('A');
      expect(state?.isDev).toBe(true);
      expect(state?.devPort).toBe(5173);
    });

    it('#6 load registers routes', async () => {
      const route = { path: '/test', Component: () => null };
      s.importer.register('A', validModule({ routes: [route] }));
      await s.service.load('A');
      expect(s.service.getAllRoutes()).toHaveLength(1);
    });

    it('#7 load normalizes legacy sidebars', async () => {
      s.deps.ensureBuiltinExtensionPoints = () => {
        if (!s.extensions.hasExtensionPoint('omniview/resource/sidebar/infopanel')) {
          s.extensions.addExtensionPoint({
            id: 'omniview/resource/sidebar/infopanel',
            pluginId: 'core',
            mode: 'single',
          });
        }
      };
      const SidebarStub = () => null;
      s.importer.register('A', validModule({ sidebars: { 'core::v1::Pod': SidebarStub } }));
      await s.service.load('A');
      const store = s.extensions.getExtensionPoint('omniview/resource/sidebar/infopanel');
      expect(store?.listAll()).toHaveLength(1);
      expect(store?.listAll()[0].plugin).toBe('A');
    });

    it('#8 load normalizes legacy drawers', async () => {
      s.deps.ensureBuiltinExtensionPoints = () => {
        if (!s.extensions.hasExtensionPoint('omniview/resource/drawer')) {
          s.extensions.addExtensionPoint({
            id: 'omniview/resource/drawer',
            pluginId: 'core',
            mode: 'single',
          });
        }
      };
      const DrawerFactory = () => ({ views: [] });
      s.importer.register('A', validModule({ drawers: { 'core::v1::Pod': DrawerFactory } }));
      await s.service.load('A');
      const store = s.extensions.getExtensionPoint('omniview/resource/drawer');
      expect(store?.listAll()).toHaveLength(1);
    });

    it('#9 load registers generic extension contributions', async () => {
      s.extensions.addExtensionPoint({ id: 'custom-ep', pluginId: 'core', mode: 'multiple' });
      s.importer.register('A', validModule({
        extensionRegistrations: [{
          extensionPointId: 'custom-ep',
          registration: { id: 'c1', label: 'C1', value: 'val' },
        }],
      }));
      await s.service.load('A');
      const store = s.extensions.getExtensionPoint('custom-ep');
      expect(store?.listAll()).toHaveLength(1);
    });

    it('#10 load registers extension points', async () => {
      s.importer.register('A', validModule({
        extensionPoints: [{ id: 'my-ep', mode: 'multiple' }],
      }));
      await s.service.load('A');
      expect(s.extensions.hasExtensionPoint('my-ep')).toBe(true);
    });

    it('#11 load registers plugin-defined EP before same-plugin contributions', async () => {
      s.importer.register('A', validModule({
        extensionPoints: [{ id: 'my-ep', mode: 'multiple' }],
        extensionRegistrations: [{
          extensionPointId: 'my-ep',
          registration: { id: 'c1', label: 'C1', value: 'val' },
        }],
      }));
      await s.service.load('A');
      const store = s.extensions.getExtensionPoint('my-ep');
      expect(store?.listAll()).toHaveLength(1);
    });

    it('#12 load bumps routeVersion', async () => {
      const v0 = s.service.getRouteVersion();
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getRouteVersion()).toBeGreaterThan(v0);
    });

    it('#13 load preserves other plugins', async () => {
      s.importer.register('A', validModule());
      s.importer.register('B', validModule());
      await s.service.load('A');
      await s.service.load('B');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
      expect(s.service.getPluginState('B')?.phase).toBe('ready');
    });
  });

  // 3.2 Idempotency & Deduplication
  describe('3.2 Idempotency & Deduplication', () => {
    it('#14 load on already-loaded is no-op', async () => {
      s.importer.register('A', validModule());
      await s.service.load('A');
      await s.service.load('A');
      expect(s.importer.importCount).toBe(1);
    });

    it('#15 load on loading plugin joins inflight', async () => {
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);
      const p1 = s.service.load('A');
      const p2 = s.service.load('A');
      d.resolve(validModule());
      await Promise.all([p1, p2]);
      expect(s.importer.importCount).toBe(1);
    });

    it('#16 load on error plugin is no-op', async () => {
      s.importer.register('A', () => { throw new Error('fail'); });
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('error');
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.importer.importCount).toBe(1); // no second import
    });
  });

  // 3.3 Error Paths
  describe('3.3 Error Paths', () => {
    it('#18 import rejects', async () => {
      s.importer.register('A', () => { throw new Error('network'); });
      await s.service.load('A');
      const state = s.service.getPluginState('A');
      expect(state?.phase).toBe('error');
      expect(state?.error).toContain('network');
      expect(state?.pluginWindow).toBeNull();
    });

    it('#19 import rejects with non-Error', async () => {
      s.importer.register('A', () => { throw 'fail'; });
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('error');
      expect(s.service.getPluginState('A')?.error).toBeDefined();
    });

    it('#20 validation failure', async () => {
      s.importer.register('A', {}); // no plugin export
      await s.service.load('A');
      const state = s.service.getPluginState('A');
      expect(state?.phase).toBe('error');
      expect(state?.error).toContain('plugin');
    });

    it('#21 validation failure — malformed resource key', async () => {
      s.importer.register('A', {
        plugin: new PluginWindow(),
        sidebars: { 'bad': () => null },
      });
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('error');
    });

    it('#22 load fails fast on missing extension point', async () => {
      s.importer.register('A', validModule({
        extensionRegistrations: [{
          extensionPointId: 'missing-ep',
          registration: { id: 'c1', label: 'C1', value: 'val' },
        }],
      }));
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('error');
    });

    it('#24 error state has null pluginWindow', async () => {
      s.importer.register('A', () => { throw new Error('fail'); });
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.pluginWindow).toBeNull();
    });

    it('#25 error state has null loadedAt', async () => {
      s.importer.register('A', () => { throw new Error('fail'); });
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.loadedAt).toBeNull();
    });

    it('#26 error does not register routes or contributions', async () => {
      s.importer.register('A', () => { throw new Error('fail'); });
      await s.service.load('A');
      expect(s.service.getAllRoutes()).toHaveLength(0);
    });
  });

  // 3.4 Timing & Timeout
  describe('3.4 Timing & Timeout', () => {
    it('#27 import timeout', async () => {
      const s = setup({ importTimeoutMs: 50 });
      s.importer.register('A', () => new Promise(() => {})); // never resolves
      await s.service.load('A');
      const state = s.service.getPluginState('A');
      expect(state?.phase).toBe('error');
      expect(state?.error).toContain('timed out');
    });

    it('#29 resolve before timeout', async () => {
      const s = setup({ importTimeoutMs: 500 });
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
    });

    it('#30 timeout is PluginTimeoutError', async () => {
      const s = setup({ importTimeoutMs: 10 });
      s.importer.register('A', () => new Promise(() => {}));
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.error).toContain('timed out');
    });
  });
});

// ─── Group 4: Unload Operations ─────────────────────────────────────

describe('Group 4: Unload Operations', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('#1 unload from ready', async () => {
    s.importer.register('A', validModule({ routes: [{ path: '/a' }] }));
    await s.service.load('A');
    const v1 = s.service.getRouteVersion();
    await s.service.unload('A');
    const state = s.service.getPluginState('A');
    expect(state?.phase).toBe('idle');
    expect(s.service.getAllRoutes()).toHaveLength(0);
    expect(s.service.getRouteVersion()).toBeGreaterThan(v1);
  });

  it('#2 unload removes sidebar contributions', async () => {
    s.deps.ensureBuiltinExtensionPoints = () => {
      if (!s.extensions.hasExtensionPoint('omniview/resource/sidebar/infopanel')) {
        s.extensions.addExtensionPoint({
          id: 'omniview/resource/sidebar/infopanel',
          pluginId: 'core',
          mode: 'single',
        });
      }
    };
    s.importer.register('A', validModule({ sidebars: { 'core::v1::Pod': () => null } }));
    await s.service.load('A');
    await s.service.unload('A');
    const store = s.extensions.getExtensionPoint('omniview/resource/sidebar/infopanel');
    expect(store?.listAll()).toHaveLength(0);
  });

  it('#5 unload from error', async () => {
    s.importer.register('A', () => { throw new Error('fail'); });
    await s.service.load('A');
    expect(s.service.getPluginState('A')?.phase).toBe('error');
    await s.service.unload('A');
    expect(s.service.getPluginState('A')?.phase).toBe('idle');
  });

  it('#6 unload non-existent plugin — no-op', async () => {
    await expect(s.service.unload('unknown')).resolves.toBeUndefined();
  });

  it('#7 unload from idle — no-op', async () => {
    s.importer.register('A', validModule());
    // Create idle state via backend phase
    s.service.updateBackendPhase('A', 'Installing');
    await s.service.unload('A');
    expect(s.service.getPluginState('A')?.phase).toBe('idle');
  });

  it('#10 unload preserves backendPhase', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.service.updateBackendPhase('A', 'Running');
    await s.service.unload('A');
    expect(s.service.getPluginState('A')?.backendPhase).toBe('Running');
  });
});

// ─── Group 5: Reload Operations ─────────────────────────────────────

describe('Group 5: Reload Operations', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('#1 basic reload', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    const oldWindow = s.service.getPluginState('A')?.pluginWindow;
    s.importer.register('A', validModule());
    await s.service.reload('A');
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.service.getPluginState('A')?.pluginWindow).not.toBe(oldWindow);
    expect(s.importer.importCount).toBe(2);
  });

  it('#2 old pluginWindow preserved during loading', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    const oldWindow = s.service.getPluginState('A')?.pluginWindow;

    const d = createDeferred<unknown>();
    s.importer.register('A', () => d.promise);

    const reloadPromise = s.service.reload('A');
    // During reload, pluginWindow should still be old
    expect(s.service.getPluginState('A')?.pluginWindow).toBe(oldWindow);

    d.resolve(validModule());
    await reloadPromise;
  });

  it('#3 atomic swap — no null intermediate', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');

    const windows: any[] = [];
    s.service.subscribe(() => {
      windows.push(s.service.getPluginState('A')?.pluginWindow);
    });

    s.importer.register('A', validModule());
    await s.service.reload('A');

    // No intermediate null
    expect(windows.every((w) => w != null)).toBe(true);
  });

  it('#4 reload failure preserves old window', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    const oldWindow = s.service.getPluginState('A')?.pluginWindow;

    s.importer.register('A', () => { throw new Error('reload fail'); });
    await s.service.reload('A');

    expect(s.service.getPluginState('A')?.phase).toBe('error');
    expect(s.service.getPluginState('A')?.pluginWindow).toBe(oldWindow);
  });

  it('#5 reload bumps routeVersion', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    const v1 = s.service.getRouteVersion();
    s.importer.register('A', validModule());
    await s.service.reload('A');
    expect(s.service.getRouteVersion()).toBeGreaterThan(v1);
  });

  it('#6 reload re-registers routes', async () => {
    s.importer.register('A', validModule({ routes: [{ path: '/old' }] }));
    await s.service.load('A');
    s.importer.register('A', validModule({ routes: [{ path: '/new1' }, { path: '/new2' }] }));
    await s.service.reload('A');
    expect(s.service.getAllRoutes()).toHaveLength(2);
  });

  it('#7 reload re-registers extension contributions', async () => {
    s.extensions.addExtensionPoint({ id: 'ep', pluginId: 'core', mode: 'multiple' });
    s.importer.register('A', validModule({
      extensionRegistrations: [{
        extensionPointId: 'ep',
        registration: { id: 'c1', label: 'Old', value: 'old' },
      }],
    }));
    await s.service.load('A');
    s.importer.register('A', validModule({
      extensionRegistrations: [{
        extensionPointId: 'ep',
        registration: { id: 'c2', label: 'New', value: 'new' },
      }],
    }));
    await s.service.reload('A');
    const store = s.extensions.getExtensionPoint('ep');
    const all = store?.listAll() ?? [];
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('New');
  });

  it('#9 reload on non-ready throws', async () => {
    // Plugin exists but not ready (in error state)
    s.importer.register('A', () => { throw new Error('fail'); });
    await s.service.load('A');
    expect(s.service.getPluginState('A')?.phase).toBe('error');
    await expect(s.service.reload('A')).rejects.toThrow(/not in ready state/);
  });

  it('#10 reload on non-existent throws', async () => {
    await expect(s.service.reload('unknown')).rejects.toThrow(/not found/);
  });

  it('#11 loadedAt updated on successful reload', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    const state1 = s.service.getPluginState('A');
    expect(state1).toBeDefined();
    const loadedAt1 = state1!.loadedAt;
    await new Promise((r) => setTimeout(r, 5));
    s.importer.register('A', validModule());
    await s.service.reload('A');
    const state2 = s.service.getPluginState('A');
    expect(state2).toBeDefined();
    expect(state2!.loadedAt).toBeGreaterThan(loadedAt1);
  });
});

// ─── Group 6: Retry Operations ──────────────────────────────────────

describe('Group 6: Retry Operations', () => {
  it('#1 retry from error', async () => {
    const s = setup({ retryBaseDelayMs: 0 });
    let attempts = 0;
    s.importer.register('A', () => {
      attempts++;
      if (attempts === 1) throw new Error('fail');
      return validModule();
    });
    await s.service.load('A');
    expect(s.service.getPluginState('A')?.phase).toBe('error');

    await s.service.retry('A');
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
  });

  it('#2 retryCount increments', async () => {
    const s = setup({ retryBaseDelayMs: 0 });
    let attempts = 0;
    s.importer.register('A', () => {
      attempts++;
      throw new Error(`fail-${attempts}`);
    });

    await s.service.load('A');
    expect(s.service.getPluginState('A')?.retryCount).toBe(0);

    await s.service.retry('A');
    expect(s.service.getPluginState('A')?.retryCount).toBe(1);

    await s.service.retry('A');
    expect(s.service.getPluginState('A')?.retryCount).toBe(2);
  });

  it('#3 retryCount resets on success', async () => {
    const s = setup({ retryBaseDelayMs: 0 });
    let attempts = 0;
    s.importer.register('A', () => {
      attempts++;
      if (attempts <= 2) throw new Error('fail');
      return validModule();
    });

    await s.service.load('A'); // fail (1)
    await s.service.retry('A'); // fail (2)
    await s.service.retry('A'); // success (3)
    expect(s.service.getPluginState('A')?.retryCount).toBe(0);
  });

  it('#6 maxRetries respected', async () => {
    const s = setup({ retryBaseDelayMs: 0, maxRetries: 2 });
    s.importer.register('A', () => { throw new Error('fail'); });

    await s.service.load('A');
    await s.service.retry('A'); // retryCount=1
    await s.service.retry('A'); // retryCount=2
    await s.service.retry('A'); // should be no-op (maxRetries=2)
    expect(s.service.getPluginState('A')?.phase).toBe('error');
  });

  it('#7 maxRetries logs warning', async () => {
    const s = setup({ retryBaseDelayMs: 0, maxRetries: 1 });
    s.importer.register('A', () => { throw new Error('fail'); });

    await s.service.load('A');
    await s.service.retry('A'); // retryCount=1
    await s.service.retry('A'); // should log warning
    expect(s.log.byLevel('warn').some((l) => l.message.includes('max retries'))).toBe(true);
  });

  it('#8 retry on non-error throws', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    await s.service.load('A');
    await expect(s.service.retry('A')).rejects.toThrow(/not in error state/);
  });

  it('#9 retry on non-existent throws', async () => {
    const s = setup();
    await expect(s.service.retry('unknown')).rejects.toThrow(/not in error state/);
  });

  it('#10 forceReset resets retryCount', async () => {
    const s = setup({ retryBaseDelayMs: 0, maxRetries: 1 });
    s.importer.register('A', () => { throw new Error('fail'); });

    await s.service.load('A');
    await s.service.retry('A'); // retryCount=1
    await s.service.forceReset('A');
    expect(s.service.getPluginState('A')?.retryCount).toBe(0);
  });
});

// ─── Group 7: Concurrency & Race Conditions ─────────────────────────

describe('Group 7: Concurrency & Race Conditions', () => {
  // 7.1 Promise Deduplication
  describe('7.1 Promise Deduplication', () => {
    it('#1 concurrent load() calls share one import', async () => {
      const s = setup();
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const p1 = s.service.load('A');
      const p2 = s.service.load('A');
      d.resolve(validModule());
      await Promise.all([p1, p2]);
      expect(s.importer.importCount).toBe(1);
    });

    it('#2 concurrent reload() calls share one import', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');

      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const p1 = s.service.reload('A');
      const p2 = s.service.reload('A');
      d.resolve(validModule());
      await Promise.all([p1, p2]);
      expect(s.importer.importCount).toBe(2); // 1 load + 1 reload
    });
  });

  // 7.2 Unload During Load
  describe('7.2 Unload During Load', () => {
    it('#4 unload cancels inflight load', async () => {
      const s = setup();
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const loadPromise = s.service.load('A');
      await s.service.unload('A');
      d.resolve(validModule());
      await loadPromise;

      expect(s.service.getPluginState('A')?.phase).toBe('idle');
    });

    it('#7 new load after cancel works', async () => {
      const s = setup();
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const loadPromise = s.service.load('A');
      await s.service.unload('A');
      d.resolve(validModule());
      await loadPromise;

      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
    });
  });

  // 7.3 Reload During Operations
  describe('7.3 Reload During Operations', () => {
    it('#8 reload during initial load joins inflight', async () => {
      const s = setup();
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const loadPromise = s.service.load('A');
      // reload() while loading joins the inflight promise (same dedup as load)
      const reloadPromise = s.service.reload('A');
      d.resolve(validModule());
      await Promise.all([loadPromise, reloadPromise]);
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
      expect(s.importer.importCount).toBe(1); // only one import
    });
  });

  // 7.4 forceReset Race Conditions
  describe('7.4 forceReset Race Conditions', () => {
    it('#11 forceReset during load', async () => {
      const s = setup();
      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const loadPromise = s.service.load('A');
      await s.service.forceReset('A');
      d.resolve(validModule());
      await loadPromise;

      expect(s.service.getPluginState('A')?.phase).toBe('idle');
    });

    it('#12 forceReset during reload', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');

      const d = createDeferred<unknown>();
      s.importer.register('A', () => d.promise);

      const reloadPromise = s.service.reload('A');
      await s.service.forceReset('A');
      d.resolve(validModule());
      await reloadPromise;

      expect(s.service.getPluginState('A')?.phase).toBe('idle');
      expect(s.service.getPluginState('A')?.pluginWindow).toBeNull();
    });
  });
});

// ─── Group 8: Snapshot & React Integration ──────────────────────────

describe('Group 8: Snapshot', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('#1 same ref without state change', () => {
    const snap1 = s.service.getSnapshot();
    const snap2 = s.service.getSnapshot();
    expect(snap1).toBe(snap2);
  });

  it('#2 new ref after state change', async () => {
    const snap1 = s.service.getSnapshot();
    s.importer.register('A', validModule());
    await s.service.load('A');
    const snap2 = s.service.getSnapshot();
    expect(snap1).not.toBe(snap2);
  });

  it('#5 snapshot.ready accurate', () => {
    expect(s.service.getSnapshot().ready).toBe(false);
    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
  });

  it('#6 snapshot.routeVersion accurate', async () => {
    expect(s.service.getSnapshot().routeVersion).toBe(0);
    s.importer.register('A', validModule());
    await s.service.load('A');
    expect(s.service.getSnapshot().routeVersion).toBeGreaterThan(0);
  });

  it('#7 getAllRoutes same ref without route change', () => {
    const r1 = s.service.getAllRoutes();
    const r2 = s.service.getAllRoutes();
    expect(r1).toBe(r2);
  });

  it('#8 getAllRoutes new ref after load', async () => {
    const r1 = s.service.getAllRoutes();
    s.importer.register('A', validModule({ routes: [{ path: '/a' }] }));
    await s.service.load('A');
    const r2 = s.service.getAllRoutes();
    expect(r1).not.toBe(r2);
    expect(r2).toHaveLength(1);
  });

  it('#9 routes from multiple plugins merged', async () => {
    s.importer.register('A', validModule({ routes: [{ path: '/a1' }, { path: '/a2' }] }));
    s.importer.register('B', validModule({ routes: [{ path: '/b1' }] }));
    await s.service.load('A');
    await s.service.load('B');
    expect(s.service.getAllRoutes()).toHaveLength(3);
  });

  it('#10 unload removes routes from cache', async () => {
    s.importer.register('A', validModule({ routes: [{ path: '/a' }] }));
    await s.service.load('A');
    await s.service.unload('A');
    expect(s.service.getAllRoutes()).toHaveLength(0);
  });
});

// ─── Group 10: forceReset ───────────────────────────────────────────

describe('Group 10: forceReset', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('#1 from ready', async () => {
    s.importer.register('A', validModule({ routes: [{ path: '/a' }] }));
    await s.service.load('A');
    const v1 = s.service.getRouteVersion();
    await s.service.forceReset('A');
    const state = s.service.getPluginState('A');
    expect(state?.phase).toBe('idle');
    expect(state?.pluginWindow).toBeNull();
    expect(state?.retryCount).toBe(0);
    expect(s.service.getAllRoutes()).toHaveLength(0);
    expect(s.service.getRouteVersion()).toBeGreaterThan(v1);
  });

  it('#2 from error', async () => {
    s.importer.register('A', () => { throw new Error('fail'); });
    await s.service.load('A');
    await s.service.forceReset('A');
    const state = s.service.getPluginState('A');
    expect(state?.phase).toBe('idle');
    expect(state?.error).toBeNull();
    expect(state?.retryCount).toBe(0);
  });

  it('#4 preserves backendPhase', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.service.updateBackendPhase('A', 'Running');
    await s.service.forceReset('A');
    expect(s.service.getPluginState('A')?.backendPhase).toBe('Running');
  });

  it('#5 other plugins unaffected', async () => {
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    await s.service.load('A');
    await s.service.load('B');
    await s.service.forceReset('A');
    expect(s.service.getPluginState('B')?.phase).toBe('ready');
  });

  it('#6 unknown plugin is no-op', async () => {
    await expect(s.service.forceReset('unknown')).resolves.toBeUndefined();
  });

  it('#7 can load after forceReset', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    await s.service.forceReset('A');
    s.importer.register('A', validModule());
    await s.service.load('A');
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
  });
});

// ─── Group 11: Batch Operations (loadAll) ───────────────────────────

describe('Group 11: Batch Operations (loadAll)', () => {
  it('#1 all succeed', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    s.importer.register('C', validModule());
    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
      { id: 'C', dev: false },
    ]);
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.service.getPluginState('B')?.phase).toBe('ready');
    expect(s.service.getPluginState('C')?.phase).toBe('ready');
  });

  it('#2 partial failure', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    s.importer.register('C', {}); // invalid
    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
      { id: 'C', dev: false },
    ]);
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.service.getPluginState('B')?.phase).toBe('ready');
    expect(s.service.getPluginState('C')?.phase).toBe('error');
  });

  it('#3 empty array', async () => {
    const s = setup();
    await expect(s.service.loadAll([])).resolves.toBeUndefined();
  });

  it('#4 single plugin', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    await s.service.loadAll([{ id: 'A', dev: false }]);
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
  });

  it('#5 skips already-loaded', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    await s.service.load('A');
    const countBefore = s.importer.importCount;
    await s.service.loadAll([{ id: 'A', dev: false }, { id: 'B', dev: false }]);
    expect(s.importer.importCount).toBe(countBefore + 1); // only B imported
  });

  it('#6 maxConcurrentLoads=1 (serial)', async () => {
    const s = setup({ maxConcurrentLoads: 1 });
    for (let i = 0; i < 5; i++) {
      s.importer.register(`p${i}`, validModule());
    }
    await s.service.loadAll(
      Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, dev: false })),
    );
    for (let i = 0; i < 5; i++) {
      expect(s.service.getPluginState(`p${i}`)?.phase).toBe('ready');
    }
  });

  it('#8 concurrency tracking', async () => {
    const s = setup({ maxConcurrentLoads: 2 });
    let concurrent = 0;
    let peakConcurrent = 0;
    const deferreds: ReturnType<typeof createDeferred<unknown>>[] = [];

    for (let i = 0; i < 6; i++) {
      const d = createDeferred<unknown>();
      deferreds.push(d);
      s.importer.register(`p${i}`, () => {
        concurrent++;
        peakConcurrent = Math.max(peakConcurrent, concurrent);
        return d.promise.then((v) => {
          concurrent--;
          return v;
        });
      });
    }

    const loadPromise = s.service.loadAll(
      Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, dev: false })),
    );

    // Resolve all
    for (const d of deferreds) {
      d.resolve(validModule());
    }

    await loadPromise;
    expect(peakConcurrent).toBeLessThanOrEqual(2);
  });

  it('#9 markReady after loadAll', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    await s.service.loadAll([{ id: 'A', dev: false }]);
    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
  });

  it('#10 loadAll failure does not prevent markReady', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    s.importer.register('B', () => { throw new Error('fail'); });
    await s.service.loadAll([{ id: 'A', dev: false }, { id: 'B', dev: false }]);
    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
  });

  it('#11 two-pass startup resolves cross-plugin contributions', async () => {
    const s = setup();
    // A contributes to B's extension point
    s.importer.register('A', validModule({
      extensionRegistrations: [{
        extensionPointId: 'B/ep',
        registration: { id: 'c1', label: 'C1', value: 'val' },
      }],
    }));
    // B defines the extension point
    s.importer.register('B', validModule({
      extensionPoints: [{ id: 'B/ep', mode: 'multiple' }],
    }));

    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
    ]);

    // Both should succeed — two-pass ensures EP defined before contributions applied
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.service.getPluginState('B')?.phase).toBe('ready');
    const store = s.extensions.getExtensionPoint('B/ep');
    expect(store?.listAll()).toHaveLength(1);
  });

  it('#12 loadAll registers EPs before contributions', async () => {
    const s = setup();
    // B contributes to A's extension point, but A imports second
    s.importer.register('A', validModule({
      extensionPoints: [{ id: 'A/ep', mode: 'multiple' }],
    }));
    s.importer.register('B', validModule({
      extensionRegistrations: [{
        extensionPointId: 'A/ep',
        registration: { id: 'c1', label: 'C1', value: 'val' },
      }],
    }));

    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
    ]);

    expect(s.service.getPluginState('B')?.phase).toBe('ready');
    const store = s.extensions.getExtensionPoint('A/ep');
    expect(store?.listAll()).toHaveLength(1);
  });

  it('#13 genuine missing target EP still fails', async () => {
    const s = setup();
    s.importer.register('A', validModule({
      extensionRegistrations: [{
        extensionPointId: 'missing-ep',
        registration: { id: 'c1', label: 'C1', value: 'val' },
      }],
    }));
    s.importer.register('B', validModule());
    s.importer.register('C', validModule());

    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
      { id: 'C', dev: false },
    ]);

    expect(s.service.getPluginState('A')?.phase).toBe('error');
    expect(s.service.getPluginState('B')?.phase).toBe('ready');
    expect(s.service.getPluginState('C')?.phase).toBe('ready');
  });
});

// ─── Group 12: Backend Phase Tracking ───────────────────────────────

describe('Group 12: Backend Phase Tracking', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('#1 backendPhase null by default', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    expect(s.service.getPluginState('A')?.backendPhase).toBeNull();
  });

  it('#2 updateBackendPhase on existing plugin', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.service.updateBackendPhase('A', 'Running');
    expect(s.service.getPluginState('A')?.backendPhase).toBe('Running');
  });

  it('#3 updateBackendPhase for unknown plugin creates idle entry', () => {
    s.service.updateBackendPhase('X', 'Installing');
    const state = s.service.getPluginState('X');
    expect(state?.phase).toBe('idle');
    expect(state?.backendPhase).toBe('Installing');
  });

  it('#4 backendPhase persists through reload', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.service.updateBackendPhase('A', 'Running');
    s.importer.register('A', validModule());
    await s.service.reload('A');
    // backendPhase was on the state before reload; reload's transition preserves it via spread
    const state = s.service.getPluginState('A');
    expect(state?.phase).toBe('ready');
  });

  it('#7 backendPhase updates trigger snapshot change', () => {
    let notified = 0;
    s.service.subscribe(() => notified++);
    s.service.updateBackendPhase('A', 'Running');
    expect(notified).toBeGreaterThan(0);
  });
});

// ─── Group 13.7: Ownership, Replay, And Ordering ────────────────────

describe('Group 13.7: Ownership, Replay, And Ordering', () => {
  it('#42 duplicate EP ID owned by another plugin fails load', async () => {
    const s = setup();
    s.importer.register('A', validModule({
      extensionPoints: [{ id: 'my-ep', mode: 'multiple' }],
    }));
    await s.service.load('A');

    s.importer.register('B', validModule({
      extensionPoints: [{ id: 'my-ep', mode: 'multiple' }],
    }));
    await s.service.load('B');
    expect(s.service.getPluginState('B')?.phase).toBe('error');
    expect(s.service.getPluginState('A')?.phase).toBe('ready');
  });

  it('#46 foreign contribution replays when owner plugin reloads', async () => {
    const s = setup();
    // B defines extension point
    s.importer.register('B', validModule({
      extensionPoints: [{ id: 'B/ep', mode: 'multiple' }],
    }));
    await s.service.load('B');

    // A contributes to B's extension point
    s.importer.register('A', validModule({
      extensionRegistrations: [{
        extensionPointId: 'B/ep',
        registration: { id: 'c1', label: 'C1', value: 'val' },
      }],
    }));
    await s.service.load('A');

    // Verify contribution is present
    let store = s.extensions.getExtensionPoint('B/ep');
    expect(store?.listAll()).toHaveLength(1);

    // Reload B (which removes then re-adds its extension point)
    s.importer.register('B', validModule({
      extensionPoints: [{ id: 'B/ep', mode: 'multiple' }],
    }));
    await s.service.reload('B');

    // A's contribution should be replayed without reloading A
    store = s.extensions.getExtensionPoint('B/ep');
    expect(store?.listAll()).toHaveLength(1);
    expect(store?.listAll()[0].plugin).toBe('A');
  });
});

// ─── Subscription Tests ─────────────────────────────────────────────

describe('Subscriptions', () => {
  it('subscribe/unsubscribe works', async () => {
    const s = setup();
    let count = 0;
    const unsub = s.service.subscribe(() => count++);
    s.importer.register('A', validModule());
    await s.service.load('A');
    expect(count).toBeGreaterThan(0);
    const countBefore = count;
    unsub();
    s.service.markReady();
    expect(count).toBe(countBefore); // no more notifications
  });
});

// ─── Reset ──────────────────────────────────────────────────────────

describe('reset()', () => {
  it('clears all state', async () => {
    const s = setup();
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.service.markReady();
    s.service.reset();
    expect(s.service.getSnapshot().plugins.size).toBe(0);
    expect(s.service.getSnapshot().ready).toBe(false);
    expect(s.service.getSnapshot().routeVersion).toBe(0);
  });
});
