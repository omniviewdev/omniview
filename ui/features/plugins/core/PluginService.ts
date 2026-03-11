import type { RouteObject } from 'react-router-dom';
import { assertValidTransition } from './transitions';
import { normalizeContributions } from './normalization';
import {
  PluginValidationError,
  PluginTimeoutError,
} from './errors';
import type {
  PluginPhase,
  BackendPluginPhase,
  PluginState,
  ValidatedExports,
  PluginRegistrations,
  NormalizedContribution,
  PreparedPluginLoad,
  PluginServiceSnapshot,
  PluginServiceDebugSnapshot,
  PluginServiceDebugPluginState,
  PluginDebugContributionRecord,
  PluginServiceConfig,
  PluginServiceDeps,
  PluginDescriptor,
  PluginLoadOpts,
  ExtensionPointSettings,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ─── BackendPluginPhase validation ──────────────────────────────────

const BACKEND_PHASES = new Set<string>([
  'Uninstalled', 'Installing', 'Installed', 'Building', 'BuildFailed',
  'Validating', 'Starting', 'Running', 'Degraded', 'Recovering',
  'Stopping', 'Stopped', 'Failed', 'Uninstalling',
]);

function isBackendPluginPhase(value: string): value is BackendPluginPhase {
  return BACKEND_PHASES.has(value);
}

// ─── Default plugin state factory ───────────────────────────────────

function createDefaultPluginState(
  id: string,
  overrides?: Partial<PluginState>,
): PluginState {
  return {
    id,
    phase: 'idle',
    backendPhase: null,
    error: null,
    retryCount: 0,
    loadedAt: null,
    isDev: false,
    devPort: null,
    pluginWindow: null,
    validationErrors: [],
    moduleHash: null,
    ...overrides,
  };
}

// ─── PluginService ──────────────────────────────────────────────────

export class PluginService {
  private readonly deps: PluginServiceDeps;
  private readonly config: Readonly<PluginServiceConfig>;

  // ── Internal state ──────────────────────────────────────────────

  private state = new Map<string, PluginState>();
  private registrations = new Map<string, PluginRegistrations>();
  private inflightLoads = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private eventCleanups: Array<() => void> = [];

  // Contribution replay storage
  private normalizedContributionsByPlugin = new Map<string, NormalizedContribution[]>();
  private definedExtensionPointIdsByPlugin = new Map<string, string[]>();

  // Snapshot memoization
  private cachedSnapshot: PluginServiceSnapshot | null = null;
  private cachedRoutes: RouteObject[] | null = null;

  // Service readiness
  private ready = false;
  private routeVersion = 0;

  // Cancellation tokens for stale load detection
  private loadGeneration = new Map<string, number>();

  constructor(deps: PluginServiceDeps, config?: Partial<PluginServiceConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Queries ─────────────────────────────────────────────────────

  getSnapshot(): PluginServiceSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot;

    this.cachedSnapshot = Object.freeze({
      plugins: new Map(this.state) as ReadonlyMap<string, PluginState>,
      registrations: new Map(this.registrations) as ReadonlyMap<string, PluginRegistrations>,
      ready: this.ready,
      routeVersion: this.routeVersion,
    });

    return this.cachedSnapshot;
  }

  getPluginState(pluginId: string): PluginState | undefined {
    return this.state.get(pluginId);
  }

  getAllRoutes(): RouteObject[] {
    if (this.cachedRoutes) return this.cachedRoutes;

    const routes: RouteObject[] = [];
    for (const reg of this.registrations.values()) {
      routes.push(...reg.routes);
    }
    this.cachedRoutes = routes;
    return routes;
  }

  isReady(): boolean {
    return this.ready;
  }

  getRouteVersion(): number {
    return this.routeVersion;
  }

  getDebugSnapshot(): PluginServiceDebugSnapshot {
    const plugins: Record<string, PluginServiceDebugPluginState> = {};

    for (const [id, s] of this.state) {
      plugins[id] = {
        ...s,
        inflightLoad: this.inflightLoads.has(id),
        contributedExtensionPoints: this.getContributedExtensionPointIds(id),
        contributions: this.getContributionDebugRecords(id),
        definedExtensionPoints: this.getDefinedExtensionPointIds(id),
      };
    }

    return {
      plugins,
      config: this.config,
      ready: this.ready,
      routeVersion: this.routeVersion,
      eventListenersActive: this.eventCleanups.length > 0,
    };
  }

  // ── Commands ────────────────────────────────────────────────────

  async load(pluginId: string, opts?: PluginLoadOpts): Promise<void> {
    const existing = this.state.get(pluginId);

    // Already loaded — no-op
    if (existing?.phase === 'ready') return;

    // In error or retrying — no-op (use retry())
    if (existing?.phase === 'error' || existing?.phase === 'retrying') return;

    // Join inflight
    const inflight = this.inflightLoads.get(pluginId);
    if (inflight) return inflight;

    this.deps.log.debug(`Loading plugin "${pluginId}"`, { plugin: pluginId });

    const promise = this.doLoad(pluginId, opts ?? {});
    this.inflightLoads.set(pluginId, promise);

    try {
      await promise;
    } finally {
      this.inflightLoads.delete(pluginId);
    }
  }

  async reload(pluginId: string, opts?: PluginLoadOpts): Promise<void> {
    // Join inflight reload first (before phase check — the inflight may have changed phase)
    const inflight = this.inflightLoads.get(pluginId);
    if (inflight) return inflight;

    const current = this.state.get(pluginId);
    if (!current) {
      throw new Error(`Cannot reload plugin "${pluginId}" — plugin not found`);
    }
    if (current.phase !== 'ready') {
      throw new Error(`Cannot reload plugin "${pluginId}" — not in ready state (current: ${current.phase})`);
    }

    const promise = this.doReload(pluginId, current, opts);
    this.inflightLoads.set(pluginId, promise);

    try {
      await promise;
    } finally {
      this.inflightLoads.delete(pluginId);
    }
  }

  async unload(pluginId: string): Promise<void> {
    const current = this.state.get(pluginId);
    if (!current) return;
    if (current.phase === 'idle') return;

    this.deps.log.debug(`Unloading plugin "${pluginId}"`, { plugin: pluginId });

    // Cancel inflight loads
    this.inflightLoads.delete(pluginId);
    this.bumpLoadGeneration(pluginId);

    if (current.phase === 'ready') {
      this.transition(pluginId, 'unloading');
    }

    // Clear module cache
    if (current.phase === 'ready' || current.phase === 'loading' || current.phase === 'unloading') {
      await this.deps.clearPlugin({ pluginId, dev: current.isDev });
    }

    // Remove registrations
    this.removePluginRegistrations(pluginId);

    // Transition to idle, preserving backendPhase
    this.state.set(pluginId, createDefaultPluginState(pluginId, {
      backendPhase: current.backendPhase,
      isDev: current.isDev,
      devPort: current.devPort,
    }));

    this.bumpRouteVersion();
    this.notify();
  }

  async retry(pluginId: string, opts?: PluginLoadOpts): Promise<void> {
    const current = this.state.get(pluginId);
    if (!current || current.phase !== 'error') {
      throw new Error(`Cannot retry plugin "${pluginId}" — not in error state`);
    }

    if (current.retryCount >= this.config.maxRetries) {
      this.deps.log.warn(
        `Plugin "${pluginId}" exceeded max retries (${this.config.maxRetries})`,
        { plugin: pluginId, retryCount: current.retryCount },
      );
      return;
    }

    const delay = this.computeRetryDelay(current.retryCount);
    this.transition(pluginId, 'retrying');

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // After delay, check if still retrying (could have been force-reset)
    const afterDelay = this.state.get(pluginId);
    if (!afterDelay || afterDelay.phase !== 'retrying') return;

    const retryCount = current.retryCount + 1;

    this.transition(pluginId, 'loading', { retryCount });

    const generation = this.bumpLoadGeneration(pluginId);

    try {
      this.deps.ensureBuiltinExtensionPoints();

      if (opts?.dev || current.isDev) {
        await this.deps.ensureDevSharedDeps();
      }

      await this.deps.clearPlugin({ pluginId, dev: opts?.dev ?? current.isDev });

      const rawModule = await this.withImportTimeout(pluginId, this.deps.importPlugin({
        pluginId,
        dev: opts?.dev ?? current.isDev,
        devPort: opts?.devPort ?? current.devPort ?? undefined,
        moduleHash: opts?.moduleHash,
      }));

      if (!this.isCurrentGeneration(pluginId, generation)) return;

      const validated = this.deps.validateExports(rawModule);
      const normalizedContributions = normalizeContributions(pluginId, validated);
      const extensionPoints = this.extractExtensionPoints(validated);
      const registrationsObj = this.buildRegistrations(validated);

      // Register extension points
      this.registerExtensionPoints(pluginId, extensionPoints);

      // Apply contributions
      this.applyContributions(pluginId, normalizedContributions);

      // Store for replay
      this.normalizedContributionsByPlugin.set(pluginId, normalizedContributions);
      this.definedExtensionPointIdsByPlugin.set(pluginId, extensionPoints.map((ep) => ep.id));

      // Store registrations
      this.registrations.set(pluginId, registrationsObj);

      // Replay foreign contributions for newly available extension points
      this.replayContributionsForExtensionPoints(
        extensionPoints.map((ep) => ep.id),
        { excludePluginId: pluginId },
      );

      this.transition(pluginId, 'ready', {
        pluginWindow: validated.plugin,
        loadedAt: Date.now(),
        retryCount: 0,
        isDev: opts?.dev ?? current.isDev,
        devPort: opts?.devPort ?? current.devPort,
        error: null,
        validationErrors: [],
        moduleHash: opts?.moduleHash ?? null,
      });

      this.deps.log.debug(`Plugin "${pluginId}" ready after retry`, { plugin: pluginId, retryCount });

      // Emit deprecation warnings for legacy exports
      this.emitLegacyDeprecationWarnings(pluginId, validated);

      this.bumpRouteVersion();
    } catch (err) {
      if (!this.isCurrentGeneration(pluginId, generation)) return;
      this.handleLoadError(pluginId, err, retryCount);
    }
  }

  async forceReset(pluginId: string): Promise<void> {
    const current = this.state.get(pluginId);
    if (!current) return;

    this.deps.log.warn(`Force-resetting plugin "${pluginId}"`, { plugin: pluginId });

    // Cancel inflight
    this.inflightLoads.delete(pluginId);
    this.bumpLoadGeneration(pluginId);

    // Clear module cache
    await this.deps.clearPlugin({ pluginId, dev: current.isDev });

    // Remove registrations
    this.removePluginRegistrations(pluginId);

    // Reset to idle, preserving backendPhase
    this.state.set(pluginId, createDefaultPluginState(pluginId, {
      backendPhase: current.backendPhase,
      isDev: current.isDev,
      devPort: current.devPort,
    }));

    this.bumpRouteVersion();
    this.notify();
  }

  markReady(): void {
    this.ready = true;
    this.notify();
  }

  updateBackendPhase(pluginId: string, phase: BackendPluginPhase): void {
    const current = this.state.get(pluginId);
    if (current) {
      this.state.set(pluginId, { ...current, backendPhase: phase });
    } else {
      this.state.set(pluginId, createDefaultPluginState(pluginId, { backendPhase: phase }));
    }
    this.notify();
  }

  // ── Batch operations ────────────────────────────────────────────

  async loadAll(plugins: PluginDescriptor[]): Promise<void> {
    this.deps.ensureBuiltinExtensionPoints();

    // Filter out already-loaded
    const toLoad = plugins.filter((p) => {
      const existing = this.state.get(p.id);
      return !existing || existing.phase === 'idle';
    });

    if (toLoad.length === 0) return;

    // Pass 1: Import + validate + normalize in bounded parallel chunks
    const prepared: PreparedPluginLoad[] = [];
    const chunks: PluginDescriptor[][] = [];
    for (let i = 0; i < toLoad.length; i += this.config.maxConcurrentLoads) {
      chunks.push(toLoad.slice(i, i + this.config.maxConcurrentLoads));
    }

    for (const chunk of chunks) {
      const settled = await Promise.allSettled(
        chunk.map((p) => this.prepareLoadCandidate(p.id, p)),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          prepared.push(result.value);
        }
        // Rejected: prepareLoadCandidate already transitioned to error
      }
    }

    // Pass 2a: Register all plugin-defined extension points first
    for (const p of prepared) {
      this.registerExtensionPoints(p.pluginId, p.extensionPoints);
      this.definedExtensionPointIdsByPlugin.set(p.pluginId, p.extensionPoints.map((ep) => ep.id));
    }

    // Pass 2b: Apply all contributions/routes
    let readyCount = 0;
    let failedCount = 0;
    for (const p of prepared) {
      try {
        this.applyContributions(p.pluginId, p.normalizedContributions);
        this.normalizedContributionsByPlugin.set(p.pluginId, p.normalizedContributions);
        this.registrations.set(p.pluginId, p.registrations);

        this.transition(p.pluginId, 'ready', {
          pluginWindow: p.pluginWindow,
          loadedAt: Date.now(),
          retryCount: 0,
          isDev: p.isDev,
          devPort: p.devPort,
          error: null,
          validationErrors: [],
          moduleHash: p.moduleHash,
        });

        readyCount++;

        // Emit deprecation warnings for legacy exports
        this.emitLegacyDeprecationWarnings(p.pluginId, p.validated);
      } catch (err) {
        failedCount++;
        this.handleLoadError(p.pluginId, err, 0);
      }
    }

    // Count plugins that failed during prepare (not in prepared array)
    failedCount += toLoad.length - prepared.length;

    this.deps.log.debug(
      `loadAll complete: ${readyCount} ready, ${failedCount} failed (${toLoad.length} total)`,
      { readyCount, failedCount, total: toLoad.length },
    );

    this.bumpRouteVersion();
  }

  // ── Event Listeners ─────────────────────────────────────────────

  startEventListeners(): void {
    if (this.eventCleanups.length > 0) return; // idempotent

    this.eventCleanups.push(
      this.deps.onEvent('plugin/install_finished', (meta: { id?: string }) => {
        if (!meta?.id) return;
        const existing = this.state.get(meta.id);
        if (existing?.phase === 'ready') {
          void this.reload(meta.id);
        } else {
          void this.load(meta.id);
        }
      }),

      this.deps.onEvent('plugin/update_complete', (meta: { id?: string }) => {
        if (!meta?.id) return;
        const existing = this.state.get(meta.id);
        if (existing?.phase === 'ready') {
          void this.reload(meta.id);
        } else {
          void this.load(meta.id);
        }
      }),

      this.deps.onEvent('plugin/dev_reload_complete', (meta: { id?: string }) => {
        if (!meta?.id) return;
        const existing = this.state.get(meta.id);
        if (!existing?.isDev) {
          this.deps.log.warn(`Ignoring dev reload for non-dev or unknown plugin "${meta.id}"`, {
            plugin: meta.id,
          });
          return;
        }
        void this.reload(meta.id);
      }),

      this.deps.onEvent('plugin/state_change', (data: { pluginID?: string; phase?: string }) => {
        if (!data?.pluginID) return;
        if (!data.phase || !isBackendPluginPhase(data.phase)) {
          this.deps.log.warn(`Ignoring invalid backend phase for plugin "${data.pluginID}"`, {
            plugin: data.pluginID,
            phase: data.phase,
          });
          return;
        }
        this.updateBackendPhase(data.pluginID, data.phase);
      }),

      this.deps.onEvent('plugin/crash', (data: { pluginID?: string; error?: string }) => {
        if (!data?.pluginID) return;
        this.deps.log.warn(`Plugin "${data.pluginID}" crashed`, {
          plugin: data.pluginID,
          error: data.error,
        });
      }),

      this.deps.onEvent('plugin/recovered', (data: { pluginID?: string }) => {
        if (!data?.pluginID) return;
        this.deps.log.debug(`Plugin "${data.pluginID}" recovered`, {
          plugin: data.pluginID,
        });
      }),

      this.deps.onEvent('plugin/crash_recovery_failed', (data: { pluginID?: string; error?: string }) => {
        if (!data?.pluginID) return;
        const current = this.state.get(data.pluginID);
        if (current && (current.phase === 'ready' || current.phase === 'loading')) {
          // Bypass normal transition assertion: ready→error is a backend-initiated
          // emergency transition not covered by the frontend state machine.
          this.state.set(data.pluginID, {
            ...current,
            phase: 'error',
            error: data.error ?? 'Crash recovery failed',
          });
          this.notify();
        }
      }),
    );
  }

  stopEventListeners(): void {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];
  }

  // ── Subscriptions ───────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.stopEventListeners();
    this.state.clear();
    this.registrations.clear();
    this.inflightLoads.clear();
    this.normalizedContributionsByPlugin.clear();
    this.definedExtensionPointIdsByPlugin.clear();
    this.loadGeneration.clear();
    this.legacyWarningEmitted.clear();
    this.cachedSnapshot = null;
    this.cachedRoutes = null;
    this.ready = false;
    this.routeVersion = 0;
    this.notify();
  }

  // ── Private: Core Load Logic ────────────────────────────────────

  private async doLoad(pluginId: string, opts: PluginLoadOpts): Promise<void> {
    // Ensure or create initial state
    const current = this.state.get(pluginId);
    if (!current) {
      this.state.set(pluginId, createDefaultPluginState(pluginId, {
        isDev: opts.dev ?? false,
        devPort: opts.devPort ?? null,
      }));
    }

    this.transition(pluginId, 'loading');

    const generation = this.bumpLoadGeneration(pluginId);

    try {
      this.deps.ensureBuiltinExtensionPoints();

      if (opts.dev) {
        await this.deps.ensureDevSharedDeps();
      }

      const rawModule = await this.withImportTimeout(pluginId, this.deps.importPlugin({
        pluginId,
        dev: opts.dev,
        devPort: opts.devPort,
        moduleHash: opts.moduleHash,
      }));

      // Stale check
      if (!this.isCurrentGeneration(pluginId, generation)) return;

      const validated = this.deps.validateExports(rawModule);
      const normalizedContributions = normalizeContributions(pluginId, validated);
      const extensionPoints = this.extractExtensionPoints(validated);
      const registrationsObj = this.buildRegistrations(validated);

      // Register own extension points first
      this.registerExtensionPoints(pluginId, extensionPoints);

      // Apply contributions
      this.applyContributions(pluginId, normalizedContributions);

      // Store for replay
      this.normalizedContributionsByPlugin.set(pluginId, normalizedContributions);
      this.definedExtensionPointIdsByPlugin.set(pluginId, extensionPoints.map((ep) => ep.id));

      // Store registrations
      this.registrations.set(pluginId, registrationsObj);

      // Replay foreign contributions for newly available extension points
      this.replayContributionsForExtensionPoints(
        extensionPoints.map((ep) => ep.id),
        { excludePluginId: pluginId },
      );

      this.transition(pluginId, 'ready', {
        pluginWindow: validated.plugin,
        loadedAt: Date.now(),
        retryCount: 0,
        isDev: opts.dev ?? false,
        devPort: opts.devPort ?? null,
        error: null,
        validationErrors: [],
        moduleHash: opts.moduleHash ?? null,
      });

      this.deps.log.debug(`Plugin "${pluginId}" ready`, { plugin: pluginId });

      // Emit deprecation warnings for legacy exports
      this.emitLegacyDeprecationWarnings(pluginId, validated);

      this.bumpRouteVersion();
    } catch (err) {
      if (!this.isCurrentGeneration(pluginId, generation)) return;
      this.handleLoadError(pluginId, err, 0);
    }
  }

  private async doReload(
    pluginId: string,
    current: PluginState,
    opts?: PluginLoadOpts,
  ): Promise<void> {
    // Transition to loading but KEEP old pluginWindow
    this.transition(pluginId, 'loading', {
      pluginWindow: current.pluginWindow,
    });

    const generation = this.bumpLoadGeneration(pluginId);

    try {
      this.deps.ensureBuiltinExtensionPoints();

      const isDev = opts?.dev ?? current.isDev;
      if (isDev) {
        await this.deps.ensureDevSharedDeps();
      }

      await this.deps.clearPlugin({ pluginId, dev: isDev });

      const rawModule = await this.withImportTimeout(pluginId, this.deps.importPlugin({
        pluginId,
        dev: isDev,
        devPort: opts?.devPort ?? current.devPort ?? undefined,
        moduleHash: opts?.moduleHash,
      }));

      if (!this.isCurrentGeneration(pluginId, generation)) return;

      const validated = this.deps.validateExports(rawModule);
      const normalizedContributions = normalizeContributions(pluginId, validated);
      const extensionPoints = this.extractExtensionPoints(validated);
      const registrationsObj = this.buildRegistrations(validated);

      // Remove old registrations before applying new ones
      this.deps.removeContributions(pluginId);
      this.deps.removeExtensionPoints(pluginId);

      // Register new extension points
      this.registerExtensionPoints(pluginId, extensionPoints);

      // Apply new contributions
      this.applyContributions(pluginId, normalizedContributions);

      // Store for replay
      this.normalizedContributionsByPlugin.set(pluginId, normalizedContributions);
      this.definedExtensionPointIdsByPlugin.set(pluginId, extensionPoints.map((ep) => ep.id));

      // Store registrations
      this.registrations.set(pluginId, registrationsObj);

      // Replay foreign contributions for extension points this plugin owns
      this.replayContributionsForExtensionPoints(
        extensionPoints.map((ep) => ep.id),
        { excludePluginId: pluginId },
      );

      // Atomic swap
      this.transition(pluginId, 'ready', {
        pluginWindow: validated.plugin,
        loadedAt: Date.now(),
        retryCount: 0,
        isDev,
        devPort: opts?.devPort ?? current.devPort,
        error: null,
        validationErrors: [],
        moduleHash: opts?.moduleHash ?? null,
      });

      this.deps.log.debug(`Plugin "${pluginId}" reloaded successfully`, { plugin: pluginId });

      // Emit deprecation warnings for legacy exports
      this.emitLegacyDeprecationWarnings(pluginId, validated);

      this.bumpRouteVersion();
    } catch (err) {
      if (!this.isCurrentGeneration(pluginId, generation)) return;

      const message = err instanceof Error ? err.message : String(err);
      const validationErrors = err instanceof PluginValidationError ? err.errors : [];

      // On reload failure, preserve old pluginWindow
      this.transition(pluginId, 'error', {
        error: message,
        validationErrors,
        pluginWindow: current.pluginWindow,
      });
      this.notify();
    }
  }

  // ── Private: Load helpers ───────────────────────────────────────

  private async prepareLoadCandidate(
    pluginId: string,
    opts: PluginLoadOpts | PluginDescriptor,
  ): Promise<PreparedPluginLoad> {
    const isDev = 'dev' in opts ? (opts.dev ?? false) : false;
    const devPort = 'devPort' in opts ? (opts.devPort ?? null) : null;
    const moduleHash = 'moduleHash' in opts ? (opts.moduleHash ?? null) : null;

    // Ensure initial state
    if (!this.state.has(pluginId)) {
      this.state.set(pluginId, createDefaultPluginState(pluginId, {
        isDev,
        devPort,
      }));
    }

    this.transition(pluginId, 'loading');

    try {
      if (isDev) {
        await this.deps.ensureDevSharedDeps();
      }

      const rawModule = await this.withImportTimeout(pluginId, this.deps.importPlugin({
        pluginId,
        dev: isDev,
        devPort: devPort ?? undefined,
        moduleHash: moduleHash ?? undefined,
      }));

      const validated = this.deps.validateExports(rawModule);
      const normalizedContributions = normalizeContributions(pluginId, validated);
      const extensionPoints = this.extractExtensionPoints(validated);
      const registrationsObj = this.buildRegistrations(validated);

      return {
        pluginId,
        validated,
        registrations: registrationsObj,
        normalizedContributions,
        extensionPoints,
        pluginWindow: validated.plugin,
        isDev,
        devPort,
        moduleHash,
      };
    } catch (err) {
      this.handleLoadError(pluginId, err, 0);
      throw err; // re-throw so Promise.allSettled captures it
    }
  }

  private registerExtensionPoints(
    pluginId: string,
    extensionPoints: ExtensionPointSettings[],
  ): void {
    for (const ep of extensionPoints) {
      this.deps.addExtensionPoint({ ...ep, pluginId });
    }
  }

  private applyContributions(
    pluginId: string,
    contributions: NormalizedContribution[],
  ): void {
    for (const c of contributions) {
      this.deps.registerContribution(c.extensionPointId, {
        id: c.contributionId,
        plugin: pluginId,
        label: c.label,
        value: c.value,
        meta: c.meta,
      });
    }
  }

  private replayContributionsForExtensionPoints(
    extensionPointIds: string[],
    opts?: { excludePluginId?: string },
  ): void {
    if (extensionPointIds.length === 0) return;

    const epIdSet = new Set(extensionPointIds);

    for (const [pid, contributions] of this.normalizedContributionsByPlugin) {
      if (opts?.excludePluginId && pid === opts.excludePluginId) continue;

      // Only replay for plugins that are in ready state
      const pluginState = this.state.get(pid);
      if (!pluginState || pluginState.phase !== 'ready') continue;

      for (const c of contributions) {
        if (epIdSet.has(c.extensionPointId)) {
          try {
            this.deps.registerContribution(c.extensionPointId, {
              id: c.contributionId,
              plugin: pid,
              label: c.label,
              value: c.value,
              meta: c.meta,
            });
          } catch (e) {
            // Extension point may have been removed again — log for debugging
            console.debug(
              `[PluginService] replay: failed to register contribution "${c.contributionId}" → EP "${c.extensionPointId}" (plugin "${pid}")`,
              e,
            );
          }
        }
      }
    }
  }

  private removePluginRegistrations(pluginId: string): void {
    this.deps.removeExtensionPoints(pluginId);
    this.deps.removeContributions(pluginId);
    this.registrations.delete(pluginId);
    this.normalizedContributionsByPlugin.delete(pluginId);
    this.definedExtensionPointIdsByPlugin.delete(pluginId);
  }

  private buildRegistrations(validated: ValidatedExports): PluginRegistrations {
    const pw = validated.plugin;
    let routes: RouteObject[] = [];
    try {
      if (pw && typeof pw === 'object' && '_routes' in pw) {
        routes = (pw as any)._routes ?? [];
      } else if (pw && typeof pw === 'object' && 'Routes' in pw) {
        routes = (pw as any).Routes ?? [];
      }
    } catch {
      // PluginWindow.Routes getter may throw if no routes set
      routes = [];
    }
    return { routes: Array.isArray(routes) ? routes : [] };
  }

  private extractExtensionPoints(validated: ValidatedExports): ExtensionPointSettings[] {
    const pw = validated.plugin;
    if (!pw || typeof pw !== 'object') return [];

    const extensions = (pw as any)._extensions ?? (pw as any).extensions ?? [];
    if (!Array.isArray(extensions)) return [];

    return extensions.filter(
      (ep: unknown): ep is ExtensionPointSettings =>
        ep != null && typeof ep === 'object' && typeof (ep as any).id === 'string',
    );
  }

  // ── Private: Timeout ────────────────────────────────────────────

  private async withImportTimeout<T>(
    pluginId: string,
    promise: Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new PluginTimeoutError(
            `Plugin "${pluginId}" import timed out after ${this.config.importTimeoutMs}ms`,
            { pluginId, timeoutMs: this.config.importTimeoutMs },
          ));
        }
      }, this.config.importTimeoutMs);

      promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        },
      );
    });
  }

  // ── Private: State transitions ──────────────────────────────────

  private transition(
    pluginId: string,
    nextPhase: PluginPhase,
    patch?: Partial<PluginState>,
  ): void {
    const current = this.state.get(pluginId);
    const fromPhase = current?.phase ?? 'idle';

    if (!current) {
      // Create the state if it doesn't exist
      this.state.set(pluginId, createDefaultPluginState(pluginId, {
        phase: nextPhase,
        ...patch,
      }));
      this.invalidateSnapshot();
      return;
    }

    assertValidTransition(fromPhase, nextPhase);

    this.state.set(pluginId, {
      ...current,
      phase: nextPhase,
      ...patch,
    });

    this.invalidateSnapshot();
  }

  private notify(): void {
    this.invalidateSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private invalidateSnapshot(): void {
    this.cachedSnapshot = null;
  }

  private invalidateRouteCache(): void {
    this.cachedRoutes = null;
  }

  private bumpRouteVersion(): void {
    this.routeVersion++;
    this.invalidateRouteCache();
    this.notify();
  }

  // ── Private: Load generation (stale detection) ──────────────────

  private bumpLoadGeneration(pluginId: string): number {
    const gen = (this.loadGeneration.get(pluginId) ?? 0) + 1;
    this.loadGeneration.set(pluginId, gen);
    return gen;
  }

  private isCurrentGeneration(pluginId: string, generation: number): boolean {
    return this.loadGeneration.get(pluginId) === generation;
  }

  // ── Private: Error handling ─────────────────────────────────────

  private handleLoadError(pluginId: string, err: unknown, retryCount: number): void {
    const message = err instanceof Error ? err.message : String(err);
    const validationErrors = err instanceof PluginValidationError ? err.errors : [];

    this.deps.log.error(`Plugin "${pluginId}" failed to load: ${message}`, {
      plugin: pluginId,
      error: message,
    });

    // Transition to error, preserving existing state fields
    const current = this.state.get(pluginId);
    this.state.set(pluginId, {
      ...(current ?? createDefaultPluginState(pluginId)),
      phase: 'error' as PluginPhase,
      error: message,
      validationErrors,
      retryCount,
      pluginWindow: null,
    });

    this.notify();
  }

  // ── Private: Retry delay computation ────────────────────────────

  private computeRetryDelay(retryCount: number): number {
    return Math.min(
      this.config.retryBaseDelayMs * Math.pow(2, retryCount),
      this.config.retryMaxDelayMs,
    );
  }

  // ── Private: Deprecation warnings ──────────────────────────────

  /** Track which plugins have already had their deprecation warning emitted. */
  private legacyWarningEmitted = new Set<string>();

  /**
   * Emit one-time deprecation warnings when a plugin uses legacy
   * `sidebars` or `drawers` exports instead of `extensionRegistrations`.
   */
  private emitLegacyDeprecationWarnings(
    pluginId: string,
    validated: ValidatedExports,
  ): void {
    if (this.legacyWarningEmitted.has(pluginId)) return;

    const hasSidebars = Object.keys(validated.sidebars).length > 0;
    const hasDrawers = Object.keys(validated.drawers).length > 0;

    if (hasSidebars || hasDrawers) {
      const surfaces: string[] = [];
      if (hasSidebars) surfaces.push('sidebars');
      if (hasDrawers) surfaces.push('drawers');

      this.deps.log.warn(
        `Plugin "${pluginId}" uses deprecated legacy ${surfaces.join(' and ')} exports. ` +
        `Migrate to extensionRegistrations for forward compatibility.`,
        {
          plugin: pluginId,
          deprecatedExports: surfaces,
          sidebarKeys: hasSidebars ? Object.keys(validated.sidebars) : undefined,
          drawerKeys: hasDrawers ? Object.keys(validated.drawers) : undefined,
        },
      );

      this.legacyWarningEmitted.add(pluginId);
    }
  }

  // ── Private: Debug helpers ──────────────────────────────────────

  private getContributedExtensionPointIds(pluginId: string): string[] {
    const contributions = this.normalizedContributionsByPlugin.get(pluginId);
    if (!contributions) return [];
    return [...new Set(contributions.map((c) => c.extensionPointId))];
  }

  private getContributionDebugRecords(pluginId: string): PluginDebugContributionRecord[] {
    const contributions = this.normalizedContributionsByPlugin.get(pluginId);
    if (!contributions) return [];
    return contributions.map((c) => ({
      id: c.contributionId,
      extensionPointId: c.extensionPointId,
      source: c.source,
      resourceKey: (c.meta as { resourceKey?: string })?.resourceKey,
    }));
  }

  private getDefinedExtensionPointIds(pluginId: string): string[] {
    return this.definedExtensionPointIdsByPlugin.get(pluginId) ?? [];
  }
}
