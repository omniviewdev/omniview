/**
 * Types for the plugin dev tools system.
 * Core types (DevServerState, DevBuildLine) are re-exported from the
 * Wails-generated bindings so there is a single source of truth.
 */
import type { DevServerState as DevServerStateModel, DevServerLogEntry } from '@omniviewdev/runtime/models';
import { DevProcessStatus, DevServerMode, LifecycleStage } from '@omniviewdev/runtime/models';

/** Dev server state, re-exported from the Wails binding models. */
export type DevServerState = DevServerStateModel;

/** A single line of build output, re-exported from the Wails binding models. */
export type DevBuildLine = DevServerLogEntry;

/** A structured build error from the Go compiler output. */
export type DevBuildError = {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
};

/** Summary of all dev server instances, used by the footer indicators. */
export type DevServerSummary = {
  total: number;
  ready: number;
  building: number;
  error: number;
  stopped: number;
};

/** Aggregate status for display purposes. */
export type DevServerAggregateStatus = 'ready' | 'building' | 'error' | 'stopped' | 'connecting';

/** Derive the aggregate status from a DevServerState. */
export function getAggregateStatus(state: DevServerState): DevServerAggregateStatus {
  if (state.lastError || state.buildStatus === LifecycleStage.StageError || state.rpcStatus === LifecycleStage.StageError || state.controllerStatus === LifecycleStage.StageError || state.viteStatus === DevProcessStatus.DevProcessStatusError) {
    return 'error';
  }

  if (state.ready) {
    return 'ready';
  }

  if (state.goStatus === DevProcessStatus.DevProcessStatusBuilding || state.viteStatus === DevProcessStatus.DevProcessStatusStarting) {
    return 'building';
  }

  if (state.mode === DevServerMode.DevServerModeIdle || state.goStatus === DevProcessStatus.DevProcessStatusStopped) {
    return 'stopped';
  }

  return 'connecting';
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
