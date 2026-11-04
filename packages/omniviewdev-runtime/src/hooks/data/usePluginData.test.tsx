import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  snapshot: vi.fn(),
  cas: vi.fn(),
}));
vi.mock(
  '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/data/servicewrapper',
  () => ({
    Get: backend.get,
    Set: backend.set,
    GetSnapshot: backend.snapshot,
    CompareAndSwap: backend.cas,
  }),
);
import { usePluginData } from './usePluginData';

function provider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const emptyCounts: Record<string, number> = {};

// Model the host's content revision check before committing a write.
function protocol(read: () => Record<string, number>) {
  backend.snapshot.mockImplementation(async () => {
    const value = { ...read() };
    return { value, revision: JSON.stringify(value) };
  });
  backend.cas.mockImplementation(async (plugin, key, revision, value) => {
    if (revision !== JSON.stringify(read())) return false;
    await backend.set(plugin, key, value);
    return true;
  });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('shared plugin data updates', () => {
  it('recovers unreadable stored data with a literal replacement', async () => {
    let persisted: Record<string, number> | undefined;
    backend.get.mockImplementation(async () => {
      if (!persisted) throw new Error('invalid stored JSON');
      return { ...persisted };
    });
    backend.set.mockImplementation(async (_plugin, _key, value) => {
      persisted = { ...value };
    });
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => {
      await hook.result.current.update({ recovered: 1 });
    });
    expect(persisted).toEqual({ recovered: 1 });
    await waitFor(() => expect(hook.result.current.data).toEqual({ recovered: 1 }));
  });

  it('preserves increments and unrelated values across concurrently mounted consumers', async () => {
    let persisted = { existing: 9, recent: 1 };
    const firstWrite = Promise.withResolvers<void>();
    backend.get.mockImplementation(async () => ({ ...persisted }));
    protocol(() => persisted);
    backend.set.mockImplementation(async (_plugin, _key, next) => {
      if (next.recent === 2) await firstWrite.promise;
      persisted = { ...next };
    });
    const shared = provider();
    const first = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: shared },
    );
    const second = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: shared },
    );
    await waitFor(() => expect(second.result.current.data.recent).toBe(1));
    let firstUpdate!: Promise<void>;
    let secondUpdate!: Promise<void>;
    act(() => {
      firstUpdate = first.result.current.update((current) => ({
        ...current,
        recent: current.recent! + 1,
      }));
      secondUpdate = second.result.current.update((current) => ({
        ...current,
        recent: current.recent! + 1,
      }));
    });
    await waitFor(() => expect(backend.cas).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstWrite.resolve();
      await Promise.all([firstUpdate, secondUpdate]);
    });
    expect(persisted).toEqual({ existing: 9, recent: 3 });
    await waitFor(() => expect(first.result.current.data).toEqual(persisted));
    expect(second.result.current.data).toEqual(persisted);
  });

  it('rolls back a failed write before evaluating the next queued update', async () => {
    let persisted = { count: 5 };
    const failedWrite = Promise.withResolvers<void>();
    backend.get.mockImplementation(async () => ({ ...persisted }));
    protocol(() => persisted);
    backend.set.mockImplementation(async (_plugin, _key, next) => {
      if (next.count === 6) {
        await failedWrite.promise;
        throw new Error('disk write failed');
      }
      persisted = { ...next };
    });
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(hook.result.current.data.count).toBe(5));
    let first!: Promise<unknown>;
    let next!: Promise<void>;
    act(() => {
      first = hook.result.current
        .update((value) => ({ count: value.count! + 1 }))
        .catch((error: unknown) => error);
      next = hook.result.current.update((value) => ({
        count: value.count! + 2,
      }));
    });
    await waitFor(() => expect(backend.cas).toHaveBeenCalledTimes(1));
    let failure: unknown;
    await act(async () => {
      failedWrite.resolve();
      failure = await first;
      await next;
    });
    expect(failure).toBeInstanceOf(Error);
    expect(persisted).toEqual({ count: 7 });
    await waitFor(() => expect(hook.result.current.data).toEqual({ count: 7 }));
  });

  it('loads existing persisted fields before an update issued during initial loading', async () => {
    const firstRead = Promise.withResolvers<Record<string, number>>();
    let persisted = { previous: 12 };
    protocol(() => persisted);
    backend.get
      .mockReturnValueOnce(firstRead.promise)
      .mockImplementation(async () => ({ ...persisted }));
    backend.set.mockImplementation(async (_plugin, _key, value) => {
      persisted = { ...value };
    });
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await act(async () => {
      await hook.result.current.update((current) => ({ ...current, added: 3 }));
    });
    firstRead.resolve(persisted);
    expect(persisted).toEqual({ previous: 12, added: 3 });
    await waitFor(() => expect(hook.result.current.data).toEqual(persisted));
  });

  it('preserves simultaneous updates from independent window query clients', async () => {
    let persisted = { existing: 9, recent: 1 };
    backend.get.mockImplementation(async () => ({ ...persisted }));
    backend.set.mockImplementation(async (_plugin, _key, next) => {
      persisted = { ...next };
    });
    protocol(() => persisted);
    const bothSnapshots = Promise.withResolvers<void>();
    let snapshots = 0;
    backend.snapshot.mockImplementation(async () => {
      const value = { ...persisted };
      snapshots++;
      if (snapshots === 2) bothSnapshots.resolve();
      if (snapshots <= 2) await bothSnapshots.promise;
      return { value, revision: JSON.stringify(value) };
    });
    const first = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    const second = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(first.result.current.data.recent).toBe(1));
    await waitFor(() => expect(second.result.current.data.recent).toBe(1));
    await act(async () => {
      await Promise.all([
        first.result.current.update((current) => ({
          ...current,
          recent: current.recent! + 1,
        })),
        second.result.current.update((current) => ({
          ...current,
          recent: current.recent! + 1,
        })),
      ]);
    });
    expect(persisted).toEqual({ existing: 9, recent: 3 });
    expect(backend.cas).toHaveBeenCalledTimes(3);
  });

  it('replays a pure updater after a conflict using fresh backend fields', async () => {
    let persisted = { count: 1, existing: 9 };
    backend.get.mockImplementation(async () => ({ ...persisted }));
    protocol(() => persisted);
    backend.set.mockImplementation(async (_plugin, _key, value) => {
      persisted = value;
    });
    backend.cas.mockImplementationOnce(async () => {
      persisted = { count: 4, existing: 12 };
      return false;
    });
    const updater = vi.fn((value: Record<string, number>) => ({
      ...value,
      count: value.count! + 1,
    }));
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(hook.result.current.data.count).toBe(1));
    await act(async () => {
      await hook.result.current.update(updater);
    });
    expect(updater).toHaveBeenCalledTimes(2);
    expect(persisted).toEqual({ count: 5, existing: 12 });
  });

  it('rejects eight conflicts without writing and restores persisted cache', async () => {
    const persisted = { count: 5 };
    backend.get.mockResolvedValue(persisted);
    protocol(() => persisted);
    backend.cas.mockResolvedValue(false);
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(hook.result.current.data.count).toBe(5));
    await act(async () => {
      await expect(
        hook.result.current.update((value) => ({
          ...value,
          count: value.count! + 1,
        })),
      ).rejects.toThrow('conflicted after 8 attempts');
    });
    expect(backend.snapshot).toHaveBeenCalledTimes(8);
    expect(backend.cas).toHaveBeenCalledTimes(8);
    expect(backend.set).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.data).toEqual(persisted));
  });

  it('keeps literal replacements on Set without snapshot or CAS', async () => {
    backend.get.mockResolvedValue({ count: 1 });
    backend.set.mockResolvedValue(undefined);
    const hook = renderHook(
      () => usePluginData('kubernetes', 'counts', emptyCounts),
      { wrapper: provider() },
    );
    await waitFor(() => expect(hook.result.current.data.count).toBe(1));
    await act(async () => {
      await hook.result.current.update({ count: 7 });
    });
    expect(backend.set).toHaveBeenCalledWith('kubernetes', 'counts', {
      count: 7,
    });
    expect(backend.snapshot).not.toHaveBeenCalled();
    expect(backend.cas).not.toHaveBeenCalled();
  });
});
