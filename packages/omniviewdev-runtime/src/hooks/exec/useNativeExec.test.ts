import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import type * as ExecClient from '../../exec';
import type { NativeExecInput } from './useNativeExec';
import { useNativeExec } from './useNativeExec';

const native = vi.hoisted(() => ({ platform: vi.fn(), handler: vi.fn(), launch: vi.fn(), snackbar: vi.fn() }));
vi.mock('@wailsio/runtime', async () => {
  const actual = await vi.importActual<typeof WailsRuntime>('@wailsio/runtime');
  return { ...actual, Call: { ...actual.Call, ByName: native.launch } };
});
vi.mock('../../exec', async () => ({
  ...await vi.importActual<typeof ExecClient>('../../exec'),
  GetNativeTerminalSupport: native.platform,
  GetHandler: native.handler,
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (explicit?: string) => explicit ?? 'context-plugin' }));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: native.snackbar }) }));

const clients: QueryClient[] = [];
function setup(resourceKey = 'pods') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useNativeExec({ resourceKey }), { wrapper });
  return { ...hook, client, wrapper };
}
const input: NativeExecInput = {
  connectionID: 'selected-connection',
  opts: {
    resource_key: 'pods',
    params: { container: 'ordinary-app' },
    command: ['/bin/sh'],
    reference: { address: { provider: 'context-plugin', authority: 'cluster', type: 'pods', id: 'pod-1', scope: [] }, incarnation: 'original-uid' },
    route: { connection: 'selected-connection' },
    resource_data: { kind: 'map', value: {
      generation: { kind: 'int64', value: '9223372036854775807' },
      signedZero: { kind: 'double', value: -0 },
    } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  native.platform.mockResolvedValue(true);
  native.handler.mockResolvedValue({ supports_native_command: true });
  native.launch.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe('native exec consumer contract', () => {
  it.each([
    [false, true],
    [true, false],
    [true, undefined],
  ])('does not offer or launch native exec with platform %s and handler metadata %s', async (platform, supports) => {
    native.platform.mockResolvedValue(platform);
    native.handler.mockResolvedValue({ supports_native_command: supports });
    const view = setup();
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(view.result.current.isSupported).toBe(false);
    await act(async () => expect(await view.result.current.openNativeSession(input)).toBe(false));
    expect(native.launch).not.toHaveBeenCalled();
  });

  it('keeps failed capability discovery unavailable', async () => {
    native.handler.mockRejectedValue(new Error('Plugin unavailable'));
    const view = setup();
    await waitFor(() => expect(native.handler).toHaveBeenCalled());
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(view.result.current.isSupported).toBe(false);
    expect(native.launch).not.toHaveBeenCalled();
  });

  it('launches the selected target once, preserves canonical scalars, and blocks same-turn duplicate clicks', async () => {
    const pending = Promise.withResolvers<void>();
    native.launch.mockReturnValueOnce(pending.promise);
    const view = setup();
    await waitFor(() => expect(view.result.current.isSupported).toBe(true));
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = view.result.current.openNativeSession(input);
      duplicate = view.result.current.openNativeSession(input);
    });
    await expect(duplicate).resolves.toBe(false);
    await waitFor(() => expect(view.result.current.isPending).toBe(true));
    expect(native.launch).toHaveBeenCalledTimes(1);
    const [method, plugin, connection, encoded] = native.launch.mock.calls[0];
    expect(method).toBe('github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.OpenNativeSession');
    expect(plugin).toBe('context-plugin');
    expect(connection).toBe(input.connectionID);
    const decoded = JSON.parse(encoded);
    expect(decoded).toMatchObject(input.opts);
    expect(Object.is(decoded.resource_data.value.signedZero.value, -0)).toBe(true);
    await act(async () => { pending.resolve(); expect(await first).toBe(true); });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
  });

  it('shares pending and launch exclusion with a second surface mounted during launch', async () => {
    const pending = Promise.withResolvers<void>();
    native.launch.mockReturnValueOnce(pending.promise);
    const row = setup();
    await waitFor(() => expect(row.result.current.isSupported).toBe(true));
    let first!: Promise<boolean>;
    act(() => { first = row.result.current.openNativeSession(input); });
    await waitFor(() => expect(native.launch).toHaveBeenCalledTimes(1));

    const drawer = renderHook(() => useNativeExec({ resourceKey: 'pods' }), { wrapper: row.wrapper });
    expect(drawer.result.current.isPending).toBe(true);
    await waitFor(() => expect(drawer.result.current.isSupported).toBe(true));
    await act(async () => expect(await drawer.result.current.openNativeSession(input)).toBe(false));
    expect(native.launch).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(); expect(await first).toBe(true); });
    await waitFor(() => {
      expect(row.result.current.isPending).toBe(false);
      expect(drawer.result.current.isPending).toBe(false);
    });
    await act(async () => expect(await drawer.result.current.openNativeSession(input)).toBe(true));
    expect(native.launch).toHaveBeenCalledTimes(2);
  });

  it('returns false with safe actionable feedback, no integrated fallback, and allows an explicit retry', async () => {
    native.launch.mockRejectedValueOnce(new Error(JSON.stringify({
      type: 'native-terminal-unavailable', title: 'Terminal unavailable', status: 503,
      detail: 'Install iTerm2 or select Terminal in Settings.',
    })));
    const view = setup();
    await waitFor(() => expect(view.result.current.isSupported).toBe(true));
    await act(async () => expect(await view.result.current.openNativeSession(input)).toBe(false));
    expect(native.snackbar).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error', details: 'Install iTerm2 or select Terminal in Settings.',
    }));
    expect(native.launch).toHaveBeenCalledTimes(1);
    await act(async () => expect(await view.result.current.openNativeSession(input)).toBe(true));
    expect(native.launch).toHaveBeenCalledTimes(2);
    expect(native.launch.mock.calls.every(([method]) => method.endsWith('.OpenNativeSession'))).toBe(true);
  });

  it('rejects unsafe request text before crossing Wails without allocating an integrated session', async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.isSupported).toBe(true));
    await act(async () => expect(await view.result.current.openNativeSession({
      ...input, opts: { ...input.opts, params: { container: '\ud800' } },
    })).toBe(false));
    expect(native.launch).not.toHaveBeenCalled();
    expect(native.snackbar).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
