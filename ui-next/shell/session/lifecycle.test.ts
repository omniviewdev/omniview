import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLifecycle } from './lifecycle';

// When the page goes away or is hidden, what is pending must be written: the quiet time of the saver is a wait the window may not live to see out. A hidden page covers the main window that
// hides when it closes (the app keeps running), minimising, and a tab put away; `pagehide` covers a reload and a page that is torn down.

const visibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
};

afterEach(() => {
  visibility('visible');
});

describe('the browser\'s lifecycle', () => {
  it('tells its listener when the page is hidden and when it is going away, and not when it is shown again', () => {
    const heard = vi.fn();
    const stop = browserLifecycle().onHide(heard);

    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).toHaveBeenCalledTimes(1);

    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops listening when the function it returned is called', () => {
    const heard = vi.fn();
    browserLifecycle().onHide(heard)();
    window.dispatchEvent(new Event('pagehide'));
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).not.toHaveBeenCalled();
  });
});
