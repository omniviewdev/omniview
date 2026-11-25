import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FELT_MS, REFRESH_LIMIT_MS, useRefreshFeedback } from './useRefreshFeedback';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A read that is over at once. */
const instant = async (): Promise<void> => undefined;

/** A read that ends when the test says so, either way. */
type Deferred = { readonly read: () => Promise<void>; readonly end: () => void; readonly fail: (reason: unknown) => void };

function deferred(): Deferred {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  return { read: async () => promise, end: resolve, fail: reject };
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

describe('useRefreshFeedback: a read that rejects, or never settles (S3)', () => {
  // The contract says a source's `refresh` resolves when the read is over and never rejects, and a plugin's may do either of what it says it does not, or never answer: the hook is the one place that bounds it, for every page that draws it. Until
  // this was bounded the header said "Refreshing…" and the command stayed unavailable for as long as the page was open, and a rejection was an unhandled one.
  // The plugin's own words are the log's: the page says what it says in its own.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits thirty seconds for a read: as long as the host waits for a plugin\'s bundle, and the person has no way to cancel it', () => {
    expect(REFRESH_LIMIT_MS).toBe(30_000);
  });

  it('says "Refresh did not finish", with a Retry, when the read rejects, at once, and the command is available again', async () => {
    const read = deferred();
    const { result } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    expect(result.current.felt).toBe(true);
    await act(async () => {
      read.fail(new Error('the read failed'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.felt).toBe(false);
    expect(result.current.operation).toMatchObject({ title: 'Refresh Items', state: 'failed', text: 'Refresh did not finish' });
    expect(result.current.operation?.actions).toMatchObject([{ id: 'retry', label: 'Retry', kind: 'retry' }]);
    expect(result.current.announcement).toBe('Items did not refresh');
    expect(vi.getTimerCount()).toBe(0);
    expect(console.error).toHaveBeenCalledWith('[page] the refresh of Items was rejected', expect.any(Error));
  });

  it('says it the same way when the read throws before it returns a promise', async () => {
    const { result } = setup(() => {
      throw new Error('the read failed');
    });
    await act(async () => {
      result.current.ask();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.felt).toBe(false);
    expect(result.current.operation).toMatchObject({ state: 'failed', text: 'Refresh did not finish' });
    expect(console.error).toHaveBeenCalledWith('[page] the refresh of Items threw', expect.any(Error));
  });

  it('takes a read that returns no promise for a read that is over, as an instant one is: felt, then updated', async () => {
    const { result } = setup((() => undefined) as unknown as () => Promise<void>);
    await act(async () => {
      result.current.ask();
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });

    expect(result.current.operation).toMatchObject({ state: 'succeeded', text: 'Updated' });
  });

  it('gives up on a read that never settles after thirty seconds: says that it did not finish, with a Retry, and the command is available again', async () => {
    const read = deferred();
    const { result } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS - 1);
    });
    expect(result.current.felt).toBe(true);
    expect(result.current.operation).toMatchObject({ state: 'running', text: 'Refreshing…' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.felt).toBe(false);
    expect(result.current.operation).toMatchObject({ title: 'Refresh Items', state: 'failed', text: 'Refresh did not finish' });
    expect(result.current.operation?.actions).toMatchObject([{ id: 'retry', label: 'Retry', kind: 'retry' }]);
    expect(result.current.announcement).toBe('Items did not refresh');
    expect(vi.getTimerCount()).toBe(0);
    expect(console.error).toHaveBeenCalledWith('[page] the refresh of Items did not answer in 30 s');
  });

  it('does not give up on a read that answers in time, however long it took: it is updated as a slow read is', async () => {
    const read = deferred();
    const { result } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS - 1);
      read.end();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.operation).toMatchObject({ state: 'succeeded', text: 'Updated' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS * 2);
    });
    expect(result.current.operation).toMatchObject({ state: 'succeeded' });
  });

  it('asks the read again on Retry, and says "Refreshing…" again', async () => {
    const refresh = vi.fn(deferred().read);
    const { result } = setup(refresh);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
    });
    expect(result.current.operation).toMatchObject({ state: 'failed' });

    act(() => {
      result.current.operation?.actions?.[0]?.onSelect();
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.felt).toBe(true);
    expect(result.current.operation).toMatchObject({ state: 'running', text: 'Refreshing…' });
  });

  it('is put away with Dismiss, and the command can be asked again', async () => {
    const refresh = vi.fn(deferred().read);
    const { result } = setup(refresh);
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
    });
    act(() => {
      result.current.operation?.onDismiss?.();
    });
    expect(result.current.operation).toBeNull();
    expect(result.current.announcement).toBe('');

    act(() => {
      result.current.ask();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  /** A read that is answered by the next of `reads`, one for each ask. */
  function serial(reads: readonly Deferred[]) {
    let asks = 0;
    return vi.fn(async () => {
      const mine = reads[asks];
      asks += 1;
      await mine?.read();
    });
  }

  it('is not told by the late answer of a read it gave up on: what was said stays said', async () => {
    const reads = [deferred()];
    const { result } = setup(serial(reads));
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
    });
    expect(result.current.operation).toMatchObject({ state: 'failed' });

    await act(async () => {
      reads[0]?.end();
      await vi.advanceTimersByTimeAsync(FELT_MS * 2);
    });

    expect(result.current.operation).toMatchObject({ state: 'failed', text: 'Refresh did not finish' });
    expect(result.current.felt).toBe(false);
  });

  it('does not let the late answer of the first read end the second: one read, one acknowledgement', async () => {
    const reads = [deferred(), deferred()];
    const { result } = setup(serial(reads));
    act(() => {
      result.current.ask();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
    });
    act(() => {
      result.current.ask();
    });
    expect(result.current.operation).toMatchObject({ state: 'running', text: 'Refreshing…' });

    // The first read answers now, and fails: the second is still the one that is waited for.
    await act(async () => {
      reads[0]?.fail(new Error('late'));
      await vi.advanceTimersByTimeAsync(FELT_MS * 2);
    });
    expect(result.current.operation).toMatchObject({ state: 'running', text: 'Refreshing…' });

    await act(async () => {
      reads[1]?.end();
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    expect(result.current.operation).toMatchObject({ state: 'succeeded', text: 'Updated' });
  });

  it('leaves no timer behind when the page goes away while it waits for a read that never settles', () => {
    const { result, unmount } = setup(deferred().read);
    act(() => {
      result.current.ask();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says nothing when the page goes away before the read rejects', async () => {
    const read = deferred();
    const { result, unmount } = setup(read.read);
    act(() => {
      result.current.ask();
    });
    unmount();
    await act(async () => {
      read.fail(new Error('late'));
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
