import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTablist } from './tablist';

// The DOM side of the strips' one tab stop (the rule of what a key does is core/tablist.test.ts): here, the wheel. It scrolls a strip sideways as it does a browser's tab bar, and a strip
// whose tabs come after it mounted (the panel's tools, which a plugin brings when it loads) must get that too.

function Strip({ ids }: { readonly ids: readonly string[] }) {
  const { ref, stop, handlers } = useTablist({ ids, selected: ids[0] ?? null });
  if (ids.length === 0) {
    return null;
  }

  return (
    <div ref={ref} role="tablist" aria-label="Tabs" {...handlers}>
      {ids.map((id) => (
        <button key={id} type="button" role="tab" data-tab-id={id} tabIndex={id === stop ? 0 : -1}>
          {id}
        </button>
      ))}
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
