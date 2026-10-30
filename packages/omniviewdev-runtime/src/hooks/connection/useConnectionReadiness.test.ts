import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  check: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (name: string, listener: (event: { data: unknown }) => void) => {
      const listeners = transport.listeners.get(name) ?? new Set();
      listeners.add(listener);
      transport.listeners.set(name, listeners);
      return () => listeners.delete(listener);
    },
  },
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  CheckConnection: transport.check,
  StartConnection: transport.start,
  StopConnection: transport.stop,
}));
vi.mock('../useResolvedPluginId', () => ({
  useResolvedPluginId: (explicit?: string) => explicit ?? 'context-plugin',
}));

import { useConnectionReadiness } from './useConnectionReadiness';
import {
  requireConnectionReady,
  startConnectionWithReadiness,
  stopConnectionWithReadiness,
  withConnectionReady,
  getConnectionReadinessGeneration,
  isConnectionReadinessCurrent,
} from '../../connection/connectionReadiness';

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  // Runtime targets ES2020, which does not provide Promise.withResolvers.
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const status = (value: string, extra = {}) => ({ status: value, connection: { id: 'cluster', name: 'Cluster' }, error: '', details: '', ...extra });
const options = { pluginID: 'kubernetes', connectionID: 'cluster' };
function emit(name: string, data: unknown) {
  act(() => {
    for (const listener of transport.listeners.get(name) ?? []) listener({ data });
  });
}

beforeEach(() => {
  transport.check.mockReset().mockResolvedValue(status('DISCONNECTED'));
  transport.start.mockReset().mockResolvedValue(status('CONNECTED'));
  transport.stop.mockReset().mockResolvedValue({ id: 'cluster' });
});
afterEach(() => cleanup());

describe('useConnectionReadiness', () => {
  it('shares checks and explicit starts across consumers without auto-connecting', async () => {
    const check = deferred();
    const start = deferred();
    transport.check.mockReturnValue(check.promise);
    transport.start.mockReturnValue(start.promise);
    const first = renderHook(() => useConnectionReadiness(options));
    const second = renderHook(() => useConnectionReadiness(options));
    expect(first.result.current.phase).toBe('checking');
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(1));
    expect(transport.start).not.toHaveBeenCalled();
    await act(async () => check.resolve(status('DISCONNECTED')));
    let attempts!: Promise<void>[];
    act(() => { attempts = [first.result.current.connect(), second.result.current.connect()]; });
    expect(first.result.current.phase).toBe('connecting');
    await waitFor(() => expect(transport.start).toHaveBeenCalledTimes(1));
    await act(async () => {
      start.resolve(status('CONNECTED'));
      await Promise.all(attempts);
    });
    expect(first.result.current.phase).toBe('connected');
    expect(second.result.current.phase).toBe('connected');
  });

  it.each([
    ['DISCONNECTED', 'disconnected'], ['PENDING', 'connecting'], ['UNAUTHORIZED', 'unauthorized'],
    ['FORBIDDEN', 'forbidden'], ['NOT_FOUND', 'not-found'], ['FAILED', 'error'],
    ['ERROR', 'error'], ['UNKNOWN', 'error'], ['TIMEOUT', 'error'],
  ])('blocks returned %s status', async (backendStatus, phase) => {
    transport.check.mockResolvedValue(status(backendStatus, { details: 'Backend explanation' }));
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe(phase));
    expect(result.current.message).toBe('Backend explanation');
    expect(transport.start).not.toHaveBeenCalled();
  });

  it('classifies rejected checks and resolves failed connect/retry actions', async () => {
    const error = { type: 'resource/unauthorized', title: 'Authentication required', status: 401, detail: 'Credentials expired.' };
    transport.check.mockRejectedValue(error);
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('unauthorized'));
    expect(result.current.message).toBe('Credentials expired.');
    transport.start.mockRejectedValue(new Error('Transport failed'));
    await act(async () => { await expect(result.current.connect()).resolves.toBeUndefined(); });
    expect(result.current.phase).toBe('error');
    await act(async () => { await expect(result.current.retry()).resolves.toBeUndefined(); });
    expect(result.current.phase).toBe('unauthorized');
  });

  it('does not treat a successful start RPC with non-connected status as connected', async () => {
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    transport.start.mockResolvedValue(status('FORBIDDEN', { error: 'Access denied' }));
    await act(async () => result.current.connect());
    expect(result.current.phase).toBe('forbidden');
    expect(result.current.message).toBe('Access denied');
  });

  it.each(['check', 'start'] as const)('ignores late %s response after disconnect', async (operation) => {
    const pending = deferred();
    if (operation === 'check') transport.check.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useConnectionReadiness(options));
    let action: Promise<void> | undefined;
    if (operation === 'start') {
      await waitFor(() => expect(result.current.phase).toBe('disconnected'));
      transport.start.mockReturnValue(pending.promise);
      act(() => { action = result.current.connect(); });
    }
    await waitFor(() => expect(transport[operation]).toHaveBeenCalled());
    emit('connection/status', { ...options, status: 'DISCONNECTED' });
    if (operation === 'start') {
      emit('connection/status', { ...options, status: 'CONNECTED' });
      expect(result.current.phase).toBe('disconnected');
    }
    await act(async () => {
      pending.resolve(status('CONNECTED'));
      await action;
    });
    expect(result.current.phase).toBe('disconnected');
  });

  it('isolates full slash-containing connection and plugin IDs', async () => {
    transport.check.mockImplementation((pluginID: string, connectionID: string) =>
      Promise.resolve(status(pluginID === 'a' && connectionID === 'b/c' ? 'CONNECTED' : 'DISCONNECTED')));
    const first = renderHook(() => useConnectionReadiness({ pluginID: 'a', connectionID: 'b/c' }));
    const second = renderHook(() => useConnectionReadiness({ pluginID: 'a/b', connectionID: 'c' }));
    await waitFor(() => expect(first.result.current.phase).toBe('connected'));
    await waitFor(() => expect(second.result.current.phase).toBe('disconnected'));
    emit('connection/status', { pluginID: 'a/b', connectionID: 'c', status: 'FORBIDDEN' });
    expect(first.result.current.phase).toBe('connected');
    expect(second.result.current.phase).toBe('forbidden');
    expect(transport.check).toHaveBeenCalledWith('a', 'b/c');
  });

  it('checks new IDs before allowing access rather than retaining previous route state', async () => {
    transport.check.mockResolvedValueOnce(status('CONNECTED'));
    const { result, rerender } = renderHook(({ connectionID }) => useConnectionReadiness({ ...options, connectionID }), {
      initialProps: { connectionID: 'first' },
    });
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    const next = deferred();
    transport.check.mockReturnValue(next.promise);
    rerender({ connectionID: 'second/opaque/id' });
    expect(result.current.phase).toBe('checking');
    await act(async () => next.resolve(status('DISCONNECTED')));
    expect(result.current.phase).toBe('disconnected');
  });

  it('releases listeners and checks again on remount without trusting stale readiness', async () => {
    transport.check.mockResolvedValueOnce(status('CONNECTED'));
    const first = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(first.result.current.phase).toBe('connected'));
    first.unmount();
    expect([...transport.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    const pending = deferred();
    transport.check.mockReturnValue(pending.promise);
    const second = renderHook(() => useConnectionReadiness(options));
    expect(second.result.current.phase).toBe('checking');
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve(status('DISCONNECTED')));
    expect(second.result.current.phase).toBe('disconnected');
  });

  it('keeps remaining consumers subscribed when one unmounts', async () => {
    const first = renderHook(() => useConnectionReadiness(options));
    const second = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(second.result.current.phase).toBe('disconnected'));
    first.unmount();
    emit('connection/status', { ...options, status: 'CONNECTED' });
    expect(second.result.current.phase).toBe('connected');
    expect(transport.check).toHaveBeenCalledTimes(1);
  });

  it('ignores an abandoned mount check after a fresh mount checks the same ID', async () => {
    const abandoned = deferred();
    const fresh = deferred();
    transport.check.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(fresh.promise);
    const first = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(2));
    await act(async () => abandoned.resolve(status('CONNECTED')));
    expect(second.result.current.phase).toBe('checking');
    await act(async () => fresh.resolve(status('DISCONNECTED')));
    expect(second.result.current.phase).toBe('disconnected');
  });

  it('keeps invalidated starts blocked through plugin recovery', async () => {
    const start = deferred();
    transport.start.mockReturnValue(start.promise);
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    let action!: Promise<void>;
    act(() => { action = result.current.connect(); });
    await waitFor(() => expect(transport.start).toHaveBeenCalledTimes(1));
    emit('plugin/crash', { pluginID: options.pluginID });
    emit('plugin/state_change', { pluginID: options.pluginID, to: 'Running' });
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    emit('connection/status', { ...options, status: 'CONNECTED' });
    await act(async () => {
      start.resolve(status('CONNECTED'));
      await action;
    });
    expect(result.current.phase).toBe('disconnected');
  });

  it.each(['{\"error\":\"private backend payload\"}', 'Error: private diagnostic\\n    at backend (server.go:42:1)'])('does not expose structured payloads or stack traces', async (error) => {
    transport.check.mockResolvedValue(status('ERROR', { error }));
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.message).toBe('The connection operation could not be completed.');
  });

  it.each(['plugin/crash', 'plugin/crash_recovery_failed', 'plugin/state_change'])('invalidates late checks after %s and checks after recovery', async (event) => {
    const pending = deferred();
    transport.check.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(1));
    emit(event, { pluginID: options.pluginID, error: 'Plugin unavailable', to: 'Stopped', reason: 'Plugin unavailable' });
    await act(async () => pending.resolve(status('CONNECTED')));
    expect(result.current.phase).toBe('error');
    emit('connection/status', { ...options, status: 'CONNECTED' });
    expect(result.current.phase).toBe('error');
    transport.check.mockResolvedValue(status('CONNECTED'));
    emit('plugin/recovered', { pluginID: options.pluginID });
    expect(result.current.phase).toBe('checking');
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    expect(transport.start).not.toHaveBeenCalled();
  });

  it('checks active connections on focus, but stops listening after unsubscribe', async () => {
    const { result, unmount } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    transport.check.mockResolvedValue(status('CONNECTED'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    expect(transport.check).toHaveBeenCalledTimes(2);
    unmount();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(transport.check).toHaveBeenCalledTimes(2);
  });

  it('does not check disabled consumers and resolves plugin ID from context', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useConnectionReadiness({ connectionID: 'opaque/id', enabled }), {
      initialProps: { enabled: false },
    });
    expect(result.current.phase).toBe('checking');
    expect(transport.check).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    expect(transport.check).toHaveBeenCalledWith('context-plugin', 'opaque/id');
  });
});

describe('imperative connection readiness', () => {
  it('checks fresh without auto-starting or unmounting connected consumers', async () => {
    transport.check.mockResolvedValueOnce(status('CONNECTED'));
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    const pending = deferred();
    transport.check.mockReturnValue(pending.promise);
    let requirement!: Promise<void>;
    act(() => { requirement = requireConnectionReady(options.pluginID, options.connectionID); });
    expect(result.current.phase).toBe('connected');
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending.resolve(status('DISCONNECTED'));
      await expect(requirement).rejects.toThrow('disconnected');
    });
    expect(result.current.phase).toBe('disconnected');
    expect(transport.start).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent loader checks and rejects non-connected outcomes', async () => {
    const pending = deferred();
    transport.check.mockReturnValue(pending.promise);
    const first = requireConnectionReady('plugin', 'opaque/id');
    const second = requireConnectionReady('plugin', 'opaque/id');
    const outcomes = Promise.allSettled([first, second]);
    await waitFor(() => expect(transport.check).toHaveBeenCalledTimes(1));
    pending.resolve(status('FORBIDDEN', { error: 'Access denied' }));
    expect(await outcomes).toEqual([
      { status: 'rejected', reason: new Error('Access denied') },
      { status: 'rejected', reason: new Error('Access denied') },
    ]);
    expect(transport.start).not.toHaveBeenCalled();
  });

  it.each(['connection/status', 'plugin/crash'])('rejects detached I/O invalidated by %s while retaining event listeners', async (event) => {
    transport.check.mockResolvedValue(status('CONNECTED'));
    const pending = deferred<string>();
    const operation = vi.fn(() => pending.promise);
    const task = withConnectionReady('plugin', 'opaque/id', operation);
    const outcome = expect(task).rejects.toThrow('changed while the operation was in progress');
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    expect(transport.listeners.get(event)?.size).toBe(1);
    emit(event, { pluginID: 'plugin', connectionID: 'opaque/id', status: 'DISCONNECTED' });
    pending.resolve('stale data');
    await outcome;
    expect(transport.check).toHaveBeenCalledTimes(1);
    expect([...transport.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('does not invalidate retained I/O when another fresh check remains connected', async () => {
    transport.check.mockResolvedValue(status('CONNECTED'));
    const pending = deferred<string>();
    const operation = vi.fn(() => pending.promise);
    const task = withConnectionReady('plugin', 'opaque/id', operation);
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    const generation = getConnectionReadinessGeneration('plugin', 'opaque/id');
    await requireConnectionReady('plugin', 'opaque/id');
    expect(transport.check).toHaveBeenCalledTimes(2);
    expect(isConnectionReadinessCurrent('plugin', 'opaque/id', generation)).toBe(true);
    pending.resolve('fresh data');
    await expect(task).resolves.toBe('fresh data');
  });

  it('rejects without running I/O when the fresh check is not connected', async () => {
    const operation = vi.fn().mockResolvedValue('unused');
    await expect(withConnectionReady('plugin', 'opaque/id', operation)).rejects.toThrow('disconnected');
    expect(operation).not.toHaveBeenCalled();
    expect(transport.start).not.toHaveBeenCalled();
  });

  it('does not turn resource-level authorization errors into connection failures', async () => {
    transport.check.mockResolvedValue(status('CONNECTED'));
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    const denied = new Error('This resource is forbidden');
    await act(async () => {
      await expect(withConnectionReady(options.pluginID, options.connectionID, () => Promise.reject(denied))).rejects.toBe(denied);
    });
    expect(result.current.phase).toBe('connected');
  });

  it('shares external starts and stops with mounted readiness consumers', async () => {
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('disconnected'));
    await act(async () => startConnectionWithReadiness(options.pluginID, options.connectionID));
    expect(result.current.phase).toBe('connected');
    await act(async () => stopConnectionWithReadiness(options.pluginID, options.connectionID));
    expect(result.current.phase).toBe('disconnected');
  });

  it('keeps checks, starts, and I/O blocked until a pending stop settles', async () => {
    transport.check.mockResolvedValue(status('CONNECTED'));
    const pending = deferred<{ id: string }>();
    transport.stop.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    let stopped!: Promise<{ id: string }>;
    act(() => {
      stopped = stopConnectionWithReadiness(options.pluginID, options.connectionID);
    });
    expect(result.current.phase).toBe('disconnected');
    const checks = transport.check.mock.calls.length;
    const operation = vi.fn().mockResolvedValue('forbidden during shutdown');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await result.current.retry();
      await result.current.connect();
      await expect(requireConnectionReady(options.pluginID, options.connectionID)).rejects.toThrow(/Disconnecting/);
      await expect(withConnectionReady(options.pluginID, options.connectionID, operation)).rejects.toThrow(/Disconnecting/);
    });
    emit('connection/status', { ...options, status: 'CONNECTED' });
    expect(result.current.phase).toBe('disconnected');
    expect(transport.check).toHaveBeenCalledTimes(checks);
    expect(transport.start).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
    expect(transport.stop).toHaveBeenCalledOnce();
    const sameStop = stopConnectionWithReadiness(options.pluginID, options.connectionID);
    expect(sameStop).toBe(stopped);
    await act(async () => {
      pending.resolve({ id: 'cluster' });
      await stopped;
    });
    expect(result.current.phase).toBe('disconnected');
    await act(async () => requireConnectionReady(options.pluginID, options.connectionID));
    expect(result.current.phase).toBe('connected');
  });

  it('releases a failed stop without allowing a late connected event during shutdown', async () => {
    transport.check.mockResolvedValue(status('CONNECTED'));
    const pending = deferred<{ id: string }>();
    transport.stop.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useConnectionReadiness(options));
    await waitFor(() => expect(result.current.phase).toBe('connected'));
    let stopped!: Promise<{ id: string }>;
    act(() => {
      stopped = stopConnectionWithReadiness(options.pluginID, options.connectionID);
    });
    const failure = expect(stopped).rejects.toThrow('Stop failed');
    emit('connection/status', { ...options, status: 'CONNECTED' });
    expect(result.current.phase).toBe('disconnected');
    await act(async () => {
      pending.reject(new Error('Stop failed'));
      await failure;
    });
    expect(result.current.phase).toBe('error');
    await act(async () => result.current.retry());
    expect(result.current.phase).toBe('connected');
  });
});
