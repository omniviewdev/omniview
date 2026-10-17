import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevProcessStatus, DevServerState } from '@omniviewdev/runtime/models';
import { devToolsChannel } from './events';
import { useDevServers } from './useDevServers';
import { createDeferred } from '../plugins/testing/helpers';

const backend = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({
  DevServerManager: { ListDevServerStates: backend.list },
}));

function state(viteStatus: DevProcessStatus) {
  return new DevServerState({ pluginID: 'kubernetes', vitePort: 15173, viteStatus });
}

describe('dev server startup reconciliation', () => {
  beforeEach(() => backend.list.mockReset());

  it('keeps a ready event received while an older snapshot is in flight', async () => {
    const snapshot = createDeferred<DevServerState[]>();
    backend.list.mockReturnValue(snapshot.promise);
    const { result } = renderHook(() => useDevServers());

    act(() => {
      devToolsChannel.emit('onStatusChange', state(DevProcessStatus.DevProcessStatusReady)); 
    });
    await act(async () => {
      snapshot.resolve([state(DevProcessStatus.DevProcessStatusStarting)]); 
    });

    expect(result.current.servers.get('kubernetes')?.viteStatus).toBe('ready');
  });

  it('subscribes before requesting the initial snapshot', async () => {
    backend.list.mockImplementation(async () => {
      devToolsChannel.emit('onStatusChange', state(DevProcessStatus.DevProcessStatusReady));
      return [];
    });
    const { result } = renderHook(() => useDevServers());

    await waitFor(() => {
      expect(result.current.servers.get('kubernetes')?.viteStatus).toBe('ready'); 
    });
  });
});
