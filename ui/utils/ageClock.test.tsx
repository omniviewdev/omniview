import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAge } from './ageClock';
import * as time from './time';

const start = new Date(2026, 0, 15, 12).getTime();
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();
let hidden = false;

function setHidden(value: boolean) {
  act(() => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('renderer age clock', () => {
  it.each([
    [999, '0s', 1, '1s'],
    [59_999, '59s', 1, '1m'],
    [60_999, '1m', 1, '1m1s'],
    [3_599_999, '59m59s', 1, '1h'],
    [3_659_999, '1h', 1, '1h1m'],
    [86_399_999, '23h59m', 1, '1d'],
    [172_799_999, '1d', 1, '2d'],
  ])('changes %ims at its displayed boundary', (age, before, advance, after) => {
    const value = ago(age as number);
    const { result, unmount } = renderHook(() => useAge(value));
    expect(result.current).toBe(before);
    act(() => vi.advanceTimersByTime(advance as number));
    expect(result.current).toBe(after);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.skipIf(Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/New_York')(
    'uses local full-day boundaries across skipped and repeated DST anniversaries',
    () => {
      vi.setSystemTime(new Date('2026-03-08T01:59:59.999-05:00'));
      const springValue = '2026-03-07T02:30:00-05:00';
      const spring = renderHook(() => useAge(springValue));
      expect(spring.result.current).toBe('23h29m');
      act(() => vi.advanceTimersByTime(1));
      expect(spring.result.current).toBe('1d');
      spring.unmount();

      vi.setSystemTime(new Date('2026-11-01T01:59:59.999-04:00'));
      const fallValue = '2026-10-31T01:30:00-04:00';
      const fall = renderHook(() => useAge(fallValue));
      expect(fall.result.current).toBe('1d');
      act(() => vi.advanceTimersByTime(1));
      expect(fall.result.current).toBe('24h30m');
      act(() => vi.advanceTimersByTime(30 * 60_000));
      expect(fall.result.current).toBe('1d');
    },
  );

  it('updates timestamps during render, including invalid and missing values', () => {
    const { result, rerender } = renderHook(({ value }) => useAge(value), {
      initialProps: { value: ago(3000) },
    });
    expect(result.current).toBe('3s');
    rerender({ value: ago(3_660_000) });
    expect(result.current).toBe('1h1m');
    rerender({ value: 'not-a-date' });
    expect(result.current).toBe('0s');
    expect(vi.getTimerCount()).toBe(0);
    rerender({ value: '' });
    expect(result.current).toBe('0s');
    rerender({ value: ago(5000) });
    expect(result.current).toBe('5s');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('treats numeric epoch zero as valid and empty timestamps as missing', () => {
    vi.setSystemTime(59_999);
    const { result, rerender } = renderHook(({ value }) => useAge(value), {
      initialProps: { value: 0 as string | number | Date | null | undefined },
    });
    expect(result.current).toBe('59s');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('1m');
    rerender({ value: new Date(0) });
    expect(result.current).toBe('1m');
    for (const value of [null, undefined, '']) {
      rerender({ value });
      expect(result.current).toBe('0s');
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('preserves negative-second truncation without spinning at future boundaries', () => {
    const timestamp = new Date(start + 2000).toISOString();
    const { result } = renderHook(() => useAge(timestamp));
    expect(result.current).toBe('-2s');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('-1s');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe('0s');
    act(() => vi.advanceTimersByTime(1998));
    expect(result.current).toBe('0s');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('1s');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('freezes hidden cells, resumes immediately, and detaches its sole listener', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const value = ago(5000);
    const { result, unmount } = renderHook(() => useAge(value));
    expect(added.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    const format = vi.spyOn(time, 'formatTimeDifference');
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe('5s');
    expect(format).not.toHaveBeenCalled();
    setHidden(false);
    expect(result.current).toBe('1m5s');
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
  });

  it('starts hidden without a timer and handles Strict Mode cleanup and remounts', () => {
    hidden = true;
    const value = ago(3_600_000);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    );
    const first = renderHook(() => useAge(value), { wrapper });
    expect(first.result.current).toBe('1h');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    setHidden(false);
    expect(first.result.current).toBe('1h1m');
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    const second = renderHook(() => useAge(value), { wrapper });
    expect(second.result.current).toBe('1h2m');
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not format or rerender an old label on a young cell tick', () => {
    const oldValue = ago(5 * 86_400_000);
    let oldRenders = 0;
    const old = renderHook(() => {
      oldRenders++;
      return useAge(oldValue);
    });
    const youngValue = ago(5000);
    const young = renderHook(() => useAge(youngValue));
    const renders = oldRenders;
    const format = vi.spyOn(time, 'formatTimeDifference');
    act(() => vi.advanceTimersByTime(1000));
    expect(old.result.current).toBe('5d');
    expect(young.result.current).toBe('6s');
    expect(oldRenders).toBe(renders);
    expect(format).toHaveBeenCalledTimes(1);
  });

  it.each([300, 3000])('bounds %i mounted subscribers to one timer and listener', (count) => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const value = ago(5000);
    function Cell() {
      return <span>{useAge(value)}</span>;
    }
    const view = render(<>{Array.from({ length: count }, (_, index) => <Cell key={index} />)}</>);
    expect(view.container.textContent).toBe('5s'.repeat(count));
    expect(vi.getTimerCount()).toBe(1);
    expect(added.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(view.container.textContent).toBe('6s'.repeat(count));
    expect(vi.getTimerCount()).toBe(1);
    setHidden(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.container.textContent).toBe('6s'.repeat(count));
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(view.container.textContent).toBe('1m6s'.repeat(count));
    const scheduled = vi.spyOn(window, 'setTimeout');
    view.unmount();
    expect(scheduled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
  });
});
