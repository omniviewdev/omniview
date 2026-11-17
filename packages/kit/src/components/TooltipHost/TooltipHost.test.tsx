import { act, cleanup, render } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipHost } from './TooltipHost';
import { GAP, MARGIN } from './placement';
import { tip } from './tip';

// jsdom has neither layout nor the Popover API, nor a reliable :focus-visible: the tests give the host what a browser would.
const shown = new WeakSet<Element>();
let focusVisible = true;
const realMatches = Element.prototype.matches;

beforeEach(() => {
  vi.useFakeTimers();
  focusVisible = true;
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    shown.add(this);
  };

  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    shown.delete(this);
  };

  Object.defineProperty(Element.prototype, 'matches', {
    configurable: true,
    writable: true,
    value: function matches(this: Element, selector: string) {
      if (selector === ':focus-visible') {
        return focusVisible && this === document.activeElement;
      }

      if (selector === ':hover') {
        return false;
      }

      return realMatches.call(this, selector);
    },
  });

  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Element.prototype.matches = realMatches;
});

const host = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="tooltip"]');
  if (element === null) {
    throw new Error('no tooltip host is mounted');
  }

  return element;
};

const isOpen = () => shown.has(host());
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** An element a test built: the lists the tests destructure are typed as possibly empty, and an empty one is a failure. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('the test expected an element that is not there');
  }

  return value;
}

/** A pointer event as the browser sends it: bubbling, with the element the pointer came from or goes to. */
function pointer(type: 'pointerover' | 'pointerout' | 'pointerdown', target: Element | undefined, relatedTarget: Element | null = null, pointerType = 'mouse') {
  act(() => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    defined(target).dispatchEvent(event);
  });
}

const hover = (target: Element | undefined, ms = 500) => {
  pointer('pointerover', target);
  advance(ms);
};

const leave = (target: Element | undefined, to: Element | null = null) => {
  pointer('pointerout', target, to);
};

const key = (name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

const focus = async (element: HTMLElement | undefined) => {
  act(() => {
    defined(element).focus();
  });
  await flush();
};

/** Layout for jsdom: where a trigger is, and how big the tooltip will be. */
function layout(element: Element | undefined, rect: { left: number; top: number; width: number; height: number }) {
  defined(element).getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect });
}

function measure(width: number, height: number) {
  Object.defineProperty(host(), 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(host(), 'offsetHeight', { configurable: true, value: height });
}

function mount(children: ReactNode = null) {
  const view = render(
    <>
      <TooltipHost />
      {children}
    </>,
  );
  measure(120, 34);
  return view;
}

describe('TooltipHost', () => {
  it('is one popover element with role tooltip, closed until a tip opens', () => {
    mount();
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    const element = host();
    expect(element.getAttribute('popover')).toBe('manual');
    expect(element.id).not.toBe('');
    expect(element.textContent).toBe('');
    expect(isOpen()).toBe(false);
    expect(element.hasAttribute('title')).toBe(false);
  });

  it('refuses a second host in the same window: there is one popup for the whole page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <>
          <TooltipHost />
          <TooltipHost />
        </>,
      ),
    ).toThrow(/one TooltipHost/i);
  });

  it('mounts again after it unmounted (a hot reload, a strict-mode effect)', () => {
    const first = render(<TooltipHost />);
    first.unmount();
    expect(() => render(<TooltipHost />)).not.toThrow();
  });

  describe('listeners', () => {
    it('are a handful on the document and the window, and 1,000 triggers add none', () => {
      const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
      const addWindow = vi.spyOn(window, 'addEventListener');
      const view = render(<TooltipHost />);
      const calls = [...add.mock.calls, ...addWindow.mock.calls];
      const mounted = calls.length;
      const types = new Set(calls.map(([type]) => type));
      expect(mounted).toBeGreaterThan(0);
      // React puts its own on its root when the root is made; the host adds its handful: events of the pointer, the keyboard and the window.
      for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'pointerdown', 'click', 'keydown', 'scroll', 'resize', 'blur']) {
        expect(types.has(type), type).toBe(true);
      }

      add.mockClear();
      addWindow.mockClear();
      const triggers = Array.from({ length: 1000 }, (_, index) => (
        <button key={index} type="button" {...tip(`Row ${index}`)}>
          {index}
        </button>
      ));
      view.rerender(
        <>
          <TooltipHost />
          {triggers}
        </>,
      );
      expect(document.querySelectorAll('[data-ov-tip]')).toHaveLength(1000);
      expect(add).not.toHaveBeenCalled();
      expect(addWindow).not.toHaveBeenCalled();
    });

    it('are all removed when the host unmounts, and a trigger then does nothing', () => {
      const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
      const addWindow = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
      const removeWindow = vi.spyOn(window, 'removeEventListener');
      const view = render(
        <>
          <TooltipHost />
          <button type="button" {...tip('Refresh list')}>
            Refresh
          </button>
        </>,
      );
      const added = [...add.mock.calls, ...addWindow.mock.calls].map(([type]) => type);
      view.rerender(
        <button type="button" {...tip('Refresh list')}>
          Refresh
        </button>,
      );
      for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'keydown', 'scroll', 'resize', 'blur']) {
        expect([...remove.mock.calls, ...removeWindow.mock.calls].some(([name]) => name === type), type).toBe(true);
        expect(added).toContain(type);
      }

      hover(document.querySelector('button')!);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });
  });

  describe('the delay', () => {
    it('opens 500 ms after the pointer reaches a trigger, with its text, as plain text', () => {
      mount(
        <button type="button" {...tip('<b>Refresh</b> list')}>
          Refresh
        </button>,
      );
      const trigger = document.querySelector('button')!;
      layout(trigger, { left: 400, top: 300, width: 100, height: 28 });
      pointer('pointerover', trigger);
      advance(499);
      expect(isOpen()).toBe(false);
      advance(1);
      expect(isOpen()).toBe(true);
      expect(host().textContent).toBe('<b>Refresh</b> list');
      expect(host().querySelector('b')).toBeNull();
    });

    it('is cancelled when the pointer leaves first', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      pointer('pointerover', trigger);
      advance(300);
      leave(trigger);
      advance(1000);
      expect(isOpen()).toBe(false);
    });

    it('is not restarted by the pointer moving between the children of one trigger', () => {
      mount(
        <button type="button" {...tip('Refresh list')}>
          <span>Re</span>
          <span>fresh</span>
        </button>,
      );
      const [first, second] = Array.from(document.querySelectorAll('span'));
      pointer('pointerover', first);
      advance(300);
      leave(first, second);
      pointer('pointerover', second);
      advance(200);
      expect(isOpen()).toBe(true);
    });

    it('starts again for every trigger: moving to another one closes the first at once and waits 500 ms for the second', () => {
      mount(
        <>
          <button type="button" {...tip('First')}>One</button>
          <button type="button" {...tip('Second')}>Two</button>
        </>,
      );
      const [one, two] = Array.from(document.querySelectorAll('button'));
      hover(one);
      expect(host().textContent).toBe('First');
      leave(one, two);
      pointer('pointerover', two);
      expect(isOpen()).toBe(false);
      advance(499);
      expect(isOpen()).toBe(false);
      advance(1);
      expect(host().textContent).toBe('Second');
    });

    it('is skipped by a trigger that asks (data-ov-tip-delay="0"): the tip is there at once', () => {
      mount(<button type="button" {...tip('Resources', { delay: 0 })}>R</button>);
      pointer('pointerover', document.querySelector('button')!);
      expect(isOpen()).toBe(true);
      expect(host().textContent).toBe('Resources');
    });

    it('ignores a touch: a finger has no hover', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      pointer('pointerover', document.querySelector('button')!, null, 'touch');
      advance(1000);
      expect(isOpen()).toBe(false);
    });

    it('shows nothing for a blank tip, and never draws a tip for an element with none', () => {
      mount(
        <>
          <button type="button" {...tip('')}>None</button>
          <button type="button">Plain</button>
          <button type="button" data-ov-tip="   ">Blank</button>
        </>,
      );
      for (const button of Array.from(document.querySelectorAll('button'))) {
        hover(button, 1000);
        expect(isOpen()).toBe(false);
        leave(button);
      }
    });
  });

  describe('the keyboard', () => {
    it('opens a tip at once when a trigger takes focus by keyboard, and closes it when focus leaves', async () => {
      mount(
        <>
          <button type="button" {...tip('Refresh list')}>Refresh</button>
          <button type="button">Other</button>
        </>,
      );
      const [refresh, other] = Array.from(document.querySelectorAll('button'));
      await focus(refresh);
      expect(isOpen()).toBe(true);
      expect(host().textContent).toBe('Refresh list');
      await focus(other);
      expect(isOpen()).toBe(false);
    });

    it('does not open for focus that is not :focus-visible (a click gave it)', async () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      focusVisible = false;
      await focus(document.querySelector('button')!);
      expect(isOpen()).toBe(false);
    });

    it('keeps the tip while the trigger is focused, though the pointer leaves it', async () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      await focus(trigger);
      leave(trigger);
      expect(isOpen()).toBe(true);
    });
  });

  describe('hovering the tip', () => {
    it('keeps it open while the pointer is on it, and closes it when the pointer leaves it', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      leave(trigger, host());
      pointer('pointerover', host());
      advance(1000);
      expect(isOpen()).toBe(true);
      leave(host(), document.body);
      expect(isOpen()).toBe(false);
    });

    it('lets the pointer come back from the tip to the trigger without closing it', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      leave(trigger, host());
      leave(host(), trigger);
      expect(isOpen()).toBe(true);
    });
  });

  describe('Escape (design 12 §4 and the mock, finding PB-13)', () => {
    it('hides the tip and goes on to the layer behind in the same press: it is never prevented, never stopped', async () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      const behind = vi.fn((event: Event) => ({ prevented: event.defaultPrevented }));
      document.addEventListener('keydown', behind);
      await focus(document.querySelector('button')!);
      expect(isOpen()).toBe(true);
      const event = key('Escape');
      expect(isOpen()).toBe(false);
      expect(behind).toHaveBeenCalledTimes(1);
      expect(behind.mock.results[0]?.value).toEqual({ prevented: false });
      expect(event.defaultPrevented).toBe(false);
      document.removeEventListener('keydown', behind);
    });

    it('reaches a window listener at capture time too, behind the host, once', () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      const behind = vi.fn();
      window.addEventListener('keydown', behind, true);
      hover(document.querySelector('button')!);
      key('Escape');
      expect(behind).toHaveBeenCalledTimes(1);
      window.removeEventListener('keydown', behind, true);
    });

    it('is not consumed when no tip is open: the press belongs to whatever is behind', () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      const behind = vi.fn();
      document.addEventListener('keydown', behind);
      const event = key('Escape');
      expect(behind).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      document.removeEventListener('keydown', behind);
    });

    it('cancels a tip that is still waiting for its delay', () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      pointer('pointerover', document.querySelector('button')!);
      advance(200);
      key('Escape');
      advance(1000);
      expect(isOpen()).toBe(false);
    });

    it('does not bring the tip back for the same hover or focus, and does once pointer and focus have left', async () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      key('Escape');
      pointer('pointerover', trigger);
      advance(1000);
      expect(isOpen()).toBe(false);
      leave(trigger);
      hover(trigger);
      expect(isOpen()).toBe(true);
      key('Escape');
      expect(isOpen()).toBe(false);
      await focus(trigger);
      expect(isOpen()).toBe(false);
    });

    it('ignores other keys, and an Escape that an input method composes', () => {
      mount(<button type="button" {...tip('Close')}>x</button>);
      hover(document.querySelector('button')!);
      key('Enter');
      key('Tab');
      key('Escape', { isComposing: true });
      expect(isOpen()).toBe(true);
    });

    it('leaves an Escape that something registered before it already handled alone', () => {
      // A listener on the window that comes first, as a dialog's would, and handles the press.
      const handler = (event: Event) => {
        event.preventDefault(); 
      };

      window.addEventListener('keydown', handler, true);
      mount(
        <button type="button" {...tip('Close')}>
          x
        </button>,
      );
      hover(document.querySelector('button')!);
      key('Escape');
      window.removeEventListener('keydown', handler, true);
      expect(isOpen()).toBe(true);
    });
  });

  describe('closing', () => {
    it('on a press of the trigger, which also ends the episode', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      pointer('pointerdown', trigger);
      expect(isOpen()).toBe(false);
      pointer('pointerover', trigger);
      advance(1000);
      expect(isOpen()).toBe(false);
    });

    it('but not on a press of a control that is unavailable: its press does nothing, so its reason stays', () => {
      mount(<button type="button" aria-disabled="true" {...tip('Refreshing')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      pointer('pointerdown', trigger);
      expect(isOpen()).toBe(true);
      trigger.click();
      expect(isOpen()).toBe(true);
    });

    it('on a click of the trigger, which is how a key activates it', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      act(() => {
        trigger.click();
      });
      expect(isOpen()).toBe(false);
    });

    it('on a press anywhere else', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      hover(document.querySelector('button')!);
      pointer('pointerdown', document.body);
      expect(isOpen()).toBe(false);
    });

    it('when the trigger, or anything that holds it, scrolls; not for a scroll elsewhere', () => {
      mount(
        <>
          <div id="region">
            <button type="button" {...tip('Refresh list')}>Refresh</button>
          </div>
          <div id="elsewhere" />
        </>,
      );
      const trigger = document.querySelector('button')!;
      hover(trigger);
      act(() => {
        document.getElementById('elsewhere')!.dispatchEvent(new Event('scroll'));
      });
      expect(isOpen()).toBe(true);
      act(() => {
        document.getElementById('region')!.dispatchEvent(new Event('scroll'));
      });
      expect(isOpen()).toBe(false);
      hover(trigger);
      leave(trigger);
      hover(trigger);
      act(() => {
        document.dispatchEvent(new Event('scroll'));
      });
      expect(isOpen()).toBe(false);
    });

    it('when the window resizes or loses focus', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(isOpen()).toBe(false);
      leave(trigger);
      hover(trigger);
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(isOpen()).toBe(false);
    });

    it('when the trigger is removed while its tip is open', async () => {
      const view = render(
        <>
          <TooltipHost />
          <button type="button" {...tip('Refresh list')}>Refresh</button>
        </>,
      );
      measure(120, 34);
      hover(document.querySelector('button')!);
      expect(isOpen()).toBe(true);
      view.rerender(<TooltipHost />);
      await flush();
      expect(isOpen()).toBe(false);
    });

    it('when the text of the trigger changes: what was shown is not what is now meant', async () => {
      const view = render(
        <>
          <TooltipHost />
          <button type="button" {...tip('Created 4 days ago')}>4d</button>
        </>,
      );
      measure(120, 34);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      view.rerender(
        <>
          <TooltipHost />
          <button type="button" {...tip('Created 5 days ago')}>5d</button>
        </>,
      );
      await flush();
      expect(isOpen()).toBe(false);
      leave(trigger);
      hover(trigger);
      expect(host().textContent).toBe('Created 5 days ago');
    });

    it('when the trigger opens a popup of its own, and never opens while it holds one', async () => {
      mount(<button type="button" aria-expanded="false" {...tip('Columns')}>Columns</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      expect(isOpen()).toBe(true);
      act(() => {
        trigger.setAttribute('aria-expanded', 'true');
      });
      await flush();
      expect(isOpen()).toBe(false);
      leave(trigger);
      hover(trigger);
      expect(isOpen()).toBe(false);
    });

    it('stays shut for a trigger inside an inert region', () => {
      mount(
        <div inert>
          <button type="button" {...tip('Refresh list')}>Refresh</button>
        </div>,
      );
      hover(document.querySelector('button')!, 1000);
      expect(isOpen()).toBe(false);
    });
  });

  describe('what the trigger keeps', () => {
    it('is described by the tip while it is open, beside the descriptions it had, and as it was after', () => {
      mount(<button type="button" aria-describedby="note" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      expect(trigger.getAttribute('aria-describedby')).toBe(`note ${host().id}`);
      leave(trigger);
      expect(trigger.getAttribute('aria-describedby')).toBe('note');
    });

    it('gets no description when its own name already is the text, and none left behind', () => {
      mount(<button type="button" aria-label="Refresh list" {...tip('Refresh list')} />);
      const trigger = document.querySelector('button')!;
      hover(trigger);
      expect(isOpen()).toBe(true);
      expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    it('never gets a native title, and its attributes are its own after', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      const before = trigger.getAttributeNames().sort();
      hover(trigger);
      leave(trigger);
      expect(trigger.hasAttribute('title')).toBe(false);
      expect(trigger.getAttributeNames().sort()).toEqual(before);
    });
  });

  describe('when the text is cut', () => {
    const cut = (target: Element | undefined, scrollWidth: number, clientWidth: number) => {
      const element = defined(target);
      Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
      Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
    };

    it('shows the full text of a clipping element that is cut, and nothing while it fits', () => {
      mount(<span data-ov-clip="" data-ov-full="cart-api-7d8c6f49b-f8q4m" style={{ overflow: 'hidden' }}>cart-api…f8q4m</span>);
      const name = document.querySelector('span')!;
      cut(name, 100, 100);
      hover(name, 1000);
      expect(isOpen()).toBe(false);
      leave(name);
      cut(name, 140, 100);
      hover(name);
      expect(isOpen()).toBe(true);
      expect(host().textContent).toBe('cart-api-7d8c6f49b-f8q4m');
    });

    it('measures when the pointer arrives, not before: the same name is cut after a resize', () => {
      mount(<span data-ov-clip="" data-ov-full="cart-api-7d8c6f49b-f8q4m" style={{ overflow: 'hidden' }}>cart-api…f8q4m</span>);
      const name = document.querySelector('span')!;
      cut(name, 100, 100);
      hover(name, 1000);
      leave(name);
      expect(isOpen()).toBe(false);
      cut(name, 100, 80);
      hover(name);
      expect(isOpen()).toBe(true);
      leave(name);
      cut(name, 100, 100);
      hover(name, 1000);
      expect(isOpen()).toBe(false);
    });

    it('allows a pixel of rounding: a cut is wider than the box by more than 1 px', () => {
      mount(<span data-ov-clip="" data-ov-full="name" style={{ overflow: 'hidden' }}>name</span>);
      const name = document.querySelector('span')!;
      cut(name, 101, 100);
      hover(name, 1000);
      expect(isOpen()).toBe(false);
      leave(name);
      cut(name, 102, 100);
      hover(name);
      expect(isOpen()).toBe(true);
    });

    it('does not call text cut when nothing is clipped: overflow visible paints outside the box', () => {
      mount(<span data-ov-clip="" data-ov-full="name">name</span>);
      const name = document.querySelector('span')!;
      cut(name, 300, 100);
      hover(name, 1000);
      expect(isOpen()).toBe(false);
    });

    it('takes the text of the element when it names no full text', () => {
      mount(<span data-ov-clip="" style={{ overflow: 'hidden' }}>  Last   seen  4 days ago </span>);
      const name = document.querySelector('span')!;
      cut(name, 200, 100);
      hover(name);
      expect(host().textContent).toBe('Last seen 4 days ago');
    });

    it('closes when the text node of a cut label changes in place: no element is added or removed, only the data of the node', async () => {
      mount(<span data-ov-clip="" style={{ overflow: 'hidden' }}>Last seen 4 days ago</span>);
      const name = document.querySelector('span')!;
      cut(name, 200, 100);
      hover(name);
      expect(isOpen()).toBe(true);
      act(() => {
        (name.firstChild as Text).data = 'Last seen 5 days ago';
      });
      await flush();
      expect(isOpen()).toBe(false);
    });

    it('is also reached by keyboard focus inside it', async () => {
      mount(
        <span data-ov-clip="" data-ov-full="cart-api-7d8c6f49b-f8q4m" style={{ overflow: 'hidden' }}>
          <a href="#x">cart-api…f8q4m</a>
        </span>,
      );
      const name = document.querySelector('span')!;
      cut(name, 200, 100);
      await focus(document.querySelector('a')!);
      expect(isOpen()).toBe(true);
      expect(host().textContent).toBe('cart-api-7d8c6f49b-f8q4m');
    });

    it('gives no description to what already holds the text, and an explicit tip is always shown', () => {
      mount(
        <>
          <span data-ov-clip="" data-ov-full="a-long-name" style={{ overflow: 'hidden' }}>a-long…name</span>
          <span data-ov-clip="" style={{ overflow: 'hidden' }} {...tip('Created 4 days ago')}>4d</span>
        </>,
      );
      const [name, age] = Array.from(document.querySelectorAll('span'));
      cut(name, 200, 100);
      hover(name);
      expect(defined(name).hasAttribute('aria-describedby')).toBe(false);
      leave(name);
      cut(age, 10, 100);
      hover(age);
      expect(host().textContent).toBe('Created 4 days ago');
    });

    it('lets the nearest element decide: a name that fits does not fall through to a tip around it', () => {
      mount(
        <span {...tip('The row')}>
          <span data-ov-clip="" data-ov-full="short" style={{ overflow: 'hidden' }}>short</span>
        </span>,
      );
      const inner = document.querySelector('[data-ov-clip]')!;
      cut(inner, 50, 100);
      hover(inner, 1000);
      expect(isOpen()).toBe(false);
    });
  });

  describe('placement', () => {
    it('puts the tip where place() says, and says on which side', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const trigger = document.querySelector('button')!;
      layout(trigger, { left: 400, top: 300, width: 100, height: 28 });
      hover(trigger);
      expect(host().style.left).toBe('390px');
      expect(host().style.top).toBe(`${300 + 28 + GAP}px`);
      expect(host().getAttribute('data-placement')).toBe('bottom');
    });

    it('goes above near the bottom of the window and keeps 8 px from the edge near a side', () => {
      mount(
        <>
          <button type="button" id="low" {...tip('Low')}>l</button>
          <button type="button" id="edge" {...tip('Edge')}>e</button>
        </>,
      );
      const low = document.getElementById('low')!;
      const edge = document.getElementById('edge')!;
      layout(low, { left: 400, top: 868, width: 28, height: 28 });
      layout(edge, { left: 1436, top: 300, width: 4, height: 28 });
      hover(low);
      expect(host().getAttribute('data-placement')).toBe('top');
      expect(host().style.top).toBe(`${868 - GAP - 34}px`);
      leave(low);
      hover(edge);
      expect(host().style.left).toBe(`${1440 - MARGIN - 120}px`);
    });

    it('limits its height, and says so, when no side has room for all of it', () => {
      mount(<button type="button" {...tip('A very long text')}>x</button>);
      measure(280, 700);
      const trigger = document.querySelector('button')!;
      layout(trigger, { left: 100, top: 300, width: 1200, height: 28 });
      Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
      hover(trigger);
      expect(host().style.maxHeight).toBe(`${800 - MARGIN - GAP - 328}px`);
      expect(host().getAttribute('data-ov-clamped')).toBe('true');
    });

    it('puts its text in one inner element, so that the host itself never scrolls and keeps its bridge to the trigger', () => {
      mount(<button type="button" {...tip('Refresh list')}>x</button>);
      hover(document.querySelector('button')!);
      const body = host().querySelector('[data-ov-tip-body]');
      expect(host().children).toHaveLength(1);
      expect(body?.textContent).toBe('Refresh list');
      expect(host().textContent).toBe('Refresh list');
    });

    it('starts the next placement clean: no height limit left over from the last tip', () => {
      mount(
        <>
          <button type="button" id="a" {...tip('A')}>a</button>
          <button type="button" id="b" {...tip('B')}>b</button>
        </>,
      );
      measure(280, 700);
      layout(document.getElementById('a')!, { left: 100, top: 300, width: 1200, height: 28 });
      layout(document.getElementById('b')!, { left: 100, top: 20, width: 100, height: 28 });
      Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
      hover(document.getElementById('a')!);
      expect(host().style.maxHeight).not.toBe('');
      leave(document.getElementById('a')!);
      measure(120, 34);
      hover(document.getElementById('b')!);
      expect(host().style.maxHeight).toBe('');
      expect(host().hasAttribute('data-ov-clamped')).toBe(false);
    });
  });

  describe('what it costs', () => {
    it('does not render a trigger again for a hover: the host is not part of any tree it serves', () => {
      const commits = vi.fn();
      const renders = vi.fn();
      function Trigger() {
        renders();
        return <button type="button" {...tip('Refresh list')}>Refresh</button>;
      }

      mount(
        <Profiler id="triggers" onRender={commits}>
          <Trigger />
        </Profiler>,
      );
      const before = commits.mock.calls.length;
      const trigger = document.querySelector('button')!;
      hover(trigger);
      leave(trigger);
      hover(trigger);
      expect(commits.mock.calls.length).toBe(before);
      expect(renders).toHaveBeenCalledTimes(1);
    });

    it('writes nothing to the document root or the body while it opens, moves and closes', () => {
      mount(<button type="button" {...tip('Refresh list')}>Refresh</button>);
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((list) => records.push(...list));
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });
      const trigger = document.querySelector('button')!;
      layout(trigger, { left: 400, top: 300, width: 100, height: 28 });
      hover(trigger);
      leave(trigger);
      records.push(...observer.takeRecords());
      observer.disconnect();
      expect(records).toEqual([]);
      expect(document.documentElement.getAttribute('style')).toBeNull();
      expect([...document.documentElement.style].filter((property) => property.startsWith('--'))).toEqual([]);
    });
  });
});
