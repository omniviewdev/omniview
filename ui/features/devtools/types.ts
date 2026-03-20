/**
 * Types for the plugin dev tools system.
 * Core types (DevServerState, DevBuildLine) are re-exported from the
 * Wails-generated bindings so there is a single source of truth.
 */
import type { DevServerState as DevServerStateModel, DevServerLogEntry } from '@omniviewdev/runtime/models';

/** Dev server state, re-exported from the Wails binding models. */
export type DevServerState = DevServerStateModel;

/** A single line of build output, re-exported from the Wails binding models. */
export type DevBuildLine = DevServerLogEntry;

/** A structured build error from the Go compiler output. */
export interface DevBuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

/** Summary of all dev server instances, used by the footer indicators. */
export interface DevServerSummary {
  total: number;
  ready: number;
  building: number;
  error: number;
  stopped: number;
}

/** Aggregate status for display purposes. */
export type DevServerAggregateStatus = 'ready' | 'building' | 'error' | 'stopped' | 'connecting';

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
