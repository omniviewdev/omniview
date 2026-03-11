import { describe, it, expect } from 'vitest';
import { PluginService } from './PluginService';
import { createTestDeps } from '../testing/helpers';

describe('Soft Contribution Resolution', () => {
  describe('applyContributions holds pending contributions', () => {
    it('holds contributions targeting missing EPs in pending map', async () => {
      const { deps, importer } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'missing/ep',
            registration: { id: 'contrib-1', label: 'C1', value: 'val', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');

      expect(service.getPluginState('plugin-a')?.phase).toBe('ready');
      const pending = service.getPendingContributions();
      expect(pending.get('missing/ep')).toHaveLength(1);
    });

    it('applies non-missing EP contributions normally while holding missing ones', async () => {
      const { deps, importer, extensions } = createTestDeps();
      const service = new PluginService(deps);

      extensions.addExtensionPoint({ id: 'existing/ep', pluginId: 'host' });

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'existing/ep',
            registration: { id: 'contrib-ok', label: 'OK', value: 'v', meta: undefined },
          },
          {
            extensionPointId: 'missing/ep',
            registration: { id: 'contrib-pending', label: 'Pend', value: 'v', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');

      expect(service.getPluginState('plugin-a')?.phase).toBe('ready');
      const store = extensions.getExtensionPoint('existing/ep');
      expect(store?.list()?.some((r: any) => r.id === 'plugin-a/contrib-ok')).toBe(true);
      expect(service.getPendingContributions().get('missing/ep')).toHaveLength(1);
    });
  });

  describe('replay from pending when EP appears', () => {
    it('replays pending contributions when a plugin registers the target EP', async () => {
      const { deps, importer, extensions } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'plugin-b/ep',
            registration: { id: 'from-a', label: 'FromA', value: 'v', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');
      expect(service.getPendingContributions().has('plugin-b/ep')).toBe(true);

      importer.register('plugin-b', {
        plugin: {
          _routes: [],
          _extensions: [{ id: 'plugin-b/ep', pluginId: 'plugin-b' }],
        },
        extensionRegistrations: [],
      });

      await service.load('plugin-b');

      expect(service.getPendingContributions().has('plugin-b/ep')).toBe(false);
      const store = extensions.getExtensionPoint('plugin-b/ep');
      expect(store?.list()?.some((r: any) => r.id === 'plugin-a/from-a')).toBe(true);
    });
  });

  describe('unload removes pending contributions', () => {
    it('removes pending contributions when plugin is unloaded', async () => {
      const { deps, importer } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'missing/ep',
            registration: { id: 'contrib-1', label: 'C', value: 'v', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');
      expect(service.getPendingContributions().has('missing/ep')).toBe(true);

      await service.unload('plugin-a');
      expect(service.getPendingContributions().has('missing/ep')).toBe(false);
    });
  });

  describe('loadAll with soft resolution', () => {
    it('holds contributions for EPs not registered by any plugin in the batch', async () => {
      const { deps, importer } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'external/ep',
            registration: { id: 'from-a', label: 'A', value: 'v', meta: undefined },
          },
        ],
      });
      importer.register('plugin-b', {
        plugin: { _routes: [] },
        extensionRegistrations: [],
      });

      await service.loadAll([
        { id: 'plugin-a', dev: false },
        { id: 'plugin-b', dev: false },
      ]);

      expect(service.getPluginState('plugin-a')?.phase).toBe('ready');
      expect(service.getPluginState('plugin-b')?.phase).toBe('ready');
      expect(service.getPendingContributions().has('external/ep')).toBe(true);
    });

    it('resolves cross-plugin contributions within a loadAll batch', async () => {
      const { deps, importer, extensions } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'plugin-b/ep',
            registration: { id: 'from-a', label: 'A', value: 'v', meta: undefined },
          },
        ],
      });
      importer.register('plugin-b', {
        plugin: {
          _routes: [],
          _extensions: [{ id: 'plugin-b/ep', pluginId: 'plugin-b' }],
        },
        extensionRegistrations: [],
      });

      await service.loadAll([
        { id: 'plugin-a', dev: false },
        { id: 'plugin-b', dev: false },
      ]);

      expect(service.getPluginState('plugin-a')?.phase).toBe('ready');
      expect(service.getPluginState('plugin-b')?.phase).toBe('ready');
      const store = extensions.getExtensionPoint('plugin-b/ep');
      expect(store?.list()?.some((r: any) => r.id === 'plugin-a/from-a')).toBe(true);
    });
  });

  describe('debug snapshot includes pending', () => {
    it('includes pending contributions in debug snapshot', async () => {
      const { deps, importer } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'missing/ep',
            registration: { id: 'contrib-1', label: 'C', value: 'v', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');
      const snap = service.getDebugSnapshot();
      expect(snap.pendingContributions['missing/ep']).toBeDefined();
      expect(snap.pendingContributions['missing/ep']).toHaveLength(1);
    });
  });

  describe('reset clears pending map', () => {
    it('clears pending contributions on reset', async () => {
      const { deps, importer } = createTestDeps();
      const service = new PluginService(deps);

      importer.register('plugin-a', {
        plugin: { _routes: [] },
        extensionRegistrations: [
          {
            extensionPointId: 'missing/ep',
            registration: { id: 'contrib-1', label: 'C', value: 'v', meta: undefined },
          },
        ],
      });

      await service.load('plugin-a');
      expect(service.getPendingContributions().size).toBeGreaterThan(0);

      service.reset();
      expect(service.getPendingContributions().size).toBe(0);
    });
  });
});
