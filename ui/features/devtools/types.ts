/**
 * Types for the plugin dev tools system.
 * These mirror the Go-side DevServerState and related structs.
 */

/** The mode a dev server instance is running in. */
export type DevServerMode = 'managed' | 'external' | 'idle';

/** Status of either the Vite dev server or Go watcher process. Mirrors Go DevProcessStatus. */
export type DevProcessStatus = 'idle' | 'starting' | 'building' | 'running' | 'ready' | 'error' | 'stopped';

/** Status of the Vite dev server. */
export type ViteStatus = DevProcessStatus;

/** Status of the Go backend. */
export type GoStatus = DevProcessStatus;

/** Aggregate status for display purposes. */
export type DevServerAggregateStatus = 'ready' | 'building' | 'error' | 'stopped' | 'connecting';

/**
 * Full dev server state for a single plugin.
 * Matches the JSON emitted by the Go DevServerManager via Wails events.
 */
export interface DevServerState {
  pluginID: string;
  mode: DevServerMode;
  viteStatus: ViteStatus;
  vitePort: number;
  viteURL: string;
  goStatus: GoStatus;
  grpcConnected: boolean;
  lastBuildDuration?: number;
  lastBuildTime?: string;
  lastError?: string;
  devPath?: string;
}

/** A structured build error from the Go compiler output. */
export interface DevBuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

/** A single line of build output (from Vite or Go compiler). */
export interface DevBuildLine {
  pluginID: string;
  source: 'vite' | 'go-build' | 'go-watch' | 'manager';
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

/** Summary of all dev server instances, used by the footer indicators. */
export interface DevServerSummary {
  total: number;
  ready: number;
  building: number;
  error: number;
  stopped: number;
}

/** Derive the aggregate status from a DevServerState. */
export function getAggregateStatus(state: DevServerState): DevServerAggregateStatus {
  if (state.goStatus === 'error' || state.viteStatus === 'error') return 'error';
  if (state.goStatus === 'building' || state.viteStatus === 'starting') return 'building';
  if (state.viteStatus === 'stopped' && !state.grpcConnected) return 'stopped';
  if (!state.grpcConnected) return 'connecting';
  return 'ready';
}

/** Color mapping for aggregate status values. */
export const STATUS_COLORS: Record<
  DevServerAggregateStatus,
  'success' | 'warning' | 'danger' | 'neutral' | 'primary'
> = {
  ready: 'success',
  building: 'warning',
  error: 'danger',
  stopped: 'neutral',
  connecting: 'primary',
};
