import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionMetadataEnvelope } from '../connection/metadata';

const transport = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn(), listener: undefined as undefined | ((event: { data: unknown }) => void), subscriptions: 0 }));
vi.mock('../resource/v2/client', () => ({ GetConnectionMetadata: transport.get, RefreshConnectionMetadata: transport.refresh }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (_name: string, listener: typeof transport.listener) => {
  transport.listener = listener;
  transport.subscriptions++;
  return () => { transport.listener = undefined; };
} } }));
import { useConnectionMetadata as rootHook } from '../hooks/connection/useConnectionMetadata';
import { useConnectionMetadata } from './useConnectionMetadata';

function envelope(revision = '1', connectionID = 'cluster'): ConnectionMetadataEnvelope {
  return { pluginID: 'plugin', registrationID: 'one', supported: true, transportAvailable: true, snapshot: {
    connectionID, generation: 'generation', revision, active: true, refreshing: false,
    entries: { version: { state: 'current', value: revision, observedAt: '2026-10-31T00:00:00Z' } },
  } };
}

beforeEach(() => {
  transport.get.mockReset().mockResolvedValue(envelope());
  transport.refresh.mockReset().mockResolvedValue(envelope('2'));
  transport.subscriptions = 0;
});
afterEach(cleanup);

// The curated entry's call is an options object, as its neighbours' are. The root hook (positional) is a shipped API and stays; this wraps it.
describe('the curated useConnectionMetadata (options form)', () => {
  it('reads nothing and never subscribes while enabled is false, and reads once it is true', async () => {
    const hook = renderHook(({ enabled }) => useConnectionMetadata({ pluginID: 'plugin', connectionID: 'cluster', enabled }), { initialProps: { enabled: false } });
    expect(hook.result.current.supported).toBeUndefined();
    expect(hook.result.current.snapshot).toBeUndefined();
    await act(async () => hook.result.current.refresh());
    expect(transport.get).not.toHaveBeenCalled();
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(transport.subscriptions).toBe(0);

    hook.rerender({ enabled: true });
    await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe('1'));
    expect(transport.get).toHaveBeenCalledWith('plugin', 'cluster');
    expect(transport.subscriptions).toBe(1);

    const retiredRefresh = hook.result.current.refresh;
    hook.rerender({ enabled: false });
    expect(hook.result.current.snapshot).toBeUndefined();
    await act(async () => retiredRefresh());
    expect(transport.refresh).not.toHaveBeenCalled();
  });

  it('is on when enabled is not given', async () => {
    const hook = renderHook(() => useConnectionMetadata({ pluginID: 'plugin', connectionID: 'cluster' }));
    await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe('1'));
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.subscriptions).toBe(1);
  });

  it('is off while connectionID is undefined, and reads when it is given', async () => {
    const initialProps: { connectionID: string | undefined } = { connectionID: undefined };
    const hook = renderHook(({ connectionID }: { connectionID: string | undefined }) => useConnectionMetadata({ pluginID: 'plugin', connectionID }), { initialProps });
    expect(hook.result.current.supported).toBeUndefined();
    await act(async () => hook.result.current.refresh());
    expect(transport.get).not.toHaveBeenCalled();
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(transport.subscriptions).toBe(0);
    hook.rerender({ connectionID: 'cluster' });
    await waitFor(() => expect(hook.result.current.snapshot?.connectionID).toBe('cluster'));
    expect(transport.get).toHaveBeenCalledWith('plugin', 'cluster');
  });

  it('reads for the explicit pluginID and keeps another plugin\'s connection of the same id apart', async () => {
    transport.get.mockImplementation((pluginID: string, connectionID: string) => Promise.resolve({ ...envelope(pluginID === 'other' ? '7' : '1', connectionID), pluginID }));
    const hook = renderHook(({ pluginID }) => useConnectionMetadata({ pluginID, connectionID: 'cluster' }), { initialProps: { pluginID: 'plugin' } });
    await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe('1'));
    expect(transport.get).toHaveBeenLastCalledWith('plugin', 'cluster');
    hook.rerender({ pluginID: 'other' });
    await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe('7'));
    expect(transport.get).toHaveBeenLastCalledWith('other', 'cluster');
  });

  it('shares one cache and one subscription with the root hook: two consumers, one read', async () => {
    const hook = renderHook(() => [useConnectionMetadata({ pluginID: 'plugin', connectionID: 'cluster' }), rootHook('plugin', 'cluster')] as const);
    await waitFor(() => expect(hook.result.current[0].snapshot?.revision).toBe('1'));
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.subscriptions).toBe(1);
    expect(hook.result.current[0].snapshot).toBe(hook.result.current[1].snapshot);
    await act(async () => hook.result.current[0].refresh());
    expect(transport.refresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current[1].snapshot?.revision).toBe('2');
  });

  it('a refresh kept across a disable resolves without a request or a change to the shared cache while another consumer listens, and works again once re-enabled', async () => {
    const hook = renderHook(({ enabled }) => [useConnectionMetadata({ pluginID: 'plugin', connectionID: 'cluster', enabled }), rootHook('plugin', 'cluster')] as const, { initialProps: { enabled: true } });
    await waitFor(() => expect(hook.result.current[1].snapshot?.revision).toBe('1'));
    const kept = hook.result.current[0].refresh;
    hook.rerender({ enabled: false });
    expect(hook.result.current[0].snapshot).toBeUndefined();
    const subscriptions = transport.subscriptions;
    await act(async () => { await kept(); });
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(hook.result.current[1].snapshot?.revision).toBe('1');
    expect(transport.subscriptions).toBe(subscriptions);
    expect(transport.listener).toBeDefined();

    hook.rerender({ enabled: true });
    await act(async () => { await kept(); });
    expect(transport.refresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current[1].snapshot?.revision).toBe('2');
  });
});
