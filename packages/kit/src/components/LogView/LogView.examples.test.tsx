// The examples of the log view as the parts page meets them. The page mounts every example in one commit, and ExampleStage mounts what an example holds only when it comes near
// the screen: the feed an example reads from, and what it does to the feed, must start with the view and not with the page, or what an example SHOWS depends on how long it
// waited offscreen (a pause that came before the view read anything, a gap reported before the first lines were read, a 20,000-line fixture nobody looked at).
import { act, render, type RenderResult } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as examples from './LogView.examples';
import * as parity from './LogView.parity.examples';
import { SyntheticFeed } from './syntheticFeed';

const LIST = { height: 625, header: 25, row: 24 };
const isList = (element: Element) => element.getAttribute('role') === 'grid';
const isProbe = (element: Element) => element.getAttribute('aria-hidden') === 'true' && element.parentElement !== null && isList(element.parentElement);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
    return isList(this) ? LIST.height : 0;
  } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: function get(this: HTMLElement) {
    return this.getAttribute('aria-rowindex') === '1' ? LIST.header : 0;
  } });
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const height = isProbe(this) ? LIST.row : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
  };
});

/** The observers the stage made, each with the callback it was given: the page decides when one intersects. */
const observers: Array<{ readonly callback: IntersectionObserverCallback; readonly observer: IntersectionObserver }> = [];

beforeEach(() => {
  observers.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        // The observer the callback is handed back is this one, as it is in a browser.
        observers.push({ callback, observer: this as unknown as IntersectionObserver });
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Time passes, a frame at a time: the page is scrolled in no frame of it. */
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** The reader scrolls to the example: its stage comes near the screen and mounts what it holds. */
const scrollToIt = () => {
  const entry: IntersectionObserverEntry = {
    isIntersecting: true,
    intersectionRatio: 1,
    target: document.body,
    time: 0,
    rootBounds: null,
    boundingClientRect: document.body.getBoundingClientRect(),
    intersectionRect: document.body.getBoundingClientRect(),
  };
  act(() => {
    for (const { callback, observer } of observers) {
      callback([entry], observer);
    }
  });
};

const strip = (view: RenderResult) => view.getByRole('group', { name: 'Session status' }).textContent ?? '';
const rowKinds = (view: RenderResult) => [...view.container.querySelectorAll('[role="row"][data-n]')].map((row) => row.getAttribute('data-ov-kind') ?? 'line');

describe('an example nobody has scrolled to', () => {
  it('makes no feed for ManyLines and starts no stream for Streaming: the page mounts every example, and an offscreen one holds nothing', () => {
    const emit = vi.spyOn(SyntheticFeed.prototype, 'emit');
    const start = vi.spyOn(SyntheticFeed.prototype, 'start');
    const many = render(<examples.ManyLines />);
    const streaming = render(<examples.Streaming />);
    wait(2000);
    expect(emit).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(many.container.querySelector('[role="grid"]')).toBeNull();

    scrollToIt();
    expect(emit).toHaveBeenCalledWith(20_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(streaming.container.querySelector('[role="grid"]')).not.toBeNull();
  });

  it('stops the stream of Streaming when it unmounts', () => {
    const stop = vi.spyOn(SyntheticFeed.prototype, 'stop');
    const view = render(<examples.Streaming />);
    scrollToIt();
    stop.mockClear();
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});

describe('what an example shows does not depend on how long it waited offscreen', () => {
  it('Paused shows its first 120 lines and holds the 340 that came after the pause', () => {
    const view = render(<examples.Paused />);
    // Far longer than any timer the example might have started with the page.
    wait(5000);
    scrollToIt();
    wait(1000);
    expect(strip(view)).toContain('120 lines');
    expect(strip(view)).toContain('Paused, 340 new lines waiting');
    expect(rowKinds(view).length).toBeGreaterThan(20);
  });

  it('DroppedLines puts the marker between its first 12 lines and its last 5', () => {
    const view = render(<examples.DroppedLines />);
    wait(5000);
    scrollToIt();
    wait(1000);
    expect(rowKinds(view)).toEqual([...Array.from({ length: 12 }, () => 'line'), 'gap', ...Array.from({ length: 5 }, () => 'line')]);
  });

  it('the same two examples show the same when the reader is already there as the page loads', () => {
    // The stage mounts at once when the example is on screen at load (the observer reports it in the same turn): the order of things is the same.
    const paused = render(<examples.Paused />);
    scrollToIt();
    wait(1000);
    expect(strip(paused)).toContain('Paused, 340 new lines waiting');
    const dropped = render(<examples.DroppedLines />);
    scrollToIt();
    wait(1000);
    expect(rowKinds(dropped)).toContain('gap');
  });
});

describe('the fixtures of the log parity probe', () => {
  // packages/kit/probes/log-probe.mjs stages these three at the size of the mock's Logs tool and compares them with the mock's own measurement of the same lines.
  it('mount nothing until they come near the screen, as every example does, and then hold the 90, 110 and 100 lines of the mock\'s three scenarios', () => {
    const emit = vi.spyOn(SyntheticFeed.prototype, 'push');
    const views = [render(<parity.List />), render(<parity.Find />), render(<parity.Keys />)];
    wait(2000);
    expect(emit).not.toHaveBeenCalled();
    for (const view of views) {
      expect(view.container.querySelector('[role="grid"]')).toBeNull();
    }

    scrollToIt();
    wait(1000);
    expect(views.map((view) => view.container.querySelector('[role="grid"]')?.getAttribute('aria-rowcount'))).toEqual(['91', '111', '101']);
  });

  it('end the way the mock\'s list does: following, with the newest line last (a level cycle of ten, `request` on every third line)', () => {
    const view = render(<parity.List />);
    scrollToIt();
    wait(1000);
    expect(strip(view)).toContain('Following');
    const rows = [...view.container.querySelectorAll('[role="row"][data-n]')];
    const last = rows.at(-1);
    // Line 90 (index 89): 89 is not a multiple of three, and 89 % 10 = 9, an info line.
    expect(last?.querySelector('[role="gridcell"]:last-child')?.textContent).toBe('worker 4 reconciled 89 objects');
    expect(last?.getAttribute('data-ov-level')).toBe('info');
    expect(rows.at(-2)?.getAttribute('data-ov-level')).toBe('debug');
    expect(rows.at(-3)?.querySelector('[role="gridcell"]:last-child')?.textContent).toBe('request 87 served in 79 ms');
  });
});
