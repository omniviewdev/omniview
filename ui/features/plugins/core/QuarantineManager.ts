import type { CrashDataStrategy, QuarantineInfo } from './types';

interface QuarantineEntry {
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly quarantinedAt: number;
}

export interface QuarantineManagerConfig {
  readonly crashData: CrashDataStrategy;
  readonly threshold: number;
  readonly onQuarantine: (info: QuarantineInfo) => void;
}

export class QuarantineManager {
  private readonly crashData: CrashDataStrategy;
  private readonly threshold: number;
  private readonly onQuarantine: (info: QuarantineInfo) => void;
  private readonly quarantined = new Map<string, QuarantineEntry>();

  constructor(config: QuarantineManagerConfig) {
    if (!Number.isInteger(config.threshold) || config.threshold < 1) {
      throw new Error(`QuarantineManager threshold must be a positive integer, got ${config.threshold}`);
    }
    this.crashData = config.crashData;
    this.threshold = config.threshold;
    this.onQuarantine = config.onQuarantine;
  }

  checkAndQuarantine(contributionId: string, pluginId: string, extensionPointId: string): void {
    if (this.quarantined.has(contributionId)) return;
    const count = this.crashData.getCrashCount(contributionId);
    if (count < this.threshold) return;
    const entry: QuarantineEntry = { pluginId, extensionPointId, quarantinedAt: Date.now() };
    this.quarantined.set(contributionId, entry);
    this.onQuarantine({ contributionId, pluginId, extensionPointId, crashCount: count, quarantinedAt: entry.quarantinedAt });
  }

  isQuarantined(contributionId: string): boolean {
    return this.quarantined.has(contributionId);
  }

  unquarantine(contributionId: string): void {
    if (this.quarantined.delete(contributionId)) {
      this.crashData.clearForContribution(contributionId);
    }
  }

  clearForPlugin(pluginId: string): void {
    for (const [id, entry] of this.quarantined) {
      if (entry.pluginId === pluginId) {
        this.unquarantine(id);
      }
    }
  }

  clearAll(): void {
    for (const id of [...this.quarantined.keys()]) {
      this.unquarantine(id);
    }
  }

  listQuarantined(): QuarantineInfo[] {
    const result: QuarantineInfo[] = [];
    for (const [id, entry] of this.quarantined) {
      result.push({
        contributionId: id,
        pluginId: entry.pluginId,
        extensionPointId: entry.extensionPointId,
        crashCount: this.crashData.getCrashCount(id),
        quarantinedAt: entry.quarantinedAt,
      });
    }
    return result;
  }
}
