import { describe, it, expect, vi } from 'vitest';
import { InMemoryCrashDataStrategy } from './CrashDataService';
import type { CrashRecord } from './types';

function makeCrashRecord(overrides?: Partial<CrashRecord>): CrashRecord {
  return {
    contributionId: 'plugin-a/sidebar/apps::v1::Deployment',
    pluginId: 'plugin-a',
    extensionPointId: 'omniview/resource/sidebar/infopanel',
    boundary: 'ExtensionPointRenderer',
    errorMessage: 'Component crashed',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('InMemoryCrashDataStrategy', () => {
  describe('recordCrash', () => {
    it('stores a crash record', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      const record = makeCrashRecord();
      strategy.recordCrash(record);
      expect(strategy.getCrashCount(record.contributionId)).toBe(1);
      expect(strategy.getCrashHistory(record.contributionId)).toEqual([record]);
    });

    it('stores multiple crashes for the same contribution', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      const r1 = makeCrashRecord({ timestamp: 1 });
      const r2 = makeCrashRecord({ timestamp: 2 });
      strategy.recordCrash(r1);
      strategy.recordCrash(r2);
      expect(strategy.getCrashCount(r1.contributionId)).toBe(2);
      expect(strategy.getCrashHistory(r1.contributionId)).toEqual([r1, r2]);
    });

    it('evicts oldest records when cap is reached', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 3 });
      const records = [1, 2, 3, 4].map((t) => makeCrashRecord({ timestamp: t }));
      for (const r of records) strategy.recordCrash(r);
      expect(strategy.getCrashCount(records[0].contributionId)).toBe(4);
      const history = strategy.getCrashHistory(records[0].contributionId);
      expect(history).toHaveLength(3);
      expect(history[0].timestamp).toBe(2);
      expect(history[2].timestamp).toBe(4);
    });

    it('notifies subscribers on recordCrash', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      const listener = vi.fn();
      strategy.subscribe(listener);
      strategy.recordCrash(makeCrashRecord());
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearForContribution', () => {
    it('removes all records for a contribution', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord());
      strategy.recordCrash(makeCrashRecord());
      strategy.clearForContribution('plugin-a/sidebar/apps::v1::Deployment');
      expect(strategy.getCrashCount('plugin-a/sidebar/apps::v1::Deployment')).toBe(0);
      expect(strategy.getCrashHistory('plugin-a/sidebar/apps::v1::Deployment')).toEqual([]);
    });

    it('does not affect other contributions', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'a' }));
      strategy.recordCrash(makeCrashRecord({ contributionId: 'b' }));
      strategy.clearForContribution('a');
      expect(strategy.getCrashCount('a')).toBe(0);
      expect(strategy.getCrashCount('b')).toBe(1);
    });

    it('notifies subscribers', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord());
      const listener = vi.fn();
      strategy.subscribe(listener);
      strategy.clearForContribution('plugin-a/sidebar/apps::v1::Deployment');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearForPlugin', () => {
    it('removes all records for contributions belonging to a plugin', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c1', pluginId: 'plugin-a' }));
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c2', pluginId: 'plugin-a' }));
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c3', pluginId: 'plugin-b' }));
      strategy.clearForPlugin('plugin-a');
      expect(strategy.getCrashCount('c1')).toBe(0);
      expect(strategy.getCrashCount('c2')).toBe(0);
      expect(strategy.getCrashCount('c3')).toBe(1);
    });

    it('notifies subscribers', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c1', pluginId: 'plugin-a' }));
      const listener = vi.fn();
      strategy.subscribe(listener);
      strategy.clearForPlugin('plugin-a');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearAll', () => {
    it('removes all records', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c1' }));
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c2' }));
      strategy.clearAll();
      expect(strategy.getCrashCount('c1')).toBe(0);
      expect(strategy.getCrashCount('c2')).toBe(0);
      expect(strategy.getAllCrashHistory().size).toBe(0);
    });

    it('notifies subscribers', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c1' }));
      const listener = vi.fn();
      strategy.subscribe(listener);
      strategy.clearAll();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCrashCount', () => {
    it('returns 0 for unknown contribution', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      expect(strategy.getCrashCount('unknown')).toBe(0);
    });

    it('tracks count independently of record cap', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 2 });
      for (let i = 0; i < 5; i++) {
        strategy.recordCrash(makeCrashRecord({ timestamp: i }));
      }
      expect(strategy.getCrashCount(makeCrashRecord().contributionId)).toBe(5);
      expect(strategy.getCrashHistory(makeCrashRecord().contributionId)).toHaveLength(2);
    });
  });

  describe('getAllCrashHistory', () => {
    it('returns all contributions with history', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c1' }));
      strategy.recordCrash(makeCrashRecord({ contributionId: 'c2' }));
      const all = strategy.getAllCrashHistory();
      expect(all.size).toBe(2);
      expect(all.has('c1')).toBe(true);
      expect(all.has('c2')).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const strategy = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: 10 });
      const listener = vi.fn();
      const unsub = strategy.subscribe(listener);
      strategy.recordCrash(makeCrashRecord());
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      strategy.recordCrash(makeCrashRecord());
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
