import { describe, it, expect, vi } from 'vitest';
import { QuarantineManager } from './QuarantineManager';
import { InMemoryCrashDataStrategy } from './CrashDataService';
import type { CrashRecord } from './types';

function makeCrashRecord(overrides?: Partial<CrashRecord>): CrashRecord {
  return {
    contributionId: 'plugin-a/sidebar/res',
    pluginId: 'plugin-a',
    extensionPointId: 'omniview/resource/sidebar/infopanel',
    boundary: 'ExtensionPointRenderer',
    errorMessage: 'crash',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createTestSetup(threshold = 3) {
  const crashData = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
  const onQuarantine = vi.fn();
  const manager = new QuarantineManager({ crashData, threshold, onQuarantine });
  return { crashData, onQuarantine, manager };
}

describe('QuarantineManager', () => {
  describe('checkAndQuarantine', () => {
    it('does not quarantine below threshold', () => {
      const { crashData, manager } = createTestSetup(3);
      crashData.recordCrash(makeCrashRecord());
      crashData.recordCrash(makeCrashRecord());
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      expect(manager.isQuarantined('plugin-a/sidebar/res')).toBe(false);
    });

    it('quarantines at threshold', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) crashData.recordCrash(makeCrashRecord());
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      expect(manager.isQuarantined('plugin-a/sidebar/res')).toBe(true);
    });

    it('emits onQuarantine callback when quarantine activates', () => {
      const { crashData, manager, onQuarantine } = createTestSetup(3);
      for (let i = 0; i < 3; i++) crashData.recordCrash(makeCrashRecord());
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      expect(onQuarantine).toHaveBeenCalledTimes(1);
      expect(onQuarantine).toHaveBeenCalledWith(expect.objectContaining({
        contributionId: 'plugin-a/sidebar/res',
        pluginId: 'plugin-a',
        extensionPointId: 'omniview/resource/sidebar/infopanel',
      }));
    });

    it('does not emit again if already quarantined', () => {
      const { crashData, manager, onQuarantine } = createTestSetup(3);
      for (let i = 0; i < 4; i++) crashData.recordCrash(makeCrashRecord());
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      expect(onQuarantine).toHaveBeenCalledTimes(1);
    });
  });

  describe('unquarantine', () => {
    it('removes quarantine and resets crash count', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) crashData.recordCrash(makeCrashRecord());
      manager.checkAndQuarantine('plugin-a/sidebar/res', 'plugin-a', 'omniview/resource/sidebar/infopanel');
      manager.unquarantine('plugin-a/sidebar/res');
      expect(manager.isQuarantined('plugin-a/sidebar/res')).toBe(false);
      expect(crashData.getCrashCount('plugin-a/sidebar/res')).toBe(0);
    });
  });

  describe('clearForPlugin', () => {
    it('clears quarantine for all contributions of a plugin', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) {
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c1', pluginId: 'plugin-a' }));
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c2', pluginId: 'plugin-a' }));
      }
      manager.checkAndQuarantine('c1', 'plugin-a', 'ep1');
      manager.checkAndQuarantine('c2', 'plugin-a', 'ep1');
      manager.clearForPlugin('plugin-a');
      expect(manager.isQuarantined('c1')).toBe(false);
      expect(manager.isQuarantined('c2')).toBe(false);
      expect(crashData.getCrashCount('c1')).toBe(0);
      expect(crashData.getCrashCount('c2')).toBe(0);
    });

    it('does not affect other plugins', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) {
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c1', pluginId: 'plugin-a' }));
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c2', pluginId: 'plugin-b' }));
      }
      manager.checkAndQuarantine('c1', 'plugin-a', 'ep1');
      manager.checkAndQuarantine('c2', 'plugin-b', 'ep1');
      manager.clearForPlugin('plugin-a');
      expect(manager.isQuarantined('c1')).toBe(false);
      expect(manager.isQuarantined('c2')).toBe(true);
    });
  });

  describe('clearAll', () => {
    it('clears all quarantine state', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) {
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c1' }));
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c2' }));
      }
      manager.checkAndQuarantine('c1', 'plugin-a', 'ep1');
      manager.checkAndQuarantine('c2', 'plugin-a', 'ep1');
      manager.clearAll();
      expect(manager.isQuarantined('c1')).toBe(false);
      expect(manager.isQuarantined('c2')).toBe(false);
      expect(crashData.getCrashCount('c1')).toBe(0);
      expect(crashData.getCrashCount('c2')).toBe(0);
    });
  });

  describe('listQuarantined', () => {
    it('returns all quarantined contributions', () => {
      const { crashData, manager } = createTestSetup(3);
      for (let i = 0; i < 3; i++) {
        crashData.recordCrash(makeCrashRecord({ contributionId: 'c1', pluginId: 'plugin-a' }));
      }
      manager.checkAndQuarantine('c1', 'plugin-a', 'ep1');
      const list = manager.listQuarantined();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        contributionId: 'c1',
        pluginId: 'plugin-a',
        extensionPointId: 'ep1',
        crashCount: 3,
      });
    });

    it('returns empty array when nothing is quarantined', () => {
      const { manager } = createTestSetup(3);
      expect(manager.listQuarantined()).toEqual([]);
    });
  });

  describe('isQuarantined', () => {
    it('returns false for unknown contribution', () => {
      const { manager } = createTestSetup(3);
      expect(manager.isQuarantined('unknown')).toBe(false);
    });
  });
});
