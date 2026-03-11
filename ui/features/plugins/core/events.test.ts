import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginWindow } from '@omniviewdev/runtime';

import { PluginService } from './PluginService';
import { createTestDeps, createDeferred } from '../testing/helpers';
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

// ─── Test Setup ─────────────────────────────────────────────────────

function setup(config?: Partial<PluginServiceConfig>) {
  const testDeps = createTestDeps();
  const service = new PluginService(testDeps.deps, config);
  return { service, ...testDeps };
}

// ─── Group 9: Event System ──────────────────────────────────────────

describe('Group 9: Event System', () => {
  // ── 9.1 Event Listener Setup ──────────────────────────────────────

  describe('9.1 Event Listener Setup', () => {
    it('9.1.1 — startEventListeners registers all events', () => {
      const s = setup();
      s.service.startEventListeners();
      // 7 event types: install_finished, update_complete, dev_reload_complete,
      // state_change, crash, recovered, crash_recovery_failed
      expect(s.eventBus.listenerCount()).toBe(7);
    });

    it('9.1.2 — stopEventListeners unregisters all', () => {
      const s = setup();
      s.service.startEventListeners();
      expect(s.eventBus.listenerCount()).toBe(7);
      s.service.stopEventListeners();
      expect(s.eventBus.listenerCount()).toBe(0);
    });

    it('9.1.3 — double start is idempotent', () => {
      const s = setup();
      s.service.startEventListeners();
      s.service.startEventListeners();
      expect(s.eventBus.listenerCount()).toBe(7);
    });

    it('9.1.4 — stop without start is no-op', () => {
      const s = setup();
      expect(() => s.service.stopEventListeners()).not.toThrow();
      expect(s.eventBus.listenerCount()).toBe(0);
    });
  });

  // ── 9.2 plugin/install_finished ───────────────────────────────────

  describe('9.2 plugin/install_finished', () => {
    it('9.2.5 — triggers load for new plugin', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      s.service.startEventListeners();

      s.eventBus.emit('plugin/install_finished', { id: 'A' });

      await vi.waitFor(() => {
        expect(s.service.getPluginState('A')?.phase).toBe('ready');
      });
    });

    it('9.2.6 — triggers reload if already loaded', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
      const importCountBefore = s.importer.importCount;

      s.service.startEventListeners();

      // Re-register with a fresh module for reload
      s.importer.register('A', validModule());
      s.eventBus.emit('plugin/install_finished', { id: 'A' });

      await vi.waitFor(() => {
        expect(s.service.getPluginState('A')?.phase).toBe('ready');
        expect(s.importer.importCount).toBeGreaterThan(importCountBefore);
      });
    });

    it('9.2.7 — missing pluginId in payload', () => {
      const s = setup();
      s.service.startEventListeners();

      // Should not crash
      expect(() => s.eventBus.emit('plugin/install_finished', {})).not.toThrow();
    });

    it('9.2.8 — null payload', () => {
      const s = setup();
      s.service.startEventListeners();

      expect(() => s.eventBus.emit('plugin/install_finished', null)).not.toThrow();
    });
  });

  // ── 9.3 plugin/update_complete ────────────────────────────────────

  describe('9.3 plugin/update_complete', () => {
    it('9.3.9 — triggers reload for loaded plugin', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');
      const importCountBefore = s.importer.importCount;

      s.service.startEventListeners();
      s.importer.register('A', validModule());
      s.eventBus.emit('plugin/update_complete', { id: 'A' });

      await vi.waitFor(() => {
        expect(s.service.getPluginState('A')?.phase).toBe('ready');
        expect(s.importer.importCount).toBeGreaterThan(importCountBefore);
      });
    });

    it('9.3.10 — for unloaded plugin falls back to load', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      s.service.startEventListeners();

      s.eventBus.emit('plugin/update_complete', { id: 'A' });

      await vi.waitFor(() => {
        expect(s.service.getPluginState('A')?.phase).toBe('ready');
      });
    });
  });

  // ── 9.4 plugin/dev_reload_complete ────────────────────────────────

  describe('9.4 plugin/dev_reload_complete', () => {
    it('9.4.11 — triggers reload for dev plugin', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A', { dev: true });
      const importCountBefore = s.importer.importCount;

      s.service.startEventListeners();
      s.importer.register('A', validModule());
      s.eventBus.emit('plugin/dev_reload_complete', { id: 'A' });

      await vi.waitFor(() => {
        expect(s.service.getPluginState('A')?.phase).toBe('ready');
        expect(s.importer.importCount).toBeGreaterThan(importCountBefore);
      });
    });

    it('9.4.12 — for non-dev plugin is ignored and logged', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A'); // prod mode
      const loadedAt1 = s.service.getPluginState('A')?.loadedAt;

      s.service.startEventListeners();
      s.eventBus.emit('plugin/dev_reload_complete', { id: 'A' });

      // Allow microtask queue to drain (event handler is synchronous for non-dev case)
      await Promise.resolve();

      // Should NOT reload — loadedAt unchanged
      expect(s.service.getPluginState('A')?.loadedAt).toBe(loadedAt1);
      // Warning should be logged
      expect(s.log.byLevel('warn').some((l) =>
        l.message.includes('Ignoring dev reload'),
      )).toBe(true);
    });
  });

  // ── 9.5 plugin/state_change ───────────────────────────────────────

  describe('9.5 plugin/state_change', () => {
    it('9.5.13 — updates backendPhase', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');

      s.service.startEventListeners();
      s.eventBus.emit('plugin/state_change', { pluginID: 'A', phase: 'Building' });

      expect(s.service.getPluginState('A')?.backendPhase).toBe('Building');
    });

    it('9.5.14 — creates idle entry for unknown plugin', () => {
      const s = setup();
      s.service.startEventListeners();

      s.eventBus.emit('plugin/state_change', { pluginID: 'X', phase: 'Installing' });

      const state = s.service.getPluginState('X');
      expect(state?.phase).toBe('idle');
      expect(state?.backendPhase).toBe('Installing');
    });

    it('9.5.15 — does not affect frontend phase', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');

      s.service.startEventListeners();
      s.eventBus.emit('plugin/state_change', { pluginID: 'A', phase: 'Degraded' });

      expect(s.service.getPluginState('A')?.phase).toBe('ready');
      expect(s.service.getPluginState('A')?.backendPhase).toBe('Degraded');
    });

    it('9.5.16 — successive state changes', () => {
      const s = setup();
      s.service.startEventListeners();

      s.eventBus.emit('plugin/state_change', { pluginID: 'A', phase: 'Building' });
      expect(s.service.getPluginState('A')?.backendPhase).toBe('Building');

      s.eventBus.emit('plugin/state_change', { pluginID: 'A', phase: 'Running' });
      expect(s.service.getPluginState('A')?.backendPhase).toBe('Running');
    });

    it('9.5.17 — invalid phase string is logged as warning', () => {
      const s = setup();
      s.service.startEventListeners();

      s.eventBus.emit('plugin/state_change', { pluginID: 'A', phase: 'BadPhase' });

      expect(s.log.byLevel('warn').some((l) =>
        l.message.includes('invalid backend phase'),
      )).toBe(true);
      // backendPhase should remain unchanged (null for new plugin)
      // Since the invalid phase is rejected, no state entry should be created
      expect(s.service.getPluginState('A')).toBeUndefined();
    });
  });

  // ── 9.6 plugin/crash_recovery_failed ──────────────────────────────

  describe('9.6 plugin/crash_recovery_failed', () => {
    it('9.6.18 — sets error state for loaded plugin', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('ready');

      s.service.startEventListeners();
      s.eventBus.emit('plugin/crash_recovery_failed', { pluginID: 'A', error: 'Process died' });

      expect(s.service.getPluginState('A')?.phase).toBe('error');
      expect(s.service.getPluginState('A')?.error).toBe('Process died');
    });

    it('9.6.19 — for already-errored plugin does not crash', async () => {
      const s = setup();
      // Create a plugin in error state
      s.importer.register('A', { invalid: true }); // invalid module
      await s.service.load('A');
      expect(s.service.getPluginState('A')?.phase).toBe('error');

      s.service.startEventListeners();
      // crash_recovery_failed only transitions from ready or loading
      s.eventBus.emit('plugin/crash_recovery_failed', { pluginID: 'A', error: 'Another failure' });

      // Should remain in error state (handler guards against non-ready/loading phases)
      expect(s.service.getPluginState('A')?.phase).toBe('error');
    });
  });

  // ── 9.7 plugin/crash ──────────────────────────────────────────────

  describe('9.7 plugin/crash', () => {
    it('9.7.20 — for loaded plugin logs warning, phase unchanged', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');

      s.service.startEventListeners();
      s.eventBus.emit('plugin/crash', { pluginID: 'A', error: 'Segfault' });

      // Phase should remain ready — backend recovery proceeds separately
      expect(s.service.getPluginState('A')?.phase).toBe('ready');
      expect(s.log.byLevel('warn').some((l) =>
        l.message.includes('crashed'),
      )).toBe(true);
    });

    it('9.7.21 — for unknown plugin does not crash', () => {
      const s = setup();
      s.service.startEventListeners();

      expect(() => {
        s.eventBus.emit('plugin/crash', { pluginID: 'unknown' });
      }).not.toThrow();
    });
  });

  // ── 9.8 plugin/recovered ────────────────────────────────────────────

  describe('9.8 plugin/recovered', () => {
    it('9.8.22 — logs debug message for recovered plugin', async () => {
      const s = setup();
      s.importer.register('A', validModule());
      await s.service.load('A');

      s.service.startEventListeners();
      s.eventBus.emit('plugin/recovered', { pluginID: 'A' });

      expect(s.log.byLevel('debug').some((l) =>
        l.message.includes('recovered'),
      )).toBe(true);
    });
  });
});

// ─── Group 20: Lifecycle Operations ─────────────────────────────────

describe('Group 20: Lifecycle Operations', () => {
  let s: ReturnType<typeof setup>;

  beforeEach(() => {
    s = setup();
  });

  it('20.1 — markReady() sets ready', () => {
    expect(s.service.getSnapshot().ready).toBe(false);
    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
  });

  it('20.2 — markReady() with zero plugins', () => {
    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
    expect(s.service.getSnapshot().plugins.size).toBe(0);
  });

  it('20.3 — markReady() with some failed', async () => {
    s.importer.register('A', validModule());
    s.importer.register('B', { invalid: true }); // will fail validation
    await s.service.load('A');
    await s.service.load('B');

    expect(s.service.getPluginState('A')?.phase).toBe('ready');
    expect(s.service.getPluginState('B')?.phase).toBe('error');

    s.service.markReady();
    expect(s.service.getSnapshot().ready).toBe(true);
  });

  it('20.4 — isReady() reflects markReady', () => {
    expect(s.service.isReady()).toBe(false);
    s.service.markReady();
    expect(s.service.isReady()).toBe(true);
  });

  it('20.5 — reset() clears everything', async () => {
    s.importer.register('A', validModule());
    s.importer.register('B', validModule());
    await s.service.load('A');
    await s.service.load('B');
    s.service.markReady();

    s.service.reset();

    const snap = s.service.getSnapshot();
    expect(snap.plugins.size).toBe(0);
    expect(snap.registrations.size).toBe(0);
    expect(snap.ready).toBe(false);
    expect(snap.routeVersion).toBe(0);
  });

  it('20.6 — reset() stops event listeners', () => {
    s.service.startEventListeners();
    expect(s.eventBus.listenerCount()).toBe(7);

    s.service.reset();
    expect(s.eventBus.listenerCount()).toBe(0);
  });

  it('20.7 — reset() clears inflightLoads and discards stale results', async () => {
    const deferred = createDeferred<unknown>();
    s.importer.register('A', () => deferred.promise);

    // Start load (will hang on import until deferred resolves)
    const loadPromise = s.service.load('A');

    // Plugin should be in loading state
    expect(s.service.getPluginState('A')?.phase).toBe('loading');

    // Debug snapshot should show inflight
    const debug1 = s.service.getDebugSnapshot();
    expect(debug1.plugins['A']?.inflightLoad).toBe(true);

    // Reset clears everything
    s.service.reset();

    const debug2 = s.service.getDebugSnapshot();
    expect(Object.keys(debug2.plugins)).toHaveLength(0);

    // Resolve the deferred — the stale load should be discarded
    deferred.resolve(validModule());
    await loadPromise;

    // After stale result arrives, state should still be clean
    expect(s.service.getPluginState('A')).toBeUndefined();
    const debug3 = s.service.getDebugSnapshot();
    expect(Object.keys(debug3.plugins)).toHaveLength(0);
    expect(s.service.getSnapshot().registrations.size).toBe(0);
  });
});
