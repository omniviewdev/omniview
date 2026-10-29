import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TextCell from './TextCell';
import * as time from '@/utils/time';

// Opt-in deterministic scheduler/DOM smoke, not native CPU or real-cluster data.
// Run the same entry against preserved baseline source with AGE_CLOCK_BASELINE=1.
const enabled = process.env.AGE_CLOCK_BENCH === '1';
const baseline = process.env.AGE_CLOCK_BASELINE === '1';
let hidden = false;
let callbacks = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 0, 15, 12));
  hidden = false;
  callbacks = 0;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  // These instrument browser timers, not Node's overloaded timer signatures.
  const browserWindow: Window = window;
  const timeout = window.setTimeout.bind(window);
  const interval = window.setInterval.bind(window);
  vi.spyOn(browserWindow, 'setTimeout').mockImplementation((callback, delay, ...args) => timeout(() => {
    callbacks++;
    if (typeof callback === 'function') {
      callback(...args);
    }
  }, delay));
  vi.spyOn(browserWindow, 'setInterval').mockImplementation((callback, delay, ...args) => interval(() => {
    callbacks++;
    if (typeof callback === 'function') {
      callback(...args);
    }
  }, delay));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.skipIf(!enabled)('actual age cell scheduler smoke', () => {
  it.each([300, 3000])('records %i real cells across visible, hidden and resume phases', (count) => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const format = vi.spyOn(time, 'formatTimeDifference');
    const values = Array.from({ length: count }, (_, index) => (
      new Date(Date.now() - (index < count / 2 ? 5000 : 5 * 86_400_000)).toISOString()
    ));
    const mountStart = performance.now();
    const view = render(<>{values.map((value, index) => <TextCell key={index} formatter="age" value={value} />)}</>);
    const mountMs = performance.now() - mountStart;
    expect(view.container.textContent).toBe('5s'.repeat(count / 2) + '5d'.repeat(count / 2));
    const activeTimers = vi.getTimerCount();
    const visibilityListeners = add.mock.calls.filter(([event]) => event === 'visibilitychange').length;
    callbacks = 0;
    format.mockClear();
    const visibleStart = performance.now();
    act(() => {
      vi.advanceTimersByTime(10_000); 
    });
    const visibleMs = performance.now() - visibleStart;
    const visibleCallbacks = callbacks;
    const visibleFormats = format.mock.calls.length;
    expect(view.container.textContent).toBe('15s'.repeat(count / 2) + '5d'.repeat(count / 2));

    act(() => {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenTimers = vi.getTimerCount();
    callbacks = 0;
    format.mockClear();
    const hiddenStart = performance.now();
    act(() => {
      vi.advanceTimersByTime(60_000); 
    });
    const hiddenMs = performance.now() - hiddenStart;
    const hiddenCallbacks = callbacks;
    const hiddenFormats = format.mock.calls.length;
    if (baseline) {
      expect(activeTimers).toBe(count);
      expect(visibleCallbacks).toBe(count * 10);
      expect(visibleFormats).toBe(count * 10);
      expect(visibilityListeners).toBe(0);
      expect(hiddenTimers).toBe(count);
      expect(hiddenCallbacks).toBe(count * 60);
      expect(hiddenFormats).toBe(count * 60);
    } else {
      expect(activeTimers).toBe(1);
      expect(visibleCallbacks).toBe(10);
      expect(visibleFormats).toBe(count * 5);
      expect(visibilityListeners).toBe(1);
      expect(hiddenTimers).toBe(0);
      expect(hiddenCallbacks).toBe(0);
      expect(hiddenFormats).toBe(0);
      expect(view.container.textContent).toBe('15s'.repeat(count / 2) + '5d'.repeat(count / 2));
    }

    act(() => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(view.container.textContent).toBe('1m15s'.repeat(count / 2) + '5d'.repeat(count / 2));
    const scheduledBeforeUnmount = vi.mocked(window.setTimeout).mock.calls.length;
    const unmountStart = performance.now();
    view.unmount();
    const unmountMs = performance.now() - unmountStart;
    const unmountSchedules = vi.mocked(window.setTimeout).mock.calls.length - scheduledBeforeUnmount;
    expect(vi.getTimerCount()).toBe(0);
    expect(unmountSchedules).toBe(0);
    if (!baseline) {
      expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1);
    }

    console.info(JSON.stringify({
      source: baseline ? 'baseline' : 'shared-clock',
      environment: 'jsdom-fake-time-real-cells',
      count, activeTimers, visibilityListeners, mountMs,
      visibleMs, visibleCallbacks, visibleFormats,
      hiddenTimers, hiddenMs, hiddenCallbacks, hiddenFormats,
      unmountMs, unmountSchedules,
    }));
  });
});
