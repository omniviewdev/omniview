import type { CrashRecord, CrashDataStrategy } from './types';

interface CrashEntry {
  records: CrashRecord[];
  count: number;
  pluginId: string;
}

export interface InMemoryCrashDataStrategyConfig {
  readonly maxRecordsPerContribution: number;
}

export class InMemoryCrashDataStrategy implements CrashDataStrategy {
  private readonly maxRecords: number;
  private readonly entries = new Map<string, CrashEntry>();
  private readonly listeners = new Set<() => void>();

  constructor(config: InMemoryCrashDataStrategyConfig) {
    if (!Number.isInteger(config.maxRecordsPerContribution) || config.maxRecordsPerContribution < 1) {
      throw new Error(`maxRecordsPerContribution must be a positive integer, got ${config.maxRecordsPerContribution}`);
    }
    this.maxRecords = config.maxRecordsPerContribution;
  }

  recordCrash(record: CrashRecord): void {
    const entry = this.entries.get(record.contributionId);
    if (entry) {
      entry.records.push(record);
      entry.count++;
      while (entry.records.length > this.maxRecords) {
        entry.records.shift();
      }
    } else {
      this.entries.set(record.contributionId, {
        records: [record],
        count: 1,
        pluginId: record.pluginId,
      });
    }
    this.notify();
  }

  clearForContribution(contributionId: string): void {
    if (this.entries.delete(contributionId)) {
      this.notify();
    }
  }

  clearForPlugin(pluginId: string): void {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (entry.pluginId === pluginId) {
        this.entries.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  clearAll(): void {
    if (this.entries.size > 0) {
      this.entries.clear();
      this.notify();
    }
  }

  getCrashCount(contributionId: string): number {
    return this.entries.get(contributionId)?.count ?? 0;
  }

  getCrashHistory(contributionId: string): readonly CrashRecord[] {
    const entry = this.entries.get(contributionId);
    return entry ? [...entry.records] : [];
  }

  getAllCrashHistory(): ReadonlyMap<string, readonly CrashRecord[]> {
    const result = new Map<string, readonly CrashRecord[]>();
    for (const [id, entry] of this.entries) {
      result.set(id, [...entry.records]);
    }
    return result;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
