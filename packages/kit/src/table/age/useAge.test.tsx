import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Profiler, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactAge } from './formatAge';
import { useAge } from './useAge';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const start = Date.UTC(2026, 10, 16, 14, 3, 0);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let hidden = false;

function setHidden(value: boolean) {
  act(() => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The visibilitychange listeners that are attached now: adds minus removes. */
function trackListeners() {
  const attached = new Set<EventListenerOrEventListenerObject>();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange' && listener) {
      attached.add(listener);
    }

    add(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange' && listener) {
      attached.delete(listener);
    }

    remove(type, listener, options);
  });
  return attached;
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

describe('useAge', () => {
  it('reads the label from the formatter, and changes at the boundary', () => {
    const value = ago(59_500);
    const { result, unmount } = renderHook(() => useAge(value, compactAge));
    expect(result.current).toBe('59s');
    advance(499);
    expect(result.current).toBe('59s');
    advance(1);
    expect(result.current).toBe('1m');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes a string, a number or a Date, and treats epoch zero as a value', () => {
    vi.setSystemTime(2 * MINUTE);
    const { result, rerender } = renderHook(({ value }) => useAge(value, compactAge), {
      initialProps: { value: 0 as string | number | Date | null | undefined },
    });
    expect(result.current).toBe('2m');
    rerender({ value: new Date(0) });
    expect(result.current).toBe('2m');
    rerender({ value: new Date(0).toISOString() });
    expect(result.current).toBe('2m');
  });

  it('reads an empty or invalid value as an empty label and subscribes to nothing', () => {
    const tracked = trackListeners();
    for (const value of [null, undefined, '', 'not-a-date', Number.NaN, new Date(Number.NaN)]) {
      const { result, unmount } = renderHook(() => useAge(value, compactAge));
      expect(result.current).toBe('');
      expect(vi.getTimerCount()).toBe(0);
      expect(tracked.size).toBe(0);
      unmount();
    }
  });

  it('follows its value: a new timestamp, then a missing one, then a timestamp again', () => {
    const { result, rerender } = renderHook<string, { readonly value: string | null }>(({ value }) => useAge(value, compactAge), {
      initialProps: { value: ago(3000) },
    });
    expect(result.current).toBe('3s');
    rerender({ value: ago(3_660_000) });
    expect(result.current).toBe('1h');
    rerender({ value: null });
    expect(result.current).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    rerender({ value: ago(5000) });
    expect(result.current).toBe('5s');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reads a timestamp in the future as "in ..."', () => {
    const value = new Date(Date.now() + 5 * MINUTE).toISOString();
    const { result } = renderHook(() => useAge(value, compactAge));
    expect(result.current).toBe('in 5m');
    advance(1);
    expect(result.current).toBe('in 4m');
  });

  it('freezes hidden cells, resumes at once, and detaches its sole listener', () => {
    const tracked = trackListeners();
    const value = ago(5000);
    const { result, unmount } = renderHook(() => useAge(value, compactAge));
    expect(tracked.size).toBe(1);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    advance(10 * MINUTE);
    expect(result.current).toBe('5s');
    setHidden(false);
    expect(result.current).toBe('10m');
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(tracked.size).toBe(0);
  });

  it('starts hidden without a timer, and survives Strict Mode cleanup and remounts', () => {
    hidden = true;
    const value = ago(3_600_000);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const first = renderHook(() => useAge(value, compactAge), { wrapper });
    expect(first.result.current).toBe('1h');
    expect(vi.getTimerCount()).toBe(0);
    advance(MINUTE);
    setHidden(false);
    expect(first.result.current).toBe('1h');
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const second = renderHook(() => useAge(value, compactAge), { wrapper });
    expect(second.result.current).toBe('1h');
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-2, 2])('refreshes old labels after a %i-day clock jump, within a minute', (days) => {
    const value = ago(5 * DAY);
    const { result } = renderHook(() => useAge(value, compactAge));
    expect(result.current).toBe('5d');
    act(() => {
      vi.setSystemTime(start + days * DAY);
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(days < 0 ? '3d' : '7d');
    expect(vi.getTimerCount()).toBe(1);
  });
});

function Cell({ value, id }: { readonly value: string; readonly id?: string | undefined }) {
  return <span data-id={id}>{useAge(value, compactAge)}</span>;
}

describe('useAge: many cells', () => {
  it.each([300, 3000])('bounds %i mounted cells to one timer and one visibilitychange listener', (count) => {
    const tracked = trackListeners();
    const value = ago(5000);
    const view = render(<>{Array.from({ length: count }, (_, index) => <Cell key={index} value={value} />)}</>);
    expect(view.container.textContent).toBe('5s'.repeat(count));
    expect(vi.getTimerCount()).toBe(1);
    expect(tracked.size).toBe(1);
    advance(SECOND);
    expect(view.container.textContent).toBe('6s'.repeat(count));
    expect(vi.getTimerCount()).toBe(1);
    setHidden(true);
    advance(MINUTE);
    expect(view.container.textContent).toBe('6s'.repeat(count));
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(view.container.textContent).toBe('1m'.repeat(count));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(tracked.size).toBe(0);
  });

  it('ten visible seconds of second-counting labels cost at most ten timer callbacks', () => {
    const value = ago(5000);
    render(<>{Array.from({ length: 3000 }, (_, index) => <Cell key={index} value={value} />)}</>);
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    advance(10 * SECOND);
    expect(scheduled.mock.calls.length).toBeLessThanOrEqual(10);
    expect(scheduled.mock.calls.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('sleeps until the next minute boundary when every label counts minutes (the cadence follows the label)', () => {
    const value = ago(5 * MINUTE + 20 * SECOND);
    render(<>{Array.from({ length: 3000 }, (_, index) => <Cell key={index} value={value} />)}</>);
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    expect(vi.getTimerCount()).toBe(1);
    advance(39_999);
    expect(scheduled).not.toHaveBeenCalled();
    advance(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(scheduled.mock.calls[0]?.[1]).toBe(MINUTE);
  });

  it('sleeps at most a minute when every label counts days', () => {
    const value = ago(5 * DAY + 3000);
    const view = render(<Cell value={value} />);
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    advance(60_000);
    expect(view.container.textContent).toBe('5d');
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(scheduled.mock.calls[0]?.[1]).toBe(60_000);
  });

  it('has no timer while the document is hidden', () => {
    hidden = true;
    const value = ago(5000);
    render(<>{Array.from({ length: 50 }, (_, index) => <Cell key={index} value={value} />)}</>);
    expect(vi.getTimerCount()).toBe(0);
    advance(10 * MINUTE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders only the cells whose label changed on a tick', () => {
    const renders = { young: 0, old: 0, minutes: 0 };
    const count = (id: keyof typeof renders) => () => {
      renders[id]++;
    };

    const view = render(
      <>
        <Profiler id="young" onRender={count('young')}>
          <Cell value={ago(5000)} />
        </Profiler>
        <Profiler id="old" onRender={count('old')}>
          <Cell value={ago(5 * DAY)} />
        </Profiler>
        <Profiler id="minutes" onRender={count('minutes')}>
          <Cell value={ago(5 * MINUTE + 20 * SECOND)} />
        </Profiler>
      </>,
    );
    expect(view.container.textContent).toBe('5s5d5m');
    const before = { ...renders };
    advance(SECOND);
    expect(view.container.textContent).toBe('6s5d5m');
    expect(renders.young).toBe(before.young + 1);
    expect(renders.old).toBe(before.old);
    expect(renders.minutes).toBe(before.minutes);
    advance(40 * SECOND);
    expect(view.container.textContent).toBe('46s5d6m');
  });

  it('gives cells of the same timestamp one shared label source', () => {
    const value = ago(5000);
    const view = render(
      <>
        <Cell value={value} id="a" />
        <Cell value={value} id="b" />
      </>,
    );
    advance(SECOND);
    expect([...view.container.querySelectorAll('span')].map((node) => node.textContent)).toEqual(['6s', '6s']);
    expect(vi.getTimerCount()).toBe(1);
  });
});
