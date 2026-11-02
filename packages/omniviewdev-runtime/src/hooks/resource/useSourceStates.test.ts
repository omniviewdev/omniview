import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSourceStates, HostSourceStatus } from '../../resource/v2/host';
import { useSourceStates } from './useSourceStates';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  listeners: new Map<string, (event: { data: unknown }) => void>(),
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id: string) => id }));
vi.mock('../../resource/v2/client', () => ({ GetSourceStates: native.get }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (topic: string, callback: (event: { data: unknown }) => void) => {
  native.listeners.set(topic, callback);
  return () => native.listeners.delete(topic);
} } }));

const status = (state: HostSourceStatus['state']): HostSourceStatus => ({
  state, mode: 'snapshot', count: { kind: 'exact', value: '0' },
});
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return React.createElement(QueryClientProvider, { client }, children);
};

beforeEach(() => { native.get.mockReset(); native.listeners.clear(); });

describe('useSourceStates', () => {
  it('buffers events until the initial snapshot and computes terminal progress', async () => {
    const pending = Promise.withResolvers<HostSourceStates>();
    native.get.mockReturnValue(pending.promise);
    const hook = renderHook(() => useSourceStates({ pluginID: 'p', route: { connection: 'c' } }), { wrapper });
    act(() => native.listeners.get('p/c/source/STATE')?.({ data: {
      pluginID: 'p', route: { connection: 'c' }, type: 'pods', status: status('following'),
    } }));
    await act(async () => pending.resolve({ route: { connection: 'c' }, types: { pods: status('opening'), jobs: status('failed') } }));
    await waitFor(() => expect(hook.result.current.getTypeStatus('pods')?.state).toBe('following'));
    expect(hook.result.current.isFullySynced).toBe(true);
    expect(hook.result.current.syncProgress).toBe(1);
    expect(hook.result.current.errorCount).toBe(1);
    act(() => native.listeners.get('p/c/source/STATE')?.({ data: {
      pluginID: 'p', route: { connection: 'c' }, type: 'jobs', status: status('resetRequired'),
    } }));
    await waitFor(() => expect(hook.result.current.syncProgress).toBe(0.5));
    expect(hook.result.current.errorCount).toBe(0);
    hook.unmount();
    expect(native.listeners.size).toBe(0);
  });

  it('does not fetch or subscribe when disabled', () => {
    const hook = renderHook(() => useSourceStates({ pluginID: 'p', route: { connection: 'c' }, enabled: false }), { wrapper });
    expect(native.get).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
    expect(hook.result.current.summary).toBeUndefined();
    hook.unmount();
  });
});
