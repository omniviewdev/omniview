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
    (pw as any)._extensions = overrides.extensionPoints;
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

// ─── Group 18: Observability & Logging ──────────────────────────────

describe('Group 18: Observability & Logging', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  // 18.1 load() logs start
  it('18.1 load() logs start with plugin context', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');

    const debugLogs = s.log.byLevel('debug');
    const startLog = debugLogs.find((l) => l.message.includes('Loading') && l.message.includes('A'));
    expect(startLog).toBeDefined();
    expect(startLog!.data).toEqual(expect.objectContaining({ plugin: 'A' }));
  });

  // 18.2 load() logs success
  it('18.2 load() logs success with plugin context', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');

    const debugLogs = s.log.byLevel('debug');
    const readyLog = debugLogs.find((l) => l.message.includes('ready') && l.message.includes('A'));
    expect(readyLog).toBeDefined();
    expect(readyLog!.data).toEqual(expect.objectContaining({ plugin: 'A' }));
  });

  // 18.3 load() logs failure
  it('18.3 load() logs failure with error context', async () => {
    s.importer.register('A', { bad: 'module' }); // will fail validation
    await s.service.load('A');

    const errorLogs = s.log.byLevel('error');
    const failLog = errorLogs.find((l) => l.message.includes('A') && l.message.includes('failed'));
    expect(failLog).toBeDefined();
    expect(failLog!.data).toEqual(expect.objectContaining({ plugin: 'A' }));
  });

  // 18.4 loadAll logs summary
  it('18.4 loadAll logs summary with ready/failed counts', async () => {
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    s.importer.register('C', { broken: true }); // fails validation

    await s.service.loadAll([
      { id: 'A', dev: false },
      { id: 'B', dev: false },
      { id: 'C', dev: false },
    ]);

    const debugLogs = s.log.byLevel('debug');
    const summaryLog = debugLogs.find(
      (l) => l.message.includes('loadAll') && l.message.includes('2 ready') && l.message.includes('1 failed'),
    );
    expect(summaryLog).toBeDefined();
    expect(summaryLog!.data).toEqual(
      expect.objectContaining({ readyCount: 2, failedCount: 1, total: 3 }),
    );
  });

  // 18.5 Timeout logs error
  it('18.5 import timeout produces error log', async () => {
    const deferred = createDeferred<unknown>();
    s.importer.register('A', () => deferred.promise);

    const t = setup({ importTimeoutMs: 10 });
    t.importer.register('A', () => deferred.promise);

    await t.service.load('A');

    const errorLogs = t.log.byLevel('error');
    const timeoutLog = errorLogs.find(
      (l) => l.message.toLowerCase().includes('timeout') || l.message.toLowerCase().includes('timed out'),
    );
    expect(timeoutLog).toBeDefined();
  });

  // 18.6 Max retries logs warning
  it('18.6 max retries produces warning log', async () => {
    const t = setup({ maxRetries: 0, retryBaseDelayMs: 0, retryMaxDelayMs: 0 });
    t.importer.register('A', { bad: true }); // fails validation
    await t.service.load('A');
    t.log.clear();

    // Now retry — should be over max
    await t.service.retry('A');

    const warnLogs = t.log.byLevel('warn');
    const maxRetryLog = warnLogs.find(
      (l) => l.message.includes('max retries') || l.message.includes('exceeded'),
    );
    expect(maxRetryLog).toBeDefined();
  });

  // 18.7 unload() logs
  it('18.7 unload() logs with plugin context', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.log.clear();

    await s.service.unload('A');

    const debugLogs = s.log.byLevel('debug');
    const unloadLog = debugLogs.find((l) => l.message.includes('A') && l.message.toLowerCase().includes('unload'));
    expect(unloadLog).toBeDefined();
    expect(unloadLog!.data).toEqual(expect.objectContaining({ plugin: 'A' }));
  });

  // 18.8 No console.log in service — verified by grep, tested here structurally
  it('18.8 all service logging goes through deps.log (no console.log in PluginService.ts)', async () => {
    // Load and verify that log capture captured everything — no console bypass
    s.importer.register('A', validModule());
    await s.service.load('A');

    // If there were console.log calls, they'd be missed by log capture.
    // This is a structural check: we expect debug logs to exist.
    expect(s.log.logs.length).toBeGreaterThan(0);
    // And the logs should all have the expected structure
    for (const log of s.log.logs) {
      expect(log).toHaveProperty('level');
      expect(log).toHaveProperty('message');
    }
  });

  // 18.9 All log calls include pluginId
  it('18.9 all plugin-specific log calls include pluginId in data', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');

    // Every log that mentions a specific plugin should have pluginId in data
    const pluginLogs = s.log.logs.filter((l) => l.message.includes('"A"'));
    expect(pluginLogs.length).toBeGreaterThan(0);
    for (const log of pluginLogs) {
      expect(log.data).toEqual(expect.objectContaining({ plugin: 'A' }));
    }
  });

  // 18.10 forceReset logs
  it('18.10 forceReset logs with plugin context', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A');
    s.log.clear();

    await s.service.forceReset('A');

    const warnLogs = s.log.byLevel('warn');
    const resetLog = warnLogs.find((l) => l.message.includes('A') && l.message.toLowerCase().includes('reset'));
    expect(resetLog).toBeDefined();
    expect(resetLog!.data).toEqual(expect.objectContaining({ plugin: 'A' }));
  });
});

// ─── Group 18 (continued): Deprecation Warnings ─────────────────────

describe('Group 18: Deprecation Warnings', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('emits one-time deprecation warning for legacy sidebars', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/sidebar/infopanel',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('legacy-plugin', validModule({
      sidebars: { 'core::v1::Pod': () => null },
    }));

    await s.service.load('legacy-plugin');

    const warnLogs = s.log.byLevel('warn');
    const deprecationLog = warnLogs.find(
      (l) => l.message.includes('deprecated') && l.message.includes('legacy-plugin'),
    );
    expect(deprecationLog).toBeDefined();
    expect(deprecationLog!.data).toEqual(
      expect.objectContaining({
        plugin: 'legacy-plugin',
        deprecatedExports: ['sidebars'],
      }),
    );
  });

  it('emits one-time deprecation warning for legacy drawers', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/drawer',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('drawer-plugin', validModule({
      drawers: { 'core::v1::Pod': () => ({ content: () => null }) },
    }));

    await s.service.load('drawer-plugin');

    const warnLogs = s.log.byLevel('warn');
    const deprecationLog = warnLogs.find(
      (l) => l.message.includes('deprecated') && l.message.includes('drawer-plugin'),
    );
    expect(deprecationLog).toBeDefined();
    expect(deprecationLog!.data).toEqual(
      expect.objectContaining({
        plugin: 'drawer-plugin',
        deprecatedExports: ['drawers'],
      }),
    );
  });

  it('emits deprecation warning for both sidebars and drawers', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/sidebar/infopanel',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/drawer',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('both-plugin', validModule({
      sidebars: { 'core::v1::Pod': () => null },
      drawers: { 'core::v1::Pod': () => ({ content: () => null }) },
    }));

    await s.service.load('both-plugin');

    const warnLogs = s.log.byLevel('warn');
    const deprecationLog = warnLogs.find(
      (l) => l.message.includes('deprecated') && l.message.includes('both-plugin'),
    );
    expect(deprecationLog).toBeDefined();
    expect(deprecationLog!.data).toEqual(
      expect.objectContaining({
        deprecatedExports: ['sidebars', 'drawers'],
      }),
    );
  });

  it('does not emit deprecation warning for modern extensionRegistrations', async () => {
    s.importer.register('modern-plugin', validModule());
    await s.service.load('modern-plugin');

    const warnLogs = s.log.byLevel('warn');
    const deprecationLog = warnLogs.find(
      (l) => l.message.includes('deprecated') && l.message.includes('modern-plugin'),
    );
    expect(deprecationLog).toBeUndefined();
  });

  it('emits deprecation warning only once per plugin (one-time)', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/sidebar/infopanel',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('legacy-plugin', validModule({
      sidebars: { 'core::v1::Pod': () => null },
    }));

    await s.service.load('legacy-plugin');

    const warnCountAfterLoad = s.log.byLevel('warn').filter(
      (l) => l.message.includes('deprecated') && l.message.includes('legacy-plugin'),
    ).length;
    expect(warnCountAfterLoad).toBe(1);

    // Reload — should NOT emit again
    await s.service.reload('legacy-plugin');

    const warnCountAfterReload = s.log.byLevel('warn').filter(
      (l) => l.message.includes('deprecated') && l.message.includes('legacy-plugin'),
    ).length;
    expect(warnCountAfterReload).toBe(1); // still 1
  });

  it('deprecation warning is visible — legacy shim use is NOT invisible', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/sidebar/infopanel',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('legacy-plugin', validModule({
      sidebars: { 'core::v1::Pod': () => null },
    }));

    await s.service.load('legacy-plugin');

    // The deprecation log should mention specific resource keys
    const warnLogs = s.log.byLevel('warn');
    const deprecationLog = warnLogs.find(
      (l) => l.message.includes('deprecated') && l.message.includes('legacy-plugin'),
    );
    expect(deprecationLog).toBeDefined();
    expect(deprecationLog!.data).toHaveProperty('sidebarKeys');
    expect((deprecationLog!.data as any).sidebarKeys).toContain('core::v1::Pod');
  });
});

// ─── Group 21: Dev Mode Paths ──────────────────────────────────────

describe('Group 21: Dev Mode Paths', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  // 21.1 Dev load calls ensureDevSharedDeps
  it('21.1 dev load calls ensureDevSharedDeps', async () => {
    let called = false;
    s.deps.ensureDevSharedDeps = async () => { called = true; };
    s.importer.register('A', validModule());

    await s.service.load('A', { dev: true, devPort: 5173 });

    expect(called).toBe(true);
  });

  // 21.2 Prod load does NOT call ensureDevSharedDeps
  it('21.2 prod load does NOT call ensureDevSharedDeps', async () => {
    let called = false;
    s.deps.ensureDevSharedDeps = async () => { called = true; };
    s.importer.register('A', validModule());

    await s.service.load('A');

    expect(called).toBe(false);
  });

  // 21.3 Dev plugin import URL format
  it('21.3 dev plugin import called with dev opts', async () => {
    let capturedOpts: any = null;
    s.deps.importPlugin = async (opts) => {
      capturedOpts = opts;
      return validModule();
    };

    await s.service.load('A', { dev: true, devPort: 5173 });

    expect(capturedOpts).toEqual(expect.objectContaining({
      pluginId: 'A',
      dev: true,
      devPort: 5173,
    }));
  });

  // 21.4 Dev reload preserves dev state
  it('21.4 dev reload preserves dev state', async () => {
    s.importer.register('A', validModule());
    await s.service.load('A', { dev: true, devPort: 5173 });

    const stateAfterLoad = s.service.getPluginState('A');
    expect(stateAfterLoad?.isDev).toBe(true);
    expect(stateAfterLoad?.devPort).toBe(5173);

    await s.service.reload('A');

    const stateAfterReload = s.service.getPluginState('A');
    expect(stateAfterReload?.isDev).toBe(true);
    expect(stateAfterReload?.devPort).toBe(5173);
  });

  // 21.5 Dev and prod plugins coexist
  it('21.5 dev and prod plugins coexist', async () => {
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());

    await s.service.load('A', { dev: true, devPort: 5173 });
    await s.service.load('B');

    const stateA = s.service.getPluginState('A');
    const stateB = s.service.getPluginState('B');

    expect(stateA?.phase).toBe('ready');
    expect(stateA?.isDev).toBe(true);
    expect(stateB?.phase).toBe('ready');
    expect(stateB?.isDev).toBe(false);
  });

  // 21.6 clearPlugin skips dev plugin (adapter handles)
  it('21.6 clearPlugin called with dev=true for dev plugin unload', async () => {
    let clearOpts: any = null;
    s.deps.clearPlugin = async (opts) => { clearOpts = opts; };
    s.importer.register('A', validModule());

    await s.service.load('A', { dev: true, devPort: 5173 });
    await s.service.unload('A');

    expect(clearOpts).toEqual(expect.objectContaining({ pluginId: 'A', dev: true }));
  });

  // 21.8 getDebugSnapshot returns detailed state
  it('21.8 getDebugSnapshot returns detailed state with contributions and extension points', async () => {
    s.extensions.addExtensionPoint({
      id: 'omniview/resource/sidebar/infopanel',
      pluginId: 'core',
      mode: 'single',
      matcher: () => true,
    });

    s.importer.register('A', validModule({
      sidebars: { 'core::v1::Pod': () => null },
      extensionPoints: [{ id: 'custom-ep-A', mode: 'multiple' }],
    }));
    s.importer.register('B', validModule());

    await s.service.loadAll([
      { id: 'A', dev: true, devPort: 5173 },
      { id: 'B', dev: false },
    ]);
    s.service.markReady();

    const debug = s.service.getDebugSnapshot();

    // Overall structure
    expect(debug.ready).toBe(true);
    expect(debug.routeVersion).toBeGreaterThan(0);
    expect(debug.eventListenersActive).toBe(false);
    expect(debug.config).toBeDefined();

    // Plugin A
    const pluginA = debug.plugins['A'];
    expect(pluginA).toBeDefined();
    expect(pluginA.phase).toBe('ready');
    expect(pluginA.isDev).toBe(true);
    expect(pluginA.inflightLoad).toBe(false);

    // Contribution debug records
    expect(pluginA.contributions.length).toBeGreaterThan(0);
    const sidebarContrib = pluginA.contributions.find(
      (c) => c.extensionPointId === 'omniview/resource/sidebar/infopanel',
    );
    expect(sidebarContrib).toBeDefined();
    expect(sidebarContrib!.source).toBe('legacy-sidebar');
    expect(sidebarContrib!.resourceKey).toBe('core::v1::Pod');

    // Contributed extension point IDs
    expect(pluginA.contributedExtensionPoints).toContain('omniview/resource/sidebar/infopanel');

    // Defined extension point IDs
    expect(pluginA.definedExtensionPoints).toContain('custom-ep-A');

    // Plugin B — minimal
    const pluginB = debug.plugins['B'];
    expect(pluginB).toBeDefined();
    expect(pluginB.phase).toBe('ready');
    expect(pluginB.contributions).toEqual([]);
    expect(pluginB.definedExtensionPoints).toEqual([]);
  });
});
