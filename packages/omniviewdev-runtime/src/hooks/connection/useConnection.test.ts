import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { ConnectionProfileResult } from '../../resource/v2/host';
import { useConnection } from './useConnection';

const native = vi.hoisted(() => ({
  get: vi.fn(), start: vi.fn(), stop: vi.fn(), save: vi.fn(), importProfile: vi.fn(), reset: vi.fn(), remove: vi.fn(), snackbar: vi.fn(),
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'neutral' }));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: native.snackbar }) }));
vi.mock('../../resource/v2/client', () => ({
  GetConnection: native.get,
  StartConnection: native.start,
  StopConnection: native.stop,
  SaveConnectionProfile: native.save,
  ImportConnectionProfile: native.importProfile,
  ResetConnectionProfile: native.reset,
  RemoveConnection: native.remove,
}));
vi.mock('../../connection/connectionReadiness', () => ({
  startConnectionWithReadiness: native.start,
  stopConnectionWithReadiness: native.stop,
  invalidateConnectionReadiness: vi.fn(),
}));

const original = Connection.createFrom({ id: 'route/雪', name: 'Native' });
const edited = Connection.createFrom({ id: 'route/雪', name: 'Override' });
const detailKey = ['neutral', 'connection', 'detail', original.id];
const listKey = ['neutral', 'connection', 'list'];
const profilesKey = ['neutral', 'connection', 'profiles'];
const resourcesKey = ['neutral', 'resource-v2', 'enumerate'];
const schemasKey = ['neutral', 'resource-v2', 'editor-schemas', { connection: original.id }];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(detailKey, original);
  client.setQueryData(listKey, [original]);
  client.setQueryData(profilesKey, [{ id: original.id, source: 'native', connection: original, active: true }]);
  client.setQueryData(resourcesKey, { nativeBaseline: true });
  client.setQueryData(schemasKey, []);
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useConnection({ connectionID: original.id, enabled: false }), { wrapper });
  return { client, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.get.mockResolvedValue(original);
  native.start.mockResolvedValue({ status: 'CONNECTED', details: 'ready' });
  native.stop.mockResolvedValue(original);
  native.save.mockResolvedValue({ applied: true, profile: { id: original.id, source: 'override', connection: edited, active: true } });
  native.importProfile.mockResolvedValue({ applied: true, profile: { id: original.id, source: 'override', connection: original, active: true } });
  native.reset.mockResolvedValue({ applied: true, profile: { id: original.id, source: 'absent', active: false } });
  native.remove.mockResolvedValue(undefined);
});

describe('explicit connection profile mutations', () => {
  it('waits for applied success without replacing effective caches optimistically', async () => {
    let apply!: (result: ConnectionProfileResult) => void;
    native.save.mockReturnValue(new Promise<ConnectionProfileResult>((resolve) => { apply = resolve; }));
    const { client, hook } = mount();
    let pending!: Promise<ConnectionProfileResult>;
    await act(async () => { pending = hook.result.current.saveConnectionProfile(edited); await Promise.resolve(); });
    expect(native.save).toHaveBeenCalledWith('neutral', edited);
    expect(native.snackbar).not.toHaveBeenCalled();
    expect(client.getQueryData(detailKey)).toBe(original);
    const result: ConnectionProfileResult = { applied: true, profile: { id: original.id, source: 'override', connection: edited, active: true } };
    await act(async () => { apply(result); await pending; });
    expect(native.snackbar).toHaveBeenCalledWith('Connection profile saved', 'success');
    expect(client.getQueryData(detailKey)).toBe(original);
    expect(client.getQueryData(listKey)).toEqual([original]);
    for (const key of [detailKey, listKey, profilesKey, resourcesKey, schemasKey]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    hook.unmount(); client.clear();
  });

  it('does not report a non-applied result as successful', async () => {
    native.save.mockResolvedValue({ applied: false, profile: { id: original.id, source: 'review', active: false } });
    const { client, hook } = mount();
    await act(async () => { await expect(hook.result.current.saveConnectionProfile(edited)).rejects.toThrow('Connection profile was not applied'); });
    expect(native.snackbar).not.toHaveBeenCalledWith('Connection profile saved', 'success');
    expect(client.getQueryData(detailKey)).toBe(original);
    expect(client.getQueryState(profilesKey)?.isInvalidated).toBe(true);
    hook.unmount(); client.clear();
  });

  it('preserves an application error and refreshes actual state when rollback may be unknown', async () => {
    const failure = new Error('Overlay rollback failed; actual state unknown');
    native.save.mockRejectedValue(failure);
    const { client, hook } = mount();
    await act(async () => { await expect(hook.result.current.saveConnectionProfile(edited)).rejects.toBe(failure); });
    expect(native.snackbar).not.toHaveBeenCalledWith('Connection profile saved', 'success');
    expect(client.getQueryData(detailKey)).toBe(original);
    expect(client.getQueryState(resourcesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(profilesKey)?.isInvalidated).toBe(true);
    hook.unmount(); client.clear();
  });

  it('imports only the explicitly selected native route', async () => {
    const { client, hook } = mount();
    await act(async () => { await hook.result.current.importConnectionProfile(); });
    expect(native.importProfile).toHaveBeenCalledWith('neutral', original.id);
    expect(native.save).not.toHaveBeenCalled();
    expect(client.getQueryState(profilesKey)?.isInvalidated).toBe(true);
    hook.unmount(); client.clear();
  });

  it('accepts reset-to-absent without claiming a native fallback exists', async () => {
    const { client, hook } = mount();
    let result!: ConnectionProfileResult;
    await act(async () => { result = await hook.result.current.resetConnectionProfile(); });
    expect(native.reset).toHaveBeenCalledWith('neutral', original.id);
    expect(result.profile).toEqual({ id: original.id, source: 'absent', active: false });
    expect(native.snackbar).toHaveBeenCalledWith('Connection profile reset', 'success');
    expect(native.snackbar).not.toHaveBeenCalledWith('Native connection discovery restored', 'success');
    hook.unmount(); client.clear();
  });

  it('disables through the host endpoint without filtering a cached snapshot as desired state', async () => {
    const { client, hook } = mount();
    await act(async () => { await hook.result.current.removeConnection(); });
    expect(native.remove).toHaveBeenCalledWith('neutral', original.id);
    expect(native.save).not.toHaveBeenCalled();
    expect(client.getQueryData(listKey)).toEqual([original]);
    expect(client.getQueryState(profilesKey)?.isInvalidated).toBe(true);
    hook.unmount(); client.clear();
  });
});

it('does not write lifecycle ConnectionStatus into the Connection detail cache', async () => {
  const { client, hook } = mount();
  await act(async () => { await hook.result.current.startConnection(); });
  expect(native.start).toHaveBeenCalledWith('neutral', original.id);
  expect(client.getQueryData(detailKey)).toBe(original);
  expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(schemasKey)?.isInvalidated).toBe(true);
  hook.unmount(); client.clear();
});
