import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), commit: vi.fn(), validate: vi.fn(), events: new Map<string, Set<(event: unknown) => void>>() }));
vi.mock('../../api', () => ({ SettingsService: { GetSnapshot: mocks.get, Commit: mocks.commit, Validate: mocks.validate } }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (name: string, callback: (event: unknown) => void) => {
  let callbacks = mocks.events.get(name);
  if (!callbacks) mocks.events.set(name, callbacks = new Set());
  callbacks.add(callback);
  return () => { callbacks.delete(callback); if (!callbacks.size) mocks.events.delete(name); };
} } }));
import { HOST_SETTINGS_SCOPE, scopedSettingID, settingsQueryKey, useScopedSettings } from './useScopedSettings';
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function emit(name: string, data: unknown) { for (const callback of mocks.events.get(name) ?? []) callback({ data }); }
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('scoped settings boundary', () => {
  it('keeps plugin IDs opaque and cache keys scope-specific', () => {
    const plugin = { kind: 'plugin', pluginId: 'probe' } as const;
    expect(scopedSettingID(plugin, 'plugin', 'nested.raw.id')).toBe('nested.raw.id');
    expect(scopedSettingID(HOST_SETTINGS_SCOPE, 'appearance', 'theme')).toBe('appearance.theme');
    expect(settingsQueryKey(plugin)).not.toEqual(settingsQueryKey(HOST_SETTINGS_SCOPE));
  });
  it('shares snapshots and event listeners within one query client', async () => {
    mocks.get.mockResolvedValue({ scope: HOST_SETTINGS_SCOPE, categories: {} });
    const shared = wrapper();
    const first = renderHook(() => useScopedSettings(HOST_SETTINGS_SCOPE), { wrapper: shared });
    const second = renderHook(() => useScopedSettings(HOST_SETTINGS_SCOPE), { wrapper: shared });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.events.get('settings/changed')?.size).toBe(1);
    expect(first.result.current.snapshot).toBe(second.result.current.snapshot);
  });
  it('isolates snapshots between query clients', async () => {
    const scope = HOST_SETTINGS_SCOPE;
    mocks.get.mockResolvedValueOnce({ scope, categories: { first: { settings: {} } } })
      .mockResolvedValueOnce({ scope, categories: { second: { settings: {} } } });
    const first = renderHook(() => useScopedSettings(scope), { wrapper: wrapper() });
    const second = renderHook(() => useScopedSettings(scope), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(first.result.current.categories).toHaveProperty('first');
    expect(second.result.current.categories).toHaveProperty('second');
  });
  it('returns durable warnings even if refreshing saved settings fails', async () => {
    const scope = { kind: 'plugin', pluginId: 'warning-probe' } as const;
    const snapshot = { scope, categories: {} };
    mocks.get.mockResolvedValueOnce(snapshot).mockRejectedValue(new Error('refresh unavailable'));
    const result = { snapshot, applied: false, uncertain: true, message: 'Saved; application uncertain.' };
    mocks.commit.mockResolvedValue(result);
    const hook = renderHook(() => useScopedSettings(scope), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => expect(await hook.result.current.commit({ 'nested.raw.id': 7 })).toEqual(result));
    expect(mocks.commit).toHaveBeenCalledWith(scope, { 'nested.raw.id': 7 });
  });
  it.each([false, true])('refetches authoritative data instead of publishing delayed commit snapshots; pending read %s', async (pendingRead) => {
    const scope = HOST_SETTINGS_SCOPE;
    const initial = { scope, categories: {} };
    const newer = { scope, categories: { newer: { settings: {} } } };
    const delayedCommit = Promise.withResolvers<unknown>();
    const delayedRead = Promise.withResolvers<unknown>();
    mocks.get.mockResolvedValueOnce(initial).mockReturnValueOnce(delayedRead.promise).mockResolvedValue(newer);
    mocks.commit.mockReturnValueOnce(delayedCommit.promise);
    const hook = renderHook(() => useScopedSettings(scope), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    let commit!: Promise<unknown>;
    act(() => { commit = hook.result.current.commit({ value: 'saved' }); });
    act(() => { emit('settings/changed', scope); });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    if (!pendingRead) await act(async () => { delayedRead.resolve(newer); });
    await act(async () => {
      delayedCommit.resolve({ snapshot: initial, applied: true, uncertain: false, message: '' });
      await commit;
    });
    if (pendingRead) await act(async () => { delayedRead.resolve(initial); });
    await waitFor(() => expect(hook.result.current.categories).toHaveProperty('newer'));
  });
  it.each(['plugin/init_complete', 'plugin/inventory_changed', 'plugin/dev_reload_complete', 'plugin/recovered', 'plugin/dev_install_complete'])(
    'recovers failed plugin settings on %s through shared event bridge', async (eventName) => {
      const scope = { kind: 'plugin', pluginId: 'starting-plugin' } as const;
      const snapshot = { scope, categories: { plugin: { settings: { path: { value: 'ready' } } } } };
      mocks.get.mockRejectedValueOnce(new Error('plugin unavailable')).mockResolvedValue(snapshot);
      const shared = wrapper();
      const first = renderHook(() => useScopedSettings(scope), { wrapper: shared });
      const second = renderHook(() => useScopedSettings(scope), { wrapper: shared });
      await waitFor(() => expect(first.result.current.error).toBeInstanceOf(Error));
      expect(mocks.events.get(eventName)?.size).toBe(1);
      act(() => { emit(eventName, { id: scope.pluginId }); });
      await waitFor(() => expect(first.result.current.categories.plugin?.settings.path?.value).toBe('ready'));
      expect(second.result.current.snapshot).toBe(first.result.current.snapshot);
      expect(first.result.current.error).toBeUndefined();
      expect(mocks.get).toHaveBeenCalledTimes(2);
    });
});
