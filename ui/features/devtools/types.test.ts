import { describe, expect, it } from 'vitest';
import { DevProcessStatus, DevServerMode, DevServerState, LifecycleStage } from '@omniviewdev/runtime/models';
import { getAggregateStatus } from './types';

describe('managed lifecycle aggregate status', () => {
  it('does not turn successful compilation or a connection alone into ready', () => {
    const state = new DevServerState({
      mode: DevServerMode.DevServerModeManaged,
      goStatus: DevProcessStatus.DevProcessStatusReady,
      viteStatus: DevProcessStatus.DevProcessStatusStarting,
      buildStatus: LifecycleStage.StageReady,
      rpcStatus: LifecycleStage.StageReady,
      controllerStatus: LifecycleStage.StagePending,
      grpcConnected: true,
      ready: false,
    });
    expect(getAggregateStatus(state)).toBe('building');
    state.viteStatus = DevProcessStatus.DevProcessStatusReady;
    expect(getAggregateStatus(state)).toBe('connecting');
  });

  it('accepts capability-aware UI-only readiness without fake gRPC', () => {
    const state = new DevServerState({
      mode: DevServerMode.DevServerModeManaged,
      viteStatus: DevProcessStatus.DevProcessStatusReady,
      rpcStatus: LifecycleStage.StageNotApplicable,
      controllerStatus: LifecycleStage.StageNotApplicable,
      grpcConnected: false,
      ready: true,
    });
    expect(getAggregateStatus(state)).toBe('ready');
    state.viteStatus = DevProcessStatus.DevProcessStatusError;
    state.ready = false;
    expect(getAggregateStatus(state)).toBe('error');
  });
});
