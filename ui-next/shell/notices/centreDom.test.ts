import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStop, CENTRE_WIDTH, focusInto, focusRow, idOf, placeAbove, rowOf, rowsOf, showPopover } from './centreDom';

// What the centre asks of the document (centreDom.ts): where its popover stands, the one call that may throw, and the focus. The placement is the mock's `placePopover` (shell-widgets.js), and its numbers are the
// mock's own measurement of the bell at 1440 x 900 and 1280 x 800 (mock-notice-centre.json): bell [1396, 872, 32, 24], popover [1008, 388, 420, 480], its bottom edge at 868.

/** An element whose box is the test's: jsdom has no layout. */
function boxed(left: number, top: number, width: number, height: number): Element {
  const element = document.createElement('button');
  element.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
  return element;
}

function windowOf(width: number, height: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
}

beforeEach(() => {
  windowOf(1440, 900);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('placeAbove', () => {
  it('stands the popover 4 px above the bell with its right edge on the bell\'s, as the mock does at 1440 x 900', () => {
    expect(placeAbove(boxed(1396, 872, 32, 24))).toEqual({ x: 1008, bottom: 32, max: 860 });
    // The popover's top is then 900 - 32 - 480 = 388: the mock's [1008, 388, 420, 480].
    expect(900 - 32 - 480).toBe(388);
  });

  it('is the same at the native window\'s minimum, 1280 x 800', () => {
    windowOf(1280, 800);
    expect(placeAbove(boxed(1236, 772, 32, 24))).toEqual({ x: 848, bottom: 32, max: 760 });
  });

  it('takes the invoker\'s left edge when it is in the left half of the window', () => {
    expect(placeAbove(boxed(100, 872, 32, 24))).toEqual({ x: 100, bottom: 32, max: 860 });
  });

  it('keeps the popover 8 px inside the window\'s sides, and never wider than the window less 16 px', () => {
    expect(placeAbove(boxed(2, 872, 32, 24)).x).toBe(8);
    windowOf(300, 900);
    const place = placeAbove(boxed(268, 872, 32, 24));
    expect(place.x).toBe(8);
    expect(place.x + Math.min(CENTRE_WIDTH, 300 - 16)).toBeLessThanOrEqual(300 - 8);
  });

  it('is never taller than the room above the bell less 12 px, and never under 120 px', () => {
    expect(placeAbove(boxed(1396, 200, 32, 24)).max).toBe(188);
    expect(placeAbove(boxed(1396, 60, 32, 24)).max).toBe(120);
  });
});

describe('showPopover', () => {
  it('puts a popover in the top layer, and leaves one that is open as it is instead of throwing', () => {
    const element = document.createElement('div');
    const show = vi.spyOn(element, 'showPopover');
    showPopover(element);
    expect(show).toHaveBeenCalledTimes(1);
    show.mockImplementation(() => {
      throw new DOMException('already open', 'InvalidStateError');
    });
    expect(() => {
      showPopover(element);
    }).not.toThrow();
  });
});

describe('the list\'s rows', () => {
  function list(ids: readonly string[]): HTMLUListElement {
    const element = document.createElement('ul');
    for (const id of ids) {
      element.insertAdjacentHTML('beforeend', `<li><article data-notices-part="row" data-notices-id="${id}"><button data-notices-part="rowToggle">${id}</button><button>Dismiss ${id}</button></article></li>`);
    }

    document.body.append(element);
    return element;
  }

  it('finds the rows in order, and the row an element is in', () => {
    const element = list(['a', 'b']);
    expect(rowsOf(element).map(idOf)).toEqual(['a', 'b']);
    expect(rowOf(element.querySelectorAll('button')[3])).toBe(rowsOf(element)[1]);
    expect(rowOf(document.body)).toBeNull();
    expect(rowOf(null)).toBeNull();
  });

  it('makes exactly one row\'s controls tab stops, and writes only where an attribute differs', () => {
    const element = list(['a', 'b', 'c']);
    applyStop(rowsOf(element), 'b');
    expect([...element.querySelectorAll('button')].map((button) => button.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '0', '-1', '-1']);
    const set = vi.spyOn(Element.prototype, 'setAttribute');
    applyStop(rowsOf(element), 'b');
    expect(set).not.toHaveBeenCalled();
    applyStop(rowsOf(element), 'c');
    expect(set).toHaveBeenCalledTimes(4);
  });

  it('gives the focus to the title of a row, and says so only when it took it', () => {
    const element = list(['a', 'b']);
    const [first, second] = rowsOf(element);
    expect(focusRow(second)).toBe(true);
    expect(document.activeElement).toBe(second?.querySelector('[data-notices-part="rowToggle"]'));
    expect(focusRow(undefined)).toBe(false);
    expect(focusRow(first)).toBe(true);
  });

  it('puts the focus on the newest row when the centre opens, and on the popover itself when there is none', () => {
    const popover = document.createElement('div');
    popover.tabIndex = -1;
    document.body.append(popover);
    focusInto(null, popover);
    expect(document.activeElement).toBe(popover);
    const element = list(['a', 'b']);
    focusInto(element, popover);
    expect(document.activeElement).toBe(rowsOf(element)[0]?.querySelector('[data-notices-part="rowToggle"]'));
    focusInto(document.createElement('ul'), popover);
    expect(document.activeElement).toBe(popover);
  });
});
