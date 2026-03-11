import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import { validatePluginExports } from '../core/validation';
import { MissingExtensionPointError, DuplicateContributionError } from '../core/errors';
import { InMemoryCrashDataStrategy } from '../core/CrashDataService';
import type {
  PluginServiceDeps,
  PluginImportOpts,
} from '../core/types';

// ─── In-Memory Module Importer ──────────────────────────────────────

export class InMemoryModuleImporter {
  private _modules = new Map<string, unknown>();
  private _importCount = 0;

  /** Register a module that will be returned when imported by pluginId. */
  register(pluginId: string, moduleExports: unknown): void {
    this._modules.set(pluginId, moduleExports);
  }

  /** Remove a registered module. */
  remove(pluginId: string): void {
    this._modules.delete(pluginId);
  }

  /** How many times importPlugin has been called. */
  get importCount(): number {
    return this._importCount;
  }

  /** The import function to wire into deps. */
  importPlugin = async (opts: PluginImportOpts): Promise<unknown> => {
    this._importCount++;
    const mod = this._modules.get(opts.pluginId);
    if (mod === undefined) {
      throw new Error(`Module "${opts.pluginId}" not registered in InMemoryModuleImporter`);
    }
    // If the registered value is a function, call it to get the module
    // (allows deferred/dynamic module factories).
    if (typeof mod === 'function') {
      return (mod as () => unknown)();
    }
    return mod;
  };
}

// ─── In-Memory Event Bus ────────────────────────────────────────────

export class InMemoryEventBus {
  private _handlers = new Map<string, Set<(...args: any[]) => void>>();

  /** Wire into deps.onEvent. */
  onEvent = (eventName: string, handler: (...args: any[]) => void): (() => void) => {
    if (!this._handlers.has(eventName)) {
      this._handlers.set(eventName, new Set());
    }
    this._handlers.get(eventName)!.add(handler);
    return () => {
      this._handlers.get(eventName)?.delete(handler);
    };
  };

  /** Emit an event for testing. */
  emit(eventName: string, ...args: any[]): void {
    const handlers = this._handlers.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  /** Check if any handlers are registered for an event. */
  hasHandlers(eventName: string): boolean {
    return (this._handlers.get(eventName)?.size ?? 0) > 0;
  }

  /** Total number of registered handlers across all events. */
  listenerCount(): number {
    let count = 0;
    for (const handlers of this._handlers.values()) {
      count += handlers.size;
    }
    return count;
  }
}

// ─── Log Capture ────────────────────────────────────────────────────

export interface CapturedLog {
  level: 'debug' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export class LogCapture {
  readonly logs: CapturedLog[] = [];

  readonly logger = {
    debug: (message: string, data?: Record<string, unknown>) => {
      this.logs.push({ level: 'debug', message, data });
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      this.logs.push({ level: 'warn', message, data });
    },
    error: (message: string, data?: Record<string, unknown>) => {
      this.logs.push({ level: 'error', message, data });
    },
  };

  /** Get logs filtered by level. */
  byLevel(level: CapturedLog['level']): CapturedLog[] {
    return this.logs.filter((l) => l.level === level);
  }

  /** Clear all captured logs. */
  clear(): void {
    this.logs.length = 0;
  }
}

// ─── Test Deps Factory ──────────────────────────────────────────────

export interface TestDeps {
  deps: PluginServiceDeps;
  importer: InMemoryModuleImporter;
  eventBus: InMemoryEventBus;
  extensions: ExtensionPointRegistry;
  log: LogCapture;
  crashData: InMemoryCrashDataStrategy;
}

/**
 * Create a full set of test dependencies that satisfy PluginServiceDeps.
 *
 * Uses:
 * - InMemoryModuleImporter for importPlugin/clearPlugin
 * - InMemoryEventBus for onEvent
 * - Real ExtensionPointRegistry for extension point operations
 * - Real validatePluginExports for validation
 * - LogCapture for log assertions
 *
 * The extension registry is the REAL runtime implementation — test deps
 * are behaviorally consistent with production deps on registry semantics:
 * - Missing extension points throw MissingExtensionPointError
 * - Duplicate extension points throw
 * - Cache invalidation works
 * - Subscriptions fire
 */
export function createTestDeps(opts?: { maxCrashRecordsPerContribution?: number }): TestDeps {
  const importer = new InMemoryModuleImporter();
  const eventBus = new InMemoryEventBus();
  const extensions = new ExtensionPointRegistry();
  const log = new LogCapture();
  const crashData = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: opts?.maxCrashRecordsPerContribution ?? 10 });

  const deps: PluginServiceDeps = {
    crashData,
    importPlugin: importer.importPlugin,

    clearPlugin: async () => {
      // In-memory: nothing to clear
    },

    onEvent: eventBus.onEvent,

    ensureBuiltinExtensionPoints: () => {
      // Test-specific: no-op by default.
      // Tests that need builtins should register them explicitly via extensions.addExtensionPoint().
    },

    addExtensionPoint: (extension) => {
      extensions.addExtensionPoint(extension);
    },

    removeExtensionPoints: (pluginId) => {
      extensions.removeExtensionPoints(pluginId);
    },

    registerContribution: (extensionPointId, contribution) => {
      const store = extensions.getExtensionPoint(extensionPointId);
      if (!store) {
        throw new MissingExtensionPointError(
          `Extension point "${extensionPointId}" does not exist — cannot register contribution "${contribution.id}" from plugin "${contribution.plugin}"`,
          {
            pluginId: contribution.plugin,
            extensionPointId,
          },
        );
      }
      try {
        store.register(contribution);
      } catch (err) {
        if (err instanceof Error && err.message.includes('already exists')) {
          throw new DuplicateContributionError(err.message, {
            pluginId: contribution.plugin,
            extensionPointId,
            contributionId: contribution.id,
            cause: err,
          });
        }
        throw err;
      }
    },

    removeContributions: (pluginId) => {
      extensions.removeContributions(pluginId);
    },

    ensureDevSharedDeps: async () => {
      // In-memory: no shared deps to ensure
    },

    validateExports: validatePluginExports,
    log: log.logger,
  };

  return { deps, importer, eventBus, extensions, log, crashData };
}

// ─── Deferred Promise ───────────────────────────────────────────────

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Create a deferred promise for timing control in tests.
 */
export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
