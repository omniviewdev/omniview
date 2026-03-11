import type { RouteObject } from 'react-router-dom';
import type {
  ExtensionPointSettings,
  ExtensionRegistration,
  ExtensionRenderContext,
  ExtensionContributionRegistration,
} from '@omniviewdev/runtime';

// ─── Re-export runtime types needed by host code ─────────────────────

export type {
  ExtensionPointSettings,
  ExtensionRegistration,
  ExtensionRenderContext,
  ExtensionContributionRegistration,
};

// ─── Plugin Phases ───────────────────────────────────────────────────

export type PluginPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'retrying'
  | 'unloading';

export type BackendPluginPhase =
  | 'Uninstalled'
  | 'Installing'
  | 'Installed'
  | 'Building'
  | 'BuildFailed'
  | 'Validating'
  | 'Starting'
  | 'Running'
  | 'Degraded'
  | 'Recovering'
  | 'Stopping'
  | 'Stopped'
  | 'Failed'
  | 'Uninstalling';

// ─── Value Types ─────────────────────────────────────────────────────

/**
 * A sidebar component receives a DrawerContext.
 * Typed as React.FC<any> here to avoid coupling to the DrawerContext type
 * at the service contract level — actual typing is enforced at the extension point.
 */
export type SidebarComponent = React.FC<any>;

/**
 * A drawer factory function that the host calls with a close callback
 * to get the drawer component and views.
 */
export type DrawerFactory = (...args: any[]) => any;

/**
 * Union type for values that can be contributed to extension points.
 */
export type ExtensionPointValue = React.ComponentType<any> | DrawerFactory | unknown;

// ─── Plugin Window ───────────────────────────────────────────────────

/**
 * PluginWindow is the runtime's PluginWindow class, re-exported for convenience.
 * Import it from @omniviewdev/runtime directly when constructing.
 */
export type { PluginWindow } from '@omniviewdev/runtime';

// ─── Plugin State ────────────────────────────────────────────────────

export interface PluginState {
  readonly id: string;
  readonly phase: PluginPhase;
  readonly backendPhase: BackendPluginPhase | null;
  readonly error: string | null;
  readonly retryCount: number;
  readonly loadedAt: number | null;
  readonly isDev: boolean;
  readonly devPort: number | null;
  readonly pluginWindow: any | null; // PluginWindow at runtime
  readonly validationErrors: string[];
  readonly moduleHash: string | null;
}

// ─── Validated Exports ───────────────────────────────────────────────

export interface ValidatedExports {
  readonly plugin: any; // PluginWindow at runtime
  readonly extensionRegistrations: ExtensionRegistration<any>[];
  readonly sidebars: Record<string, SidebarComponent>;
  readonly drawers: Record<string, DrawerFactory>;
}

// ─── Plugin Registrations ────────────────────────────────────────────

export interface PluginRegistrations {
  readonly routes: RouteObject[];
}

// ─── Normalized Contribution ─────────────────────────────────────────

export interface NormalizedContribution<TValue = ExtensionPointValue> {
  readonly source: 'extension-registration' | 'legacy-sidebar' | 'legacy-drawer';
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly contributionId: string;
  readonly value: TValue;
  readonly label: string;
  readonly meta?: unknown;
}

// ─── Resource Extension Render Context ───────────────────────────────

export type ResourceExtensionRenderContext = ExtensionRenderContext & {
  readonly pluginId: string;
  readonly resourceKey: string;
};

// ─── Prepared Plugin Load ────────────────────────────────────────────

export interface PreparedPluginLoad {
  readonly pluginId: string;
  readonly validated: ValidatedExports;
  readonly registrations: PluginRegistrations;
  readonly normalizedContributions: NormalizedContribution[];
  readonly extensionPoints: ExtensionPointSettings[];
  readonly pluginWindow: any; // PluginWindow at runtime
  readonly isDev: boolean;
  readonly devPort: number | null;
  readonly moduleHash: string | null;
}

// ─── Plugin Service Snapshot ─────────────────────────────────────────

export interface PluginServiceSnapshot {
  readonly plugins: ReadonlyMap<string, PluginState>;
  readonly registrations: ReadonlyMap<string, PluginRegistrations>;
  readonly ready: boolean;
  readonly routeVersion: number;
}

// ─── Debug Snapshots ─────────────────────────────────────────────────

export interface PluginDebugContributionRecord {
  readonly id: string;
  readonly extensionPointId: string;
  readonly source: NormalizedContribution['source'];
  readonly resourceKey?: string;
}

export interface PluginServiceDebugPluginState extends PluginState {
  readonly inflightLoad: boolean;
  readonly contributedExtensionPoints: string[];
  readonly contributions: PluginDebugContributionRecord[];
  readonly definedExtensionPoints: string[];
}

export interface PluginServiceDebugSnapshot {
  readonly plugins: Record<string, PluginServiceDebugPluginState>;
  readonly config: PluginServiceConfig;
  readonly ready: boolean;
  readonly routeVersion: number;
  readonly eventListenersActive: boolean;
}

// ─── Plugin Import/Load Options ──────────────────────────────────────

export interface PluginImportOpts {
  readonly pluginId: string;
  readonly moduleHash?: string;
  readonly dev?: boolean;
  readonly devPort?: number;
}

export interface PluginLoadOpts {
  readonly dev?: boolean;
  readonly devPort?: number;
  readonly moduleHash?: string;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly dev: boolean;
  readonly devPort?: number;
  readonly moduleHash?: string;
}

// ─── Plugin Service Config ───────────────────────────────────────────

export interface PluginServiceConfig {
  readonly importTimeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxConcurrentLoads: number;
}

export const DEFAULT_CONFIG: Readonly<PluginServiceConfig> = {
  importTimeoutMs: 30_000,
  maxRetries: 5,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  maxConcurrentLoads: 5,
};

// ─── Plugin Service Dependencies ─────────────────────────────────────

export interface PluginServiceDeps {
  importPlugin(opts: PluginImportOpts): Promise<unknown>;
  clearPlugin(opts: { pluginId: string; dev?: boolean }): Promise<void>;
  onEvent(eventName: string, handler: (...args: any[]) => void): () => void;
  ensureBuiltinExtensionPoints(): void;

  addExtensionPoint(
    extension: ExtensionPointSettings & { pluginId: string },
  ): void;
  removeExtensionPoints(pluginId: string): void;

  registerContribution(
    extensionPointId: string,
    contribution: {
      id: string;
      plugin: string;
      label: string;
      value: unknown;
      meta?: unknown;
    },
  ): void;

  removeContributions(pluginId: string): void;
  ensureDevSharedDeps(): Promise<void>;
  validateExports(exports: unknown): ValidatedExports;

  log: {
    debug(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };
}
