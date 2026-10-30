import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  get: vi.fn(), check: vi.fn(), start: vi.fn(), stop: vi.fn(), save: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  GetConnection: transport.get,
  CheckConnection: transport.check,
  StartConnection: transport.start,
  StopConnection: transport.stop,
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: () => () => {} } }));
vi.mock('../../resource/v2/client', () => ({
  GetConnection: transport.get,
  SaveConnectionProfile: transport.save,
  ImportConnectionProfile: vi.fn(),
  ResetConnectionProfile: vi.fn(),
  RemoveConnection: transport.remove,
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (explicit: string) => explicit }));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: vi.fn() }) }));

import { useConnection } from './useConnection';
import { useConnectionReadiness } from './useConnectionReadiness';

const options = { pluginID: 'kubernetes', connectionID: 'opaque/cluster/id' };
const queryKey = [options.pluginID, 'connection', 'detail', options.connectionID];
const connection = { id: options.connectionID, name: 'Connected cluster' };
const status = { status: 'CONNECTED', connection, error: '', details: '' };

beforeEach(() => {
  transport.get.mockReset().mockResolvedValue(connection);
  transport.check.mockReset().mockResolvedValue({ ...status, status: 'DISCONNECTED' });
  transport.start.mockReset().mockResolvedValue(status);
  transport.stop.mockReset().mockResolvedValue(connection);
  transport.save.mockReset().mockResolvedValue({ applied: true, profile: { id: connection.id, source: 'override', connection, active: true } });
  transport.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({
    connection: useConnection(options),
    readiness: useConnectionReadiness(options),
  }), { wrapper });
  return { ...hook, client };
}

describe('useConnection readiness integration', () => {
  it('stores connection metadata rather than a start status envelope', async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.readiness.phase).toBe('disconnected'));
    let returned: unknown;
    await act(async () => { returned = await result.current.connection.startConnection(); });
    expect(returned).toEqual(status);
    expect(client.getQueryData(queryKey)).toEqual(connection);
    expect(client.getQueryData(queryKey)).not.toHaveProperty('status');
    expect(result.current.readiness.phase).toBe('connected');
    await act(async () => result.current.connection.stopConnection());
    expect(result.current.readiness.phase).toBe('disconnected');
  });

  it('preserves metadata when start status has no connection', async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.connection.connection.isSuccess).toBe(true));
    transport.start.mockResolvedValue({ ...status, connection: null, status: 'FORBIDDEN' });
    await act(async () => result.current.connection.startConnection());
    expect(client.getQueryData(queryKey)).toEqual(connection);
    expect(result.current.readiness.phase).toBe('forbidden');
  });

  it('invalidates readiness when connection metadata changes or connection is removed', async () => {
    transport.check.mockResolvedValue(status);
    const { result } = setup();
    await waitFor(() => expect(result.current.readiness.phase).toBe('connected'));
    transport.check.mockResolvedValue({ ...status, status: 'UNAUTHORIZED' });
    await act(async () => result.current.connection.saveConnectionProfile({ ...connection } as Parameters<typeof result.current.connection.saveConnectionProfile>[0]));
    await waitFor(() => expect(result.current.readiness.phase).toBe('unauthorized'));
    await act(async () => result.current.connection.removeConnection());
    expect(result.current.readiness.phase).toBe('not-found');
  });
});
