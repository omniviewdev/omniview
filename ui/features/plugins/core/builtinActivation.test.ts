import { describe, expect, it, vi } from 'vitest';
import { PluginWindow } from '@omniviewdev/runtime';
import { PluginService } from './PluginService';
import type { PluginDescriptor } from './types';
import { builtinRoutes, createPluginModuleResolver, getBuiltinModule, type BuiltinModuleRegistry } from '../adapters/builtinModules';
import { createDeferred, createTestDeps } from '../testing/helpers';

function featureModule(path = 'home') {
  const plugin = new PluginWindow().withRoutes([{ path }]);
  plugin.registerExtensionPoints([{ id: 'builtin/details', mode: 'multiple' }]);
  return {
    plugin,
    extensionRegistrations: [{
      extensionPointId: 'builtin/details',
      registration: { id: 'builtin/detail', label: 'Detail', value: () => null },
    }],
  };
}

function setup(options: {
  load?: () => Promise<unknown>;
  activate?: () => Promise<unknown>;
  registry?: BuiltinModuleRegistry;
  descriptor?: Partial<PluginDescriptor>;
} = {}) {
  const t = createTestDeps();
  let descriptor: PluginDescriptor = {
    id: 'native', dev: false, origin: 'builtin', enabled: true, frontendModule: 'native/ui', ...options.descriptor,
  };
  let activations = 0;
  let evaluations = 0;
  const registry: BuiltinModuleRegistry = options.registry ?? {
    'native/ui': { routes: [{ path: 'home' }], load: async () => {
      evaluations++;
      return options.load ? options.load() : featureModule();
    } },
  };
  t.deps.getPluginDescriptor = async () => descriptor;
  t.deps.getBuiltinRoutes = key => builtinRoutes(key, registry);
  t.deps.importPlugin = createPluginModuleResolver({
    getDescriptor: t.deps.getPluginDescriptor,
    activateBackend: async () => {
      activations++;

      return options.activate?.();
    },
    importExternal: t.importer.importPlugin,
    registry,
  });
  const service = new PluginService(t.deps, { retryBaseDelayMs: 0 });
  service.startEventListeners();
  service.discoverBuiltins([descriptor]);
  return {
    ...t, service,
    counts: () => ({ activations, evaluations }),
    replace(update: Partial<PluginDescriptor>) {
      descriptor = { ...descriptor, ...update };
      service.discoverBuiltins([descriptor]);
    },
    enable(enabled: boolean) {
      descriptor = { ...descriptor, enabled };
      t.eventBus.emit('plugin/enablement_changed', { pluginID: descriptor.id, enabled });
    },
  };
}

describe('built-in demand activation', () => {
  it('discovers declarative routes without evaluating modules, even through loadAll', async () => {
    const t = setup();
    expect(t.service.getSnapshot().registrations.get('native')?.routes).toEqual([{ path: 'home', children: undefined }]);
    await t.service.loadAll([{ id: 'native', dev: false, origin: 'builtin' }]);
    expect(t.counts()).toEqual({ activations: 0, evaluations: 0 });
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
    await Promise.all([t.service.load('native'), t.service.load('native')]);
    expect(t.counts()).toEqual({ activations: 1, evaluations: 1 });
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
  });

  it('keeps backend-only built-ins out of navigation', () => {
    const t = setup({ descriptor: { frontendModule: '' } });
    expect(t.service.getAllRoutes()).toEqual([]);
  });

  it('does not import frontend code when native activation fails', async () => {
    const t = setup({ activate: async () => {
      throw new Error('native unavailable');
    } });
    await t.service.load('native');
    expect(t.counts()).toEqual({ activations: 1, evaluations: 0 });
    expect(t.service.getPluginState('native')?.error).toContain('native unavailable');
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
  });

  it('does not evaluate frontend code after native activation times out', async () => {
    vi.useFakeTimers();
    try {
      const native = createDeferred();
      const t = setup({ activate: async () => native.promise });
      const loading = t.service.load('native');
      await vi.runAllTimersAsync();
      await loading;
      expect(t.service.getPluginState('native')?.phase).toBe('error');
      native.resolve();
      await vi.runAllTimersAsync();
      expect(t.counts()).toEqual({ activations: 1, evaluations: 0 });
      expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects unknown built-in keys without falling back to external or development imports', async () => {
    const t = setup({ descriptor: { frontendModule: 'missing' } });
    t.importer.register('native', featureModule());
    await t.service.load('native', { dev: true, devPort: 5173 });
    expect(t.service.getPluginState('native')?.error).toContain('Unknown built-in frontend module');
    expect(t.importer.importCount).toBe(0);
    expect(t.counts()).toEqual({ activations: 0, evaluations: 0 });
    expect(() => getBuiltinModule('toString', {})).toThrow('Unknown built-in frontend module');
    expect(() => getBuiltinModule('__proto__', {})).toThrow('Unknown built-in frontend module');
  });

  it('uses common export validation for built-in modules', async () => {
    const t = setup({ load: async () => ({ unexpected: true }) });
    await t.service.load('native');
    expect(t.service.getPluginState('native')?.phase).toBe('error');
    expect(t.service.getPluginState('native')?.validationErrors.length).toBeGreaterThan(0);
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
  });

  it('keeps disabled plugins inert and permits explicit activation after re-enable', async () => {
    const t = setup({ descriptor: { enabled: false } });
    expect(t.service.getAllRoutes()).toEqual([]);
    await expect(t.service.load('native')).rejects.toThrow('disabled');
    expect(t.counts()).toEqual({ activations: 0, evaluations: 0 });
    t.enable(true);
    expect(t.counts()).toEqual({ activations: 0, evaluations: 0 });
    await t.service.load('native');
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
  });

  it('blocks repeat demand throughout a pending native disable, including stale inventory refreshes', async () => {
    const t = setup();
    await t.service.load('native');
    const started = createDeferred();
    const committed = createDeferred();
    t.deps.setPluginEnabled = async () => {
      started.resolve();
      await committed.promise;
    };

    const disabling = t.service.setEnabled('native', false);
    await started.promise;
    t.replace({ enabled: true });
    expect(t.service.getAllRoutes()).toEqual([]);
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
    await expect(t.service.load('native')).rejects.toThrow('disabled');
    expect(t.counts()).toEqual({ activations: 1, evaluations: 1 });
    committed.resolve();
    await disabling;
    await expect(t.service.load('native')).rejects.toThrow('disabled');
    t.enable(true);
    await t.service.load('native');
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
  });

  it('restores demand after native disable persistence fails', async () => {
    const t = setup();
    await t.service.load('native');
    t.deps.setPluginEnabled = async () => {
      throw new Error('preference write failed');
    };

    await expect(t.service.setEnabled('native', false)).rejects.toThrow('preference write failed');
    await t.service.load('native');
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
    expect(t.extensions.getExtensionPoint('builtin/details')?.listAll()).toHaveLength(1);
  });

  it('fences module evaluation when disabled during native startup', async () => {
    const started = createDeferred();
    const startup = createDeferred();
    const t = setup({ activate: async () => {
      started.resolve();
      await startup.promise;
    } });
    const pending = t.service.load('native');
    await started.promise;
    t.enable(false);
    startup.resolve();
    await pending;
    expect(t.counts()).toEqual({ activations: 1, evaluations: 0 });
    expect(t.service.getAllRoutes()).toEqual([]);
    expect(t.service.getPluginState('native')?.phase).toBe('idle');
    t.enable(true);
    await t.service.load('native');
    expect(t.counts()).toEqual({ activations: 2, evaluations: 1 });
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
  });

  it('fences late frontend completion and removes ready contributions on disable', async () => {
    const started = createDeferred();
    const imported = createDeferred<unknown>();
    const t = setup({ load: async () => {
      started.resolve();

      return imported.promise;
    } });
    const pending = t.service.load('native');
    await started.promise;
    t.enable(false);
    imported.resolve(featureModule());
    await pending;
    expect(t.service.getAllRoutes()).toEqual([]);
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
    t.enable(true);
    await t.service.load('native');
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(true);
    t.enable(false);
    // Cleanup is immediate, even before asynchronous module-cache retirement settles.
    expect(t.service.getSnapshot().registrations.has('native')).toBe(false);
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
  });

  it('does not publish a retired module after inventory replacement', async () => {
    const started = createDeferred();
    const retired = createDeferred<unknown>();
    const t = setup({ registry: {
      'native/ui': { routes: [{ path: 'old' }], load: async () => {
        started.resolve();

        return retired.promise;
      } },
      'native/replacement': { routes: [{ path: 'new' }], load: async () => featureModule('new') },
    } });
    const pending = t.service.load('native');
    await started.promise;
    t.replace({ frontendModule: 'native/replacement' });
    await t.service.unload('native');
    await t.service.load('native');
    retired.resolve(featureModule('old'));
    await pending;
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
    expect(t.service.getAllRoutes().map(route => route.path)).toEqual(['new']);
    expect(t.extensions.getExtensionPoint('builtin/details')?.listAll()).toHaveLength(1);
  });

  it('retires pending activation when native unload starts', async () => {
    const started = createDeferred();
    const startup = createDeferred();
    const t = setup({ activate: async () => {
      started.resolve();
      await startup.promise;
    } });
    const pending = t.service.load('native');
    await started.promise;
    t.eventBus.emit('plugin/state_change', { pluginID: 'native', to: 'Stopping' });
    startup.resolve();
    await pending;
    expect(t.counts()).toEqual({ activations: 1, evaluations: 0 });
    expect(t.extensions.hasExtensionPoint('builtin/details')).toBe(false);
    expect(t.service.getPluginState('native')?.backendPhase).toBe('Stopping');
    expect(t.service.getPluginState('native')?.phase).toBe('idle');
  });

  it('keeps external imports on their existing source path', async () => {
    const t = setup({ descriptor: { origin: 'external' } });
    t.importer.register('native', featureModule());
    await t.service.load('native');
    expect(t.importer.importCount).toBe(1);
    expect(t.counts()).toEqual({ activations: 0, evaluations: 0 });
    expect(t.service.getPluginState('native')?.phase).toBe('ready');
  });
});
