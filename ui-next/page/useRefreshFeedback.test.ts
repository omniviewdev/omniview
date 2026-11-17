import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FELT_MS, useRefreshFeedback } from './useRefreshFeedback';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A read that is over at once. */
const instant = async (): Promise<void> => undefined;

/** A read that ends when the test says so. */
function deferred() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { read: async () => promise, end: resolve };
}

const setup = (refresh: () => Promise<void>, failed = false) =>
  renderHook((props: { readonly failed: boolean }) => useRefreshFeedback({ title: 'Items', refresh, failed: props.failed }), { initialProps: { failed } });

describe('useRefreshFeedback (the user\'s own Refresh is felt; the slot of the page header says so)', () => {
  it('is quiet at rest: the slot is declared and holds nothing, and nothing is announced', () => {
    const { result } = setup(instant);
    expect(result.current.operation).toBeNull();
    expect(result.current.announcement).toBe('');
    expect(result.current.felt).toBe(false);
  });

  it('shows "Refreshing…" in the slot, indeterminate, with no command (the read cannot be cancelled), as soon as the user asks', () => {
    const read = deferred();
    const refresh = vi.fn(read.read);
    const { result } = setup(refresh);
    act(() => {
      result.current.ask();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.felt).toBe(true);
    expect(result.current.operation).toMatchObject({ title: 'Refresh Items', state: 'running', text: 'Refreshing…', progress: 'indeterminate' });
    expect(result.current.operation?.actions).toBeUndefined();
    expect(result.current.announcement).toBe('Refreshing Items');
  });

  it('holds "Refreshing…" for at least 700 ms even when the read is instant (plan 1.4), then says "Updated"', async () => {
    expect(FELT_MS).toBe(700);
    const { result } = setup(instant);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FELT_MS - 1);
    });
    expect(result.current.operation).toMatchObject({ state: 'running', text: 'Refreshing…' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.operation).toMatchObject({ title: 'Refresh Items', state: 'succeeded', text: 'Updated' });
    expect(result.current.felt).toBe(false);
    expect(result.current.announcement).toBe('Items refreshed');
  });

  it('says "Updated" as soon as a slow read ends: the felt time is a floor, not an extra wait', async () => {
    const read = deferred();
    const { result } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.operation).toMatchObject({ state: 'running' });
    await act(async () => {
      read.end();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.operation).toMatchObject({ state: 'succeeded', text: 'Updated' });
  });

  it('ignores a second ask while one is felt: one read, one acknowledgement', () => {
    const read = deferred();
    const refresh = vi.fn(read.read);
    const { result } = setup(refresh);
    act(() => {
      result.current.ask();
      result.current.ask();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears when it is dismissed, by the Dismiss button or by the presenter\'s own clock', async () => {
    const { result } = setup(instant);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    expect(result.current.operation?.onDismiss).toBeTypeOf('function');
    act(() => {
      result.current.operation?.onDismiss?.();
    });
    expect(result.current.operation).toBeNull();
    expect(result.current.announcement).toBe('');
  });

  it('can be asked again once it is over', async () => {
    const refresh = vi.fn(instant);
    const { result } = setup(refresh);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    act(() => {
      result.current.ask();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.operation).toMatchObject({ state: 'running' });
  });

  it('does not claim "Updated" when the source failed by the time the read ended', async () => {
    const read = deferred();
    const { result, rerender } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    rerender({ failed: true });
    await act(async () => {
      read.end();
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    expect(result.current.operation).toBeNull();
    expect(result.current.announcement).toBe('');
  });

  it('leaves no timer and no update behind when the page goes away mid-refresh', async () => {
    const read = deferred();
    const { result, unmount } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    unmount();
    await act(async () => {
      read.end();
      await vi.advanceTimersByTimeAsync(FELT_MS * 2);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
