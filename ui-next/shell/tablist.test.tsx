import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DragOut } from './core/tabs';
import { useTablist } from './tablist';

// The DOM side of the strips' one tab stop (the rule of what a key does is core/tablist.test.ts): here, the wheel. It scrolls a strip sideways as it does a browser's tab bar, and a strip
// whose tabs come after it mounted (the panel's tools, which a plugin brings when it loads) must get that too.

function Strip({ ids, onMove, onDragOut }: { readonly ids: readonly string[]; readonly onMove?: (id: string, to: number, pinned?: boolean) => boolean; readonly onDragOut?: (id: string) => DragOut }) {
  const { ref, stop, handlers } = useTablist({ ids, selected: ids[0] ?? null, onMove, onDragOut });
  if (ids.length === 0) {
    return null;
  }

  return (
    <div data-shell-part="window">
      <div ref={ref} role="tablist" aria-label="Tabs" {...handlers}>
        {ids.map((id) => (
          <button key={id} type="button" role="tab" data-tab-id={id} tabIndex={id === stop ? 0 : -1}>
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}

/** jsdom lays nothing out: a strip wider than its room, as a browser would draw one with many tabs. */
function overflowing(strip: HTMLElement): void {
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 500 });
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 100 });
}

const stripOf = (container: HTMLElement): HTMLElement => {
  const strip = container.querySelector<HTMLElement>('[role="tablist"]');
  if (strip === null) {
    throw new Error('no strip is drawn');
  }

  overflowing(strip);
  return strip;
};

/** A wheel turned over the strip, and the event it was, so a test can ask whether the strip took it. */
function turn(strip: HTMLElement, init: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true, ...init });
  strip.dispatchEvent(event);
  return event;
}

afterEach(cleanup);

describe('the wheel over a strip of tabs', () => {
  it('scrolls the strip sideways, and the page does not scroll with it', () => {
    const { container } = render(<Strip ids={['a', 'b', 'c']} />);
    const strip = stripOf(container);
    const event = turn(strip);
    expect(event.defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(40);
  });

  // The strip is not drawn while it has no tab, so there is no scroller for the listener to bind to when the hook first runs (CodeRabbit, tablist.ts:110).
  it('scrolls a strip whose tabs came after it mounted', () => {
    const { container, rerender } = render(<Strip ids={[]} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    rerender(<Strip ids={['a', 'b', 'c']} />);
    const strip = stripOf(container);
    const event = turn(strip);
    expect(event.defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(40);
  });

  it('is taken once, not once for every time the strip appeared: a strip that emptied and filled again scrolls by one turn', () => {
    const { container, rerender } = render(<Strip ids={['a']} />);
    rerender(<Strip ids={[]} />);
    rerender(<Strip ids={['a', 'b']} />);
    rerender(<Strip ids={['a', 'b', 'c']} />);
    const strip = stripOf(container);
    turn(strip);
    expect(strip.scrollLeft).toBe(40);
  });

  it('leaves alone what is not the strip\'s: a pinch zoom, a turn that is mostly sideways, a strip that fits its room', () => {
    const { container } = render(<Strip ids={['a', 'b', 'c']} />);
    const strip = stripOf(container);
    expect(turn(strip, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(turn(strip, { deltaX: 80, deltaY: 10 }).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(0);
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 100 });
    expect(turn(strip).defaultPrevented).toBe(false);
  });
});

describe('the pointer dragging a tab', () => {
  // jsdom lays nothing out, so every face is at x = 0 and the place a drop asks for is the start of the strip.
  const pointer = (x: number, y = 10) => ({ pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
  /** Presses on the tab `c`, travels past the threshold (to `y`: 10 is in the strip) and waits for the frame that draws the drag; the release is the test's. */
  async function drag(container: HTMLElement, y?: number) {
    const strip = stripOf(container);
    fireEvent.pointerDown(within(strip).getByRole('tab', { name: 'c' }), pointer(300));
    fireEvent.pointerMove(strip, pointer(320, y));
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => {
        resolve();
      });
      await promise;
    });

    return strip;
  }

  it('ends in onMove, the callback the keyboard asks, with the place the tab is dropped at', async () => {
    const onMove = vi.fn(() => true);
    const { container } = render(<Strip ids={['a', 'b', 'c']} onMove={onMove} />);

    const strip = await drag(container);
    expect(container.querySelector('[data-shell-part="window"]')).toHaveAttribute('data-tab-dragging');
    fireEvent.pointerUp(strip, pointer(320));

    expect(onMove.mock.calls).toEqual([['c', 0, undefined]]);
  });

  it('asks the onMove of the render it is dropped in, not the one the strip was bound with', async () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const { container, rerender } = render(<Strip ids={['a', 'b', 'c']} onMove={first} />);
    rerender(<Strip ids={['a', 'b', 'c']} onMove={second} />);

    const strip = await drag(container);
    fireEvent.pointerUp(strip, pointer(320));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('asks the onDragOut of the render the pointer first goes out of the strip in for the way out, and drops through it at the point of the release', async () => {
    const drop = vi.fn();
    const way = () => ({ move: vi.fn(), drop, cancel: vi.fn() });
    const first = vi.fn(way);
    const second = vi.fn(way);
    const { container, rerender } = render(<Strip ids={['a', 'b', 'c']} onMove={() => true} onDragOut={first} />);
    rerender(<Strip ids={['a', 'b', 'c']} onMove={() => true} onDragOut={second} />);

    const strip = await drag(container, 40);
    fireEvent.pointerUp(strip, pointer(320, 40));

    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([['c']]);
    expect(drop.mock.calls).toEqual([[320, 40]]);
  });

  it('does not drag a strip that cannot move a tab, such as the panel\'s session strip: nothing is drawn and nothing is asked', async () => {
    const { container } = render(<Strip ids={['a', 'b', 'c']} />);

    await drag(container);

    expect(container.querySelector('[data-tab-dragging], [data-dragging], [data-shell-part="tabDrag"]')).toBeNull();
  });
});
