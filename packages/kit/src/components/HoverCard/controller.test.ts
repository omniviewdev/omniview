import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { createHoverCards, GRACE_MS, OPEN_DELAY_MS, type CardState, type HoverCards } from './controller';
import { GAP, MARGIN } from './placement';

// jsdom has neither layout nor the Popover API, nor a reliable :focus-visible or :hover: the tests give the controller what a browser would.
// The controller runs without React here: the subscriber below does what the host does on a commit, which is to draw the content of the
// card in the snapshot into the popover element and call `settle()`.
const inTopLayer = new WeakSet<Element>();
let focusVisible = true;
/** The element under the pointer: `:hover` matches it and every ancestor. */
let pointerOver: Element | null = null;
const realMatches = Element.prototype.matches;
let detachers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  focusVisible = true;
  pointerOver = null;
  detachers = [];
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    inTopLayer.add(this);
    // What :popover-open does to the engine's own rules: a closed popover is display none, and nothing in it can take the focus.
    this.style.display = 'block';
  };

  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    inTopLayer.delete(this);
    this.style.display = '';
  };

  Object.defineProperty(Element.prototype, 'matches', {
    configurable: true,
    writable: true,
    value: function matches(this: Element, selector: string) {
      if (selector === ':focus-visible') {
        return focusVisible && this === document.activeElement;
      }

      if (selector === ':hover') {
        return pointerOver !== null && this.contains(pointerOver);
      }

      return realMatches.call(this, selector);
    },
  });

  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  for (const detach of detachers) {
    detach();
  }

  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Element.prototype.matches = realMatches;
  Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
});

/** What the fake host draws for a key: how many controls the card holds, and what it says when keyboard focus opens it. */
type Spec = { readonly controls: 0 | 1 | 2 | 3; readonly announce?: string };
const SAY = 'Press Down Arrow to reach its actions.';
const SPECS: Readonly<Record<string, Spec>> = {
  a: { controls: 2, announce: SAY },
  b: { controls: 3, announce: SAY },
  plain: { controls: 0, announce: SAY },
  silent: { controls: 2 },
  blank: { controls: 2, announce: '   ' },
};

type Fixture = {
  readonly cards: HoverCards;
  readonly host: HTMLElement;
  readonly region: HTMLElement;
  /** The keys that have a card now: the answer `render` would give. */
  readonly available: Set<string>;
  readonly detach: () => void;
};

/** A host with its live region, attached, and a subscriber that draws what the host would. */
function mount(): Fixture {
  const host = document.createElement('div');
  host.setAttribute('popover', 'manual');
  host.setAttribute('role', 'dialog');
  const region = document.createElement('div');
  region.setAttribute('role', 'status');
  document.body.append(host, region);
  Object.defineProperty(host, 'offsetWidth', { configurable: true, value: 300 });
  Object.defineProperty(host, 'offsetHeight', { configurable: true, value: 180 });
  const cards = createHoverCards();
  const available = new Set(Object.keys(SPECS));
  cards.setAvailability((key) => available.has(key));
  cards.subscribe(() => {
    const card = cards.getSnapshot();
    host.replaceChildren();
    const spec = card === null ? undefined : SPECS[card.key];
    if (card === null || spec === undefined) {
      return;
    }

    // The host's own element holds one body, as HoverCardHost draws it: the body is what scrolls when the card is clamped.
    const body = document.createElement('div');
    body.append(draw(spec.controls));
    host.append(body);
    cards.settle(spec.announce);
  });
  const detach = cards.attach(host, region);
  detachers.push(detach);
  return { cards, host, region, available, detach };
}

/** The content of a card: text, then a link, then buttons. */
function draw(controls: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const text = document.createElement('p');
  text.textContent = 'Logs for orders-api';
  fragment.append(text);
  const names = ['Open', 'Stop', 'Retry'];
  for (let index = 0; index < controls; index += 1) {
    const control = document.createElement(index === 0 ? 'a' : 'button');
    control.textContent = names[index] ?? '';
    if (control instanceof HTMLAnchorElement) {
      control.href = '#open';
    } else {
      control.setAttribute('type', 'button');
    }

    fragment.append(control);
  }

  return fragment;
}

type Tab = { readonly root: HTMLElement; readonly trigger: HTMLButtonElement; readonly close: HTMLButtonElement };

/** A tab: the anchor, holding the trigger (the label) and its close button. */
function tab(key: string, options: { readonly arrow?: boolean } = {}): Tab {
  const root = document.createElement('div');
  root.setAttribute('data-ov-card-anchor', '');
  const trigger = document.createElement('button');
  trigger.setAttribute('type', 'button');
  trigger.textContent = key;
  trigger.setAttribute('data-ov-card', key);
  if (options.arrow !== false) {
    trigger.setAttribute('data-ov-card-arrow', 'down');
  }

  const close = document.createElement('button');
  close.setAttribute('type', 'button');
  close.textContent = `Close ${key}`;
  root.append(trigger, close);
  document.body.append(root);
  return { root, trigger, close };
}

/** The pointer events a browser sends when the pointer moves from one element to another, and the hover that goes with them. */
function movePointer(to: Element | null, pointerType = 'mouse') {
  const from = pointerOver;
  if (from === to) {
    return;
  }

  pointerOver = to;
  if (from !== null) {
    pointer('pointerout', from, to, pointerType);
  }

  if (to !== null) {
    pointer('pointerover', to, from, pointerType);
  }
}

function pointer(type: 'pointerover' | 'pointerout' | 'pointerdown', target: Element, related: Element | null = null, pointerType = 'mouse') {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, relatedTarget: related, pointerType });
  target.dispatchEvent(event);
  return event;
}

const advance = (ms: number) => {
  vi.advanceTimersByTime(ms);
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

const click = (target: Element) => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

const rectOf = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });

/** Layout for jsdom: where an element is. */
function layout(element: Element, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () => rectOf(left, top, width, height);
}

function size(host: HTMLElement, width: number, height: number) {
  Object.defineProperty(host, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'offsetHeight', { configurable: true, value: height });
}

/** Microtasks: a MutationObserver reports in one. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const isOpen = (host: HTMLElement) => inTopLayer.has(host);
const keyOf = (cards: HoverCards) => cards.getSnapshot()?.key ?? null;

/** The controls of the card, in order. */
const controlsOf = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));

/** An element a test built: the lists the tests index are typed as possibly empty, and an empty one is a failure. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('the test expected an element that is not there');
  }

  return value;
}

/** The pointer rests on the trigger until its card opens. */
function hover(trigger: Element) {
  movePointer(trigger);
  advance(OPEN_DELAY_MS);
}

/** Keyboard focus on `element`, as `:focus-visible`. */
function tabTo(element: HTMLElement) {
  focusVisible = true;
  element.focus();
}

describe('attaching', () => {
  const allListeners = () => {
    const doc = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const win = vi.spyOn(window, 'addEventListener');
    return () => [...doc.mock.calls, ...win.mock.calls].map(([type, , options]) => `${type}:${options === true || (typeof options === 'object' && options.capture === true)}`).sort();
  };

  it('is one set of ten listeners on the document and the window, and a thousand triggers add none', () => {
    const listeners = allListeners();
    const { cards } = mount();
    expect(listeners()).toEqual([
      'blur:false',
      'click:true',
      'focusin:false',
      'focusout:false',
      'keydown:true',
      'pointerdown:true',
      'pointerout:false',
      'pointerover:false',
      'resize:false',
      'scroll:true',
    ]);

    vi.clearAllMocks();
    const added = allListeners();
    for (let index = 0; index < 1000; index += 1) {
      tab(index % 2 === 0 ? 'a' : 'b');
    }

    expect(document.querySelectorAll('[data-ov-card]')).toHaveLength(1000);
    // Using them adds none either: opening, replacing and closing.
    const first = document.querySelectorAll<HTMLElement>('[data-ov-card]');
    hover(defined(first[0]));
    movePointer(first[1] ?? null);
    movePointer(null);
    advance(GRACE_MS);
    expect(cards.getSnapshot()).toBeNull();
    expect(added()).toEqual([]);
  });

  it('removes every listener it added when it detaches, and a trigger then does nothing', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const { cards, detach } = mount();
    const trigger = tab('a').trigger;
    detach();
    const label = ([type, , options]: readonly unknown[]) => `${String(type)}:${options === true || (typeof options === 'object' && options !== null && 'capture' in options && options.capture === true)}`;
    expect([...remove.mock.calls, ...removeWindow.mock.calls].map(label).sort()).toEqual([...add.mock.calls, ...addWindow.mock.calls].map(label).sort());
    hover(trigger);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes the card that is open when it detaches, and leaves the element empty and out of the top layer', () => {
    const { cards, host, detach } = mount();
    hover(tab('a').trigger);
    expect(isOpen(host)).toBe(true);
    detach();
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
    expect(host.getAttribute('style') ?? '').toBe('');
    expect(host.hasAttribute('data-placement')).toBe(false);
  });

  it('refuses a second host in the same document: there is one popup for the whole page', () => {
    mount();
    expect(() => mount()).toThrow(/Mount one HoverCardHost per window/);
  });

  it('attaches again after it detached (a hot reload, a strict-mode effect)', () => {
    const { detach } = mount();
    detach();
    expect(() => mount()).not.toThrow();
  });

  it('needs the Popover API, which jsdom does not have', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    expect(() => mount()).toThrow(/needs the Popover API/);
    // The failure attached nothing: the next host, in an engine that has it, is the first.
    HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
      inTopLayer.add(this);
      this.style.display = 'block';
    };

    expect(() => mount()).not.toThrow();
  });

  it('has no card for any key until it is told which keys have one', () => {
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    document.body.append(host, document.createElement('div'));
    const cards = createHoverCards();
    detachers.push(cards.attach(host, document.createElement('div')));
    hover(tab('a').trigger);
    expect(cards.getSnapshot()).toBeNull();
  });
});

describe('opening', () => {
  it('waits 500 ms after the pointer reaches a trigger, then shows the card of its key', () => {
    const { cards, host } = mount();
    const { trigger, root } = tab('a');
    expect(OPEN_DELAY_MS).toBe(500);
    movePointer(trigger);
    advance(499);
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
    advance(1);
    expect(cards.getSnapshot()).toEqual({ key: 'a', trigger, anchor: root, entry: 'pointer' });
    expect(isOpen(host)).toBe(true);
    expect(host.textContent).toContain('Logs for orders-api');
  });

  it('gives the same snapshot until something changes: a store may compare it', () => {
    const { cards } = mount();
    hover(tab('a').trigger);
    expect(cards.getSnapshot()).toBe(cards.getSnapshot());
  });

  it('notifies its subscribers once when a card opens and once when it closes', () => {
    const { cards } = mount();
    const listener = vi.fn();
    const unsubscribe = cards.subscribe(listener);
    const { trigger } = tab('a');
    hover(trigger);
    expect(listener).toHaveBeenCalledTimes(1);
    movePointer(null);
    advance(GRACE_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    hover(trigger);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hangs from the nearest element marked as the anchor, and from the trigger itself when there is none', () => {
    const { cards } = mount();
    const withAnchor = tab('a');
    const alone = document.createElement('button');
    alone.setAttribute('data-ov-card', 'b');
    document.body.append(alone);
    hover(withAnchor.trigger);
    expect(cards.getSnapshot()?.anchor).toBe(withAnchor.root);
    movePointer(null);
    advance(GRACE_MS);
    hover(alone);
    expect(cards.getSnapshot()?.anchor).toBe(alone);
    movePointer(null);
    advance(GRACE_MS);
    const nested = document.createElement('div');
    nested.setAttribute('data-ov-card-anchor', '');
    const inner = document.createElement('button');
    inner.setAttribute('data-ov-card', 'a');
    inner.setAttribute('data-ov-card-anchor', '');
    nested.append(inner);
    document.body.append(nested);
    hover(inner);
    expect(cards.getSnapshot()?.anchor).toBe(inner);
  });

  it('is cancelled when the pointer leaves first', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    movePointer(trigger);
    advance(300);
    movePointer(null);
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('is not restarted by the pointer moving between the children of one trigger, nor by coming over it again', () => {
    const { cards } = mount();
    const trigger = document.createElement('button');
    trigger.setAttribute('data-ov-card', 'a');
    const first = document.createElement('span');
    const second = document.createElement('span');
    trigger.append(first, second);
    document.body.append(trigger);
    movePointer(first);
    advance(300);
    movePointer(second);
    pointer('pointerover', second);
    advance(199);
    expect(cards.getSnapshot()).toBeNull();
    advance(1);
    expect(keyOf(cards)).toBe('a');
  });

  it('replaces the card that is showing at once, without a second wait, with the card of the next trigger', () => {
    const { cards, host } = mount();
    const one = tab('a');
    const two = tab('b');
    hover(one.trigger);
    movePointer(two.trigger);
    expect(cards.getSnapshot()).toEqual({ key: 'b', trigger: two.trigger, anchor: two.root, entry: 'pointer' });
    expect(controlsOf(host)).toHaveLength(3);
    // The grace that leaving the first one started is gone: it does not close the second.
    advance(1000);
    expect(keyOf(cards)).toBe('b');
  });

  it('waits the whole delay again for a trigger once nothing is showing', () => {
    const { cards } = mount();
    const one = tab('a');
    const two = tab('b');
    hover(one.trigger);
    movePointer(two.trigger);
    movePointer(null);
    advance(GRACE_MS);
    expect(cards.getSnapshot()).toBeNull();
    movePointer(one.trigger);
    advance(499);
    expect(cards.getSnapshot()).toBeNull();
    advance(1);
    expect(keyOf(cards)).toBe('a');
  });

  it('ignores a touch: a finger has no hover', () => {
    const { cards } = mount();
    movePointer(tab('a').trigger, 'touch');
    advance(2000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('never opens for a trigger with no key, a blank key, or a key the host has no card for', () => {
    const { cards, available } = mount();
    const none = document.createElement('button');
    none.setAttribute('data-ov-card', '');
    const blank = document.createElement('button');
    blank.setAttribute('data-ov-card', '   ');
    const plain = document.createElement('button');
    const unknown = tab('nobody').trigger;
    document.body.append(none, blank, plain);
    for (const trigger of [none, blank, plain, unknown]) {
      hover(trigger);
      advance(1000);
      expect(cards.getSnapshot()).toBeNull();
      movePointer(null);
    }

    available.delete('a');
    hover(tab('a').trigger);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('never opens a card that was waiting when the host stopped having it, and keeps the one that is showing when the next has none', () => {
    const { cards, available } = mount();
    const one = tab('a');
    movePointer(one.trigger);
    advance(300);
    available.delete('a');
    advance(200);
    expect(cards.getSnapshot()).toBeNull();
    available.add('a');
    movePointer(null);
    hover(one.trigger);
    expect(keyOf(cards)).toBe('a');
    const empty = tab('nobody');
    movePointer(empty.trigger);
    expect(keyOf(cards)).toBe('a');
    advance(GRACE_MS);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('never opens for a trigger that left the page while it waited', () => {
    const { cards } = mount();
    const { trigger, root } = tab('a');
    movePointer(trigger);
    advance(200);
    root.remove();
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('never opens for a trigger inside an inert region, nor while a dialog is open on the page', () => {
    const { cards } = mount();
    const inert = document.createElement('div');
    inert.setAttribute('inert', '');
    const behind = document.createElement('button');
    behind.setAttribute('data-ov-card', 'a');
    inert.append(behind);
    document.body.append(inert);
    hover(behind);
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    hover(tab('a').trigger);
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
    dialog.removeAttribute('open');
    movePointer(null);
    hover(tab('a').trigger);
    expect(keyOf(cards)).toBe('a');
  });

  it('never takes the focus when it opens', () => {
    const { host } = mount();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    hover(tab('a').trigger);
    expect(isOpen(host)).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(host.contains(document.activeElement)).toBe(false);
  });
});

describe('keyboard focus', () => {
  it('opens 500 ms after :focus-visible reaches a trigger, as a card of focus', () => {
    const { cards } = mount();
    const { trigger, root } = tab('a');
    tabTo(trigger);
    advance(499);
    expect(cards.getSnapshot()).toBeNull();
    advance(1);
    expect(cards.getSnapshot()).toEqual({ key: 'a', trigger, anchor: root, entry: 'focus' });
  });

  it('does not open for focus that is not :focus-visible (a click gave it)', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    focusVisible = false;
    trigger.focus();
    advance(2000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('is reached by keyboard focus on a control inside a trigger', () => {
    const { cards } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    tabTo(inner);
    advance(500);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger, anchor: trigger, entry: 'focus' });
  });

  it('closes the card of a trigger when the focus leaves it for another, which then waits its own delay', () => {
    const { cards } = mount();
    const one = tab('a');
    const two = tab('b');
    tabTo(one.trigger);
    advance(500);
    tabTo(two.trigger);
    expect(cards.getSnapshot()).toBeNull();
    advance(499);
    expect(cards.getSnapshot()).toBeNull();
    advance(1);
    expect(cards.getSnapshot()).toMatchObject({ key: 'b', entry: 'focus' });
  });

  it('replaces at once a card that something else holds open, when the focus moves to another trigger', () => {
    const { cards } = mount();
    const one = tab('a');
    const two = tab('b');
    hover(one.trigger);
    tabTo(two.trigger);
    expect(cards.getSnapshot()).toMatchObject({ key: 'b', trigger: two.trigger, entry: 'focus' });
  });

  it('keeps the card while the trigger keeps its focus, though the pointer comes and goes', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    movePointer(trigger);
    movePointer(null);
    advance(1000);
    expect(keyOf(cards)).toBe('a');
  });

  it('still opens for the keyboard focus when the pointer came onto the trigger and left it again before the delay (CodeRabbit, controller.ts:377)', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(200);
    movePointer(trigger);
    movePointer(null);
    advance(OPEN_DELAY_MS);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger, entry: 'focus' });
  });

  it('does so too when the pointer came first and the focus after it', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    movePointer(trigger);
    advance(100);
    tabTo(trigger);
    movePointer(null);
    advance(OPEN_DELAY_MS);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger, entry: 'focus' });
  });

  it('does so for a control inside a trigger that wraps it', () => {
    const { cards } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    tabTo(inner);
    advance(200);
    movePointer(trigger);
    movePointer(null);
    advance(OPEN_DELAY_MS);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger, entry: 'focus' });
  });

  it('still gives up the wait of a pointer that leaves while the focus is on another element', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    const other = document.createElement('button');
    document.body.append(other);
    tabTo(other);
    movePointer(trigger);
    movePointer(null);
    advance(OPEN_DELAY_MS * 2);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes the card when the focus goes elsewhere, and cancels one that is still waiting', () => {
    const { cards } = mount();
    const one = tab('a');
    const other = document.createElement('button');
    document.body.append(other);
    tabTo(one.trigger);
    advance(200);
    other.focus();
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
    tabTo(one.trigger);
    advance(500);
    expect(keyOf(cards)).toBe('a');
    other.focus();
    expect(cards.getSnapshot()).toBeNull();
  });

  it('does not close the card of the pointer when the focus leaves a trigger the pointer is still on', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    const other = document.createElement('button');
    document.body.append(other);
    tabTo(trigger);
    movePointer(trigger);
    advance(500);
    expect(keyOf(cards)).toBe('a');
    trigger.blur();
    advance(1000);
    expect(keyOf(cards)).toBe('a');
  });
});

describe('staying open, and the grace', () => {
  it('closes 120 ms after the pointer leaves both the trigger and the card, and not before', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    movePointer(null);
    advance(GRACE_MS - 1);
    expect(keyOf(cards)).toBe('a');
    advance(1);
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
    expect(GRACE_MS).toBe(120);
  });

  it('lets the pointer cross the gap onto the card, and stays while it is there', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    movePointer(null);
    advance(60);
    movePointer(host);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
    // From the card to the card's own content: still on it.
    const link = defined(controlsOf(host)[0]);
    movePointer(link);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });

  it('closes 120 ms after the pointer leaves the card for the page', () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    movePointer(host);
    movePointer(document.body);
    advance(GRACE_MS - 1);
    expect(keyOf(cards)).toBe('a');
    advance(1);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('lets the pointer come back from the card to the trigger without closing', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    movePointer(host);
    movePointer(trigger);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });

  it('does not close while the trigger is :focus-visible, though the pointer left both', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    tabTo(trigger);
    movePointer(null);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });

  it('does not close while focus is inside the card', () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    movePointer(host);
    defined(controlsOf(host)[1]).focus();
    movePointer(null);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });

  it('does not close while a control inside the trigger has keyboard focus, though the trigger itself does not match :focus-visible', () => {
    const { cards } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    tabTo(inner);
    advance(OPEN_DELAY_MS);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger, entry: 'focus' });
    movePointer(trigger);
    movePointer(null);
    advance(GRACE_MS);
    expect(keyOf(cards)).toBe('a');
    advance(5000);
    expect(keyOf(cards)).toBe('a');
    inner.blur();
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes after the grace when the control inside the trigger kept its focus but not as :focus-visible', () => {
    const { cards } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    hover(trigger);
    // A click gave the control its focus: it is the active element, but not visibly focused.
    focusVisible = false;
    inner.focus();
    movePointer(null);
    advance(GRACE_MS);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('does not close while the trigger or the card is hovered when the grace ends', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    // A pointerout the engine reports while the pointer is in fact still over the trigger (a child came and went): the hover is the last word.
    pointer('pointerout', trigger, document.body);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
    movePointer(host);
    pointer('pointerout', host, document.body);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });

  it('is not closed by the pointer leaving a trigger that is not the one showing', () => {
    const { cards } = mount();
    const one = tab('a');
    const other = document.createElement('button');
    other.setAttribute('data-ov-card', 'nobody');
    document.body.append(other);
    hover(one.trigger);
    pointerOver = one.trigger;
    movePointer(other);
    // The card of `a` stays until its own grace is over; `nobody` has none to replace it with.
    expect(keyOf(cards)).toBe('a');
    movePointer(one.trigger);
    advance(5000);
    expect(keyOf(cards)).toBe('a');
  });
});

describe('Escape', () => {
  it('closes the card and goes no further: it is prevented and stopped when a card was open', () => {
    const { cards, host } = mount();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    hover(tab('a').trigger);
    const event = press('Escape');
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener('keydown', behind);
  });

  it('is not consumed when no card is open: the press belongs to whatever is behind', () => {
    mount();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    const event = press('Escape');
    expect(behind).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener('keydown', behind);
  });

  it('cancels a card that is still waiting for its delay, and does not consume the press', () => {
    const { cards } = mount();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    movePointer(tab('a').trigger);
    advance(200);
    const event = press('Escape');
    advance(2000);
    expect(cards.getSnapshot()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(behind).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', behind);
  });

  it('does not bring the card back for the same hover, and does once the pointer has left the trigger', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    press('Escape');
    pointer('pointerover', trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    expect(keyOf(cards)).toBe('a');
  });

  it('does not bring the card back for the same focus, and does once the focus has left the trigger', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    press('Escape');
    expect(cards.getSnapshot()).toBeNull();
    pointer('pointerover', trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    trigger.blur();
    tabTo(trigger);
    advance(500);
    expect(keyOf(cards)).toBe('a');
  });

  it('keeps the card dismissed until both the pointer and the focus have left the trigger', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    tabTo(trigger);
    press('Escape');
    // The pointer leaves; the focus is still on the trigger.
    movePointer(null);
    pointer('pointerover', trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    // The focus leaves while the pointer is on the trigger.
    movePointer(trigger);
    trigger.blur();
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    // Both are gone.
    movePointer(null);
    hover(trigger);
    expect(keyOf(cards)).toBe('a');
  });

  it('keeps the card dismissed while a control inside a wrapper trigger has keyboard focus, though the pointer left the trigger and came back (CodeRabbit, controller.ts:428)', () => {
    const { cards } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    tabTo(inner);
    advance(OPEN_DELAY_MS);
    expect(keyOf(cards)).toBe('a');
    press('Escape');
    expect(cards.getSnapshot()).toBeNull();
    // The pointer comes onto the wrapper and leaves it and comes back; the focus is on the link all along.
    movePointer(trigger);
    movePointer(null);
    movePointer(trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    // The focus leaves while the pointer is on the wrapper, then the pointer leaves: both are gone, and the card may come again.
    inner.blur();
    movePointer(null);
    hover(trigger);
    expect(keyOf(cards)).toBe('a');
  });

  it('returns the focus to the trigger when it was inside the card, and keeps the card dismissed after that', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    press('ArrowDown');
    expect(host.contains(document.activeElement)).toBe(true);
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('returns the focus to the control inside a wrapper trigger that held it, which the wrapper itself cannot take (CodeRabbit, controller.ts:242)', () => {
    const { cards, host } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    document.body.append(trigger);
    tabTo(inner);
    advance(OPEN_DELAY_MS);
    expect(keyOf(cards)).toBe('a');
    // The focus goes into the card (a click on one of its controls gives it there).
    defined(controlsOf(host)[0]).focus();
    expect(host.contains(document.activeElement)).toBe(true);
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inner);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('returns it to the control the focus was on last, when the wrapper holds more than one', () => {
    const { host } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const first = document.createElement('a');
    first.setAttribute('href', '#first');
    const second = document.createElement('a');
    second.setAttribute('href', '#second');
    trigger.append(first, second);
    document.body.append(trigger);
    tabTo(first);
    advance(OPEN_DELAY_MS);
    tabTo(second);
    defined(controlsOf(host)[0]).focus();
    press('Escape');
    expect(document.activeElement).toBe(second);
  });

  it('does not take the focus back to a control it left for the page: the card was reached by the pointer, and the trigger is the fallback', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    const page = document.createElement('button');
    document.body.append(page);
    tabTo(page);
    hover(trigger);
    expect(keyOf(cards)).toBe('a');
    defined(controlsOf(host)[0]).focus();
    press('Escape');
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves the focus where the action put it, for a wrapper trigger as for a button', () => {
    const { cards, host } = mount();
    const trigger = document.createElement('div');
    trigger.setAttribute('data-ov-card', 'a');
    const inner = document.createElement('a');
    inner.setAttribute('href', '#x');
    trigger.append(inner);
    const page = document.createElement('button');
    document.body.append(trigger, page);
    tabTo(inner);
    advance(OPEN_DELAY_MS);
    const link = defined(controlsOf(host)[0]);
    link.focus();
    click(link);
    page.focus();
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
    expect(document.activeElement).toBe(page);
  });

  it('closes a card that nothing holds, whichever element has the focus', () => {
    const { cards } = mount();
    const other = document.createElement('button');
    document.body.append(other);
    hover(tab('a').trigger);
    other.focus();
    expect(cards.getSnapshot()).toBeNull();
    hover(tab('b').trigger);
    expect(keyOf(cards)).toBe('b');
    press('Escape');
    expect(cards.getSnapshot()).toBeNull();
  });

  it('ignores other keys, and the Escape that an input method composes', () => {
    const { cards } = mount();
    hover(tab('a').trigger);
    press('Enter');
    press('Tab');
    press('Escape', { isComposing: true });
    press('Escape', { keyCode: 229 });
    expect(keyOf(cards)).toBe('a');
  });
});

describe('pressing, clicking and scrolling', () => {
  it('closes on a press anywhere outside the card', () => {
    const { cards } = mount();
    hover(tab('a').trigger);
    pointer('pointerdown', document.body);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('does nothing for a press inside the card', () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    pointer('pointerdown', host);
    pointer('pointerdown', defined(controlsOf(host)[0]));
    expect(keyOf(cards)).toBe('a');
  });

  it('closes on a press of the trigger and keeps it away for the episode', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    pointer('pointerdown', trigger);
    expect(cards.getSnapshot()).toBeNull();
    pointer('pointerover', trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    expect(keyOf(cards)).toBe('a');
  });

  it('closes on a press of the anchor\'s other control without dismissing: the pointer may come back', () => {
    const { cards } = mount();
    const { trigger, close } = tab('a');
    hover(trigger);
    movePointer(close);
    pointer('pointerdown', close);
    expect(cards.getSnapshot()).toBeNull();
    movePointer(trigger);
    advance(500);
    expect(keyOf(cards)).toBe('a');
  });

  it('cancels a card that is still waiting when the trigger is pressed, and keeps it away', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    movePointer(trigger);
    advance(200);
    pointer('pointerdown', trigger);
    advance(5000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes after a click on a link or a button in the card, once the click has been handled', () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    const stop = defined(controlsOf(host)[1]);
    click(stop);
    // The click is the control's to handle first.
    expect(keyOf(cards)).toBe('a');
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
    hover(tab('b').trigger);
    click(defined(controlsOf(host)[0]));
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes for a click on something inside a button, and not for a click on plain text of the card', () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    click(host.querySelector('p') as Element);
    advance(100);
    expect(keyOf(cards)).toBe('a');
    const stop = defined(controlsOf(host)[1]);
    const inner = document.createElement('span');
    stop.append(inner);
    click(inner);
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('does not close for a click outside the card (the press did)', () => {
    const { cards } = mount();
    hover(tab('a').trigger);
    click(document.body);
    advance(100);
    expect(keyOf(cards)).toBe('a');
  });

  it('gives the focus back to the trigger when it is still in the card after the click', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    const stop = defined(controlsOf(host)[1]);
    stop.focus();
    click(stop);
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not bring the card back when the focus returns to the trigger after a keyboard click on a control in the card', () => {
    const { cards, host, region } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(OPEN_DELAY_MS);
    expect(region.textContent).toBe(SAY);
    press('ArrowDown');
    const open = defined(controlsOf(host)[0]);
    expect(document.activeElement).toBe(open);
    click(open);
    advance(0);
    // The card ended and the focus went back to the trigger, which is :focus-visible: that is not a request for another card.
    expect(cards.getSnapshot()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    advance(OPEN_DELAY_MS * 2);
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
    expect(region.textContent).toBe('');
  });

  it('leaves the focus where the action put it when the action moved it out of the card', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    const page = document.createElement('button');
    document.body.append(page);
    hover(trigger);
    const link = defined(controlsOf(host)[0]);
    link.focus();
    click(link);
    // The action (a page it opened) took the focus before the card closed.
    page.focus();
    advance(0);
    expect(cards.getSnapshot()).toBeNull();
    expect(document.activeElement).toBe(page);
  });

  it('closes when anything that holds the trigger scrolls, or the document; not for a scroll elsewhere or inside the card', () => {
    const { cards, host } = mount();
    const region = document.createElement('div');
    const elsewhere = document.createElement('div');
    document.body.append(region, elsewhere);
    const { trigger, root } = tab('a');
    region.append(root);
    hover(trigger);
    elsewhere.dispatchEvent(new Event('scroll'));
    host.dispatchEvent(new Event('scroll'));
    expect(keyOf(cards)).toBe('a');
    region.dispatchEvent(new Event('scroll'));
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    document.dispatchEvent(new Event('scroll'));
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    root.dispatchEvent(new Event('scroll'));
    expect(cards.getSnapshot()).toBeNull();
  });

  it('cancels a card that is waiting when its trigger scrolls', () => {
    const { cards } = mount();
    const region = document.createElement('div');
    document.body.append(region);
    const { trigger, root } = tab('a');
    region.append(root);
    movePointer(trigger);
    advance(200);
    region.dispatchEvent(new Event('scroll'));
    advance(1000);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes when the window resizes or loses focus', () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    window.dispatchEvent(new Event('resize'));
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    window.dispatchEvent(new Event('blur'));
    expect(cards.getSnapshot()).toBeNull();
  });
});

describe('what changes under an open card', () => {
  it('closes when the trigger leaves the page', async () => {
    const { cards, host } = mount();
    const { root, trigger } = tab('a');
    hover(trigger);
    root.remove();
    await flush();
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
  });

  it('closes when the trigger changes its key: what was shown is not what is now meant', async () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    trigger.setAttribute('data-ov-card', 'b');
    await flush();
    expect(cards.getSnapshot()).toBeNull();
    movePointer(null);
    hover(trigger);
    expect(keyOf(cards)).toBe('b');
  });

  it('closes when the trigger loses its key', async () => {
    const { cards } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    trigger.removeAttribute('data-ov-card');
    await flush();
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes when the trigger goes inert', async () => {
    const { cards } = mount();
    const { root, trigger } = tab('a');
    hover(trigger);
    root.setAttribute('inert', '');
    await flush();
    expect(cards.getSnapshot()).toBeNull();
  });

  it('closes when a dialog opens over the page', async () => {
    const { cards } = mount();
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    hover(tab('a').trigger);
    dialog.setAttribute('open', '');
    await flush();
    expect(cards.getSnapshot()).toBeNull();
  });

  it('keeps the card for changes in its own content: the host draws and redraws it', async () => {
    const { cards, host } = mount();
    hover(tab('a').trigger);
    host.append(document.createElement('div'));
    host.querySelector('p')?.append(' (changed)');
    await flush();
    expect(keyOf(cards)).toBe('a');
  });

  it('watches the page only while a card is open or waiting', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { cards } = mount();
    expect(observe).not.toHaveBeenCalled();
    const { trigger } = tab('a');
    movePointer(trigger);
    expect(observe).toHaveBeenCalledTimes(1);
    movePointer(null);
    await flush();
    expect(disconnect).toHaveBeenCalled();
    hover(trigger);
    expect(observe.mock.calls.length).toBeGreaterThanOrEqual(2);
    disconnect.mockClear();
    press('Escape');
    expect(cards.getSnapshot()).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('the Down arrow and the keys inside the card', () => {
  it('opens a card that is not open, at once, and moves the focus to its first control, consuming the press', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    const event = press('ArrowDown');
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', entry: 'arrow' });
    expect(isOpen(host)).toBe(true);
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops the press at the host: nothing behind it sees the Down arrow', () => {
    const { cards } = mount();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    tabTo(tab('a').trigger);
    press('ArrowDown');
    expect(keyOf(cards)).toBe('a');
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener('keydown', behind);
  });

  it('moves the focus into a card that is already open, whichever way it opened', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    expect(document.activeElement).toBe(trigger);
    const event = press('ArrowDown');
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', entry: 'focus' });
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('brings back a card that was dismissed: the key is a request', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    press('Escape');
    expect(cards.getSnapshot()).toBeNull();
    press('ArrowDown');
    expect(keyOf(cards)).toBe('a');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
  });

  it('replaces the card of another trigger that is open, and enters the new one', () => {
    const { cards, host } = mount();
    const one = tab('a');
    const two = tab('b');
    // The focus is on B first and A is the card that shows (the pointer rests on it): hovering after the focus is what leaves A open.
    tabTo(two.trigger);
    hover(one.trigger);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a', trigger: one.trigger });
    expect(isOpen(host)).toBe(true);
    expect(document.activeElement).toBe(two.trigger);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(cards.getSnapshot()).toMatchObject({ key: 'b', trigger: two.trigger, entry: 'arrow' });
    expect(document.activeElement).toBe(controlsOf(host)[0]);
  });

  it('is left alone on a trigger that did not ask, with a modifier, or from inside a trigger rather than on it', () => {
    const { cards } = mount();
    const plain = tab('a', { arrow: false });
    tabTo(plain.trigger);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    expect(cards.getSnapshot()).toBeNull();
    const asking = tab('b');
    tabTo(asking.trigger);
    for (const modifier of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(press('ArrowDown', modifier).defaultPrevented).toBe(false);
    }

    expect(cards.getSnapshot()).toBeNull();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-ov-card', 'a');
    wrapper.setAttribute('data-ov-card-arrow', 'down');
    const inner = document.createElement('button');
    wrapper.append(inner);
    document.body.append(wrapper);
    tabTo(inner);
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('is left alone when the host has no card for the trigger', () => {
    const { cards } = mount();
    const nobody = tab('nobody');
    tabTo(nobody.trigger);
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    expect(cards.getSnapshot()).toBeNull();
  });

  it('walks the controls with Tab and Shift+Tab, and wraps at both ends', () => {
    const { host } = mount();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    const [open, stop, retry] = controlsOf(host);
    expect(document.activeElement).toBe(open);
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(stop);
    press('Tab');
    expect(document.activeElement).toBe(retry);
    press('Tab');
    expect(document.activeElement).toBe(open);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(retry);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(stop);
  });

  it('walks them with the arrows, Home and End, and wraps', () => {
    const { host } = mount();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    const [open, stop, retry] = controlsOf(host);
    press('ArrowDown');
    expect(document.activeElement).toBe(stop);
    press('ArrowDown');
    press('ArrowDown');
    expect(document.activeElement).toBe(open);
    press('ArrowUp');
    expect(document.activeElement).toBe(retry);
    press('ArrowUp');
    expect(document.activeElement).toBe(stop);
    press('End');
    expect(document.activeElement).toBe(retry);
    press('Home');
    expect(document.activeElement).toBe(open);
  });

  it('consumes the keys it walks with, and stops them: the strip behind must not move with them', () => {
    const { host } = mount();
    const behind = vi.fn();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    document.addEventListener('keydown', behind);
    for (const key of ['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(press(key).defaultPrevented, key).toBe(true);
    }

    expect(behind).not.toHaveBeenCalled();
    expect(host.contains(document.activeElement)).toBe(true);
    document.removeEventListener('keydown', behind);
  });

  it('leaves the keys it does not own: a modified key, a letter, a card with no controls to walk', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    press('ArrowDown');
    for (const init of [{ key: 'ArrowDown', shiftKey: true }, { key: 'Home', ctrlKey: true }, { key: 'End', metaKey: true }, { key: 'ArrowUp', altKey: true }, { key: 'Tab', ctrlKey: true }, { key: 'Tab', altKey: true }, { key: 'x' }, { key: 'Enter' }]) {
      expect(press(init.key, init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }

    expect(document.activeElement).toBe(controlsOf(host)[0]);
    press('Escape');
    const text = tab('plain');
    tabTo(text.trigger);
    press('ArrowDown');
    expect(keyOf(cards)).toBe('plain');
    expect(controlsOf(host)).toHaveLength(0);
    // The press that opened a card with nothing to walk was consumed once; keys on the trigger are the trigger's again.
    expect(press('Tab').defaultPrevented).toBe(false);
  });

  it('does not walk onto a button that cannot take the focus', () => {
    const { host } = mount();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    const stop = defined(controlsOf(host)[1]);
    stop.setAttribute('disabled', '');
    expect(controlsOf(host)).toHaveLength(2);
    press('Tab');
    expect(document.activeElement).toBe(controlsOf(host)[1]);
  });

  it('starts from the first control when the focus is in the card but not on a control, and from the last for Shift+Tab and Up', () => {
    const { host } = mount();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    const text = host.querySelector('p') as HTMLElement;
    text.setAttribute('tabindex', '-1');
    text.focus();
    press('Tab');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    text.focus();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    text.focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    text.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
  });

  it('is entered once per card: later settles do not pull the focus back', () => {
    const { cards, host } = mount();
    tabTo(tab('b').trigger);
    press('ArrowDown');
    press('Tab');
    expect(document.activeElement).toBe(controlsOf(host)[1]);
    cards.settle(undefined);
    cards.settle(undefined);
    expect(document.activeElement).toBe(controlsOf(host)[1]);
  });

  it('upgrades a card that the pointer opened when the Down arrow comes: the card is entered after it is drawn', () => {
    const { cards, host } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    tabTo(trigger);
    expect(keyOf(cards)).toBe('a');
    press('ArrowDown');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
  });
});

describe('a clamped card', () => {
  type Box = readonly [top: number, bottom: number];
  /** The scrollport of the body, in viewport pixels: 100 px high. */
  const VIEW: Box = [100, 200];

  /**
   * A card of three controls ("Open", "Stop", "Retry"), clamped or not. jsdom has no layout, so the body gets the scrollport above and each control
   * the box it would have with the body scrolled to the top, moved up by the body's `scrollTop`, as a browser moves it.
   */
  function drawn(boxes: Readonly<Record<'Open' | 'Stop' | 'Retry', Box>>, clamp = true) {
    const fixture = mount();
    const { root, trigger } = tab('b');
    if (clamp) {
      layout(root, 100, 400, 1200, 28);
      size(fixture.host, 336, 880);
    }

    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function boxOf(this: HTMLElement) {
      const body = fixture.host.firstElementChild;
      if (!(body instanceof HTMLElement)) {
        return original.call(this);
      }

      if (this === body) {
        return rectOf(0, VIEW[0], 336, VIEW[1] - VIEW[0]);
      }

      const box = body.contains(this) ? boxes[this.textContent as keyof typeof boxes] : undefined;
      return box === undefined ? original.call(this) : rectOf(0, box[0] - body.scrollTop, 100, box[1] - box[0]);
    });
    const scrolled = () => (fixture.host.firstElementChild as HTMLElement).scrollTop;
    return { ...fixture, trigger, scrolled };
  }

  it('scrolls the body only as far as a control needs to be seen, going down and coming back up, and wraps', () => {
    const { host, trigger, scrolled } = drawn({ Open: [100, 130], Stop: [140, 170], Retry: [210, 240] });
    tabTo(trigger);
    press('ArrowDown');
    expect(host.getAttribute('data-ov-clamped')).toBe('true');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(scrolled()).toBe(0);
    press('Tab');
    expect(scrolled()).toBe(0);
    press('Tab');
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    expect(scrolled()).toBe(40);
    press('Tab');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(scrolled()).toBe(0);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    expect(scrolled()).toBe(40);
    // Stop is already in the scrollport: nothing moves.
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(controlsOf(host)[1]);
    expect(scrolled()).toBe(40);
    press('End');
    expect(scrolled()).toBe(40);
    press('Home');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(scrolled()).toBe(0);
    press('ArrowUp');
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    expect(scrolled()).toBe(40);
    press('ArrowDown');
    expect(document.activeElement).toBe(controlsOf(host)[0]);
    expect(scrolled()).toBe(0);
  });

  it('reveals the first control when the Down arrow enters a card whose first control is below the fold, and never scrolls the page', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    try {
      const { host, trigger, scrolled } = drawn({ Open: [260, 290], Stop: [300, 330], Retry: [340, 370] });
      tabTo(trigger);
      press('ArrowDown');
      expect(document.activeElement).toBe(controlsOf(host)[0]);
      expect(scrolled()).toBe(90);
      press('Tab');
      expect(document.activeElement).toBe(controlsOf(host)[1]);
      expect(scrolled()).toBe(130);
      // Open (130 to 160 on screen now) is inside the scrollport: going back to it moves nothing.
      press('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(controlsOf(host)[0]);
      expect(scrolled()).toBe(130);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('leaves the body alone when the card is not clamped: it does not scroll', () => {
    const { host, trigger, scrolled } = drawn({ Open: [100, 130], Stop: [140, 170], Retry: [210, 240] }, false);
    tabTo(trigger);
    press('ArrowDown');
    press('End');
    expect(host.hasAttribute('data-ov-clamped')).toBe(false);
    expect(document.activeElement).toBe(controlsOf(host)[2]);
    expect(scrolled()).toBe(0);
  });
});

describe('the announcement', () => {
  it('says its sentence once, through the live region, when keyboard focus opens a card that has controls', async () => {
    const { cards, region } = mount();
    const { trigger } = tab('a');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    tabTo(trigger);
    advance(499);
    expect(region.textContent).toBe('');
    advance(1);
    expect(region.textContent).toBe(SAY);
    cards.settle(SAY);
    cards.settle(SAY);
    await flush();
    expect(records).toHaveLength(1);
    observer.disconnect();
  });

  it('clears it when the card closes, and says it again when the card is opened again', () => {
    const { region } = mount();
    const { trigger } = tab('a');
    tabTo(trigger);
    advance(500);
    expect(region.textContent).toBe(SAY);
    press('Escape');
    expect(region.textContent).toBe('');
    trigger.blur();
    tabTo(trigger);
    advance(500);
    expect(region.textContent).toBe(SAY);
  });

  it('says nothing for the pointer', () => {
    const { region } = mount();
    hover(tab('a').trigger);
    expect(region.textContent).toBe('');
  });

  it('says nothing for a card with no controls, or with no sentence, or with a blank one', () => {
    const { region } = mount();
    for (const key of ['plain', 'silent', 'blank']) {
      const { trigger } = tab(key);
      tabTo(trigger);
      advance(500);
      expect(region.textContent, key).toBe('');
      trigger.blur();
    }
  });

  it('says nothing when the Down arrow took the focus into the card: it is where it was going', () => {
    const { region } = mount();
    tabTo(tab('a').trigger);
    press('ArrowDown');
    expect(region.textContent).toBe('');
  });

  it('says it when the keyboard arrives at a card the pointer opened', () => {
    const { region } = mount();
    const { trigger } = tab('a');
    hover(trigger);
    expect(region.textContent).toBe('');
    tabTo(trigger);
    expect(region.textContent).toBe(SAY);
  });

  it('says it when a card that had nothing to reach gets controls while the keyboard has it', () => {
    const { cards, host, region } = mount();
    const { trigger } = tab('plain');
    tabTo(trigger);
    advance(500);
    expect(region.textContent).toBe('');
    host.append(draw(1));
    cards.settle(SAY);
    expect(region.textContent).toBe(SAY);
  });
});

describe('placement', () => {
  it('places the card below its anchor, from its left edge, in whole pixels, and says which side', () => {
    const { host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 400.4, 300, 200, 28);
    layout(trigger, 410, 300, 80, 28);
    hover(trigger);
    expect(host.style.left).toBe('400px');
    expect(host.style.top).toBe(`${300 + 28 + GAP}px`);
    expect(host.getAttribute('data-placement')).toBe('bottom');
    expect(host.style.maxHeight).toBe('');
    expect(host.hasAttribute('data-ov-clamped')).toBe(false);
  });

  it('hangs from the trigger itself when it has no anchor', () => {
    const { host } = mount();
    const alone = document.createElement('button');
    alone.setAttribute('data-ov-card', 'a');
    document.body.append(alone);
    layout(alone, 120, 40, 60, 24);
    hover(alone);
    expect(host.style.left).toBe('120px');
    expect(host.style.top).toBe(`${40 + 24 + GAP}px`);
  });

  it('goes above near the bottom of the window, and keeps 8 px from the edge near a side', () => {
    const { host } = mount();
    const low = tab('a');
    const edge = tab('b');
    layout(low.root, 400, 868, 100, 28);
    layout(edge.root, 1436, 300, 4, 28);
    size(host, 300, 180);
    hover(low.trigger);
    expect(host.getAttribute('data-placement')).toBe('top');
    expect(host.style.top).toBe(`${868 - GAP - 180}px`);
    movePointer(edge.trigger);
    expect(host.getAttribute('data-placement')).toBe('bottom');
    expect(host.style.left).toBe(`${1440 - MARGIN - 300}px`);
  });

  it('limits its height, and says so, when neither side has room for all of it', () => {
    const { host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 100, 400, 1200, 28);
    size(host, 336, 880);
    hover(trigger);
    expect(host.getAttribute('data-placement')).toBe('bottom');
    expect(host.style.maxHeight).toBe(`${900 - MARGIN - GAP - 428}px`);
    expect(host.getAttribute('data-ov-clamped')).toBe('true');
    expect(host.style.top).toBe(`${428 + GAP}px`);
  });

  it('starts the next placement clean: no height limit and no side left over from the last card', () => {
    const { host } = mount();
    const one = tab('a');
    const two = tab('b');
    layout(one.root, 100, 400, 1200, 28);
    layout(two.root, 100, 20, 100, 28);
    size(host, 336, 880);
    hover(one.trigger);
    expect(host.style.maxHeight).not.toBe('');
    size(host, 300, 180);
    movePointer(two.trigger);
    expect(host.style.maxHeight).toBe('');
    expect(host.hasAttribute('data-ov-clamped')).toBe(false);
    expect(host.getAttribute('data-placement')).toBe('bottom');
  });

  it('is placed after its content is in: the first thing that is measured is the content', () => {
    const { host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 400, 868, 100, 28);
    // The card is 180 high with its content in; an empty host would be 0 high and fit below the anchor, not above it.
    Object.defineProperty(host, 'offsetHeight', { configurable: true, get: () => (host.childElementCount === 0 ? 0 : 180) });
    hover(trigger);
    expect(host.getAttribute('data-placement')).toBe('top');
  });

  it('places the card again when it is settled again: a card that changed size', () => {
    const { cards, host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 400, 600, 100, 28);
    hover(trigger);
    expect(host.getAttribute('data-placement')).toBe('bottom');
    size(host, 300, 400);
    cards.settle(undefined);
    expect(host.getAttribute('data-placement')).toBe('top');
    expect(host.style.top).toBe(`${600 - GAP - 400}px`);
  });

  it('places the card again when it changes size by itself, where the engine has a ResizeObserver', () => {
    type Watcher = { readonly callback: () => void; readonly observed: Element[]; disconnected: boolean };
    const observers: Watcher[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly watcher: Watcher;
        constructor(callback: () => void) {
          this.watcher = { callback, observed: [], disconnected: false };
          observers.push(this.watcher);
        }

        observe(element: Element) {
          this.watcher.observed.push(element);
        }

        disconnect() {
          this.watcher.disconnected = true;
        }
      },
    );
    const { host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 400, 600, 100, 28);
    expect(observers).toHaveLength(0);
    hover(trigger);
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observed).toEqual([host]);
    expect(host.getAttribute('data-placement')).toBe('bottom');
    size(host, 300, 400);
    observers[0]?.callback();
    expect(host.getAttribute('data-placement')).toBe('top');
    // Closed, it is no longer watched, and a callback that comes late does nothing.
    press('Escape');
    expect(observers[0]?.disconnected).toBe(true);
    const top = host.style.top;
    observers[0]?.callback();
    expect(host.style.top).toBe(top);
  });

  it('leaves its own element clean when it closes: no position, no side, no limit', () => {
    const { host } = mount();
    const { root, trigger } = tab('a');
    layout(root, 100, 400, 1200, 28);
    size(host, 336, 880);
    hover(trigger);
    expect(host.getAttribute('style')).not.toBe('');
    press('Escape');
    expect(host.style.left).toBe('');
    expect(host.style.top).toBe('');
    expect(host.style.maxHeight).toBe('');
    expect(host.hasAttribute('data-placement')).toBe(false);
    expect(host.hasAttribute('data-ov-clamped')).toBe(false);
    expect(isOpen(host)).toBe(false);
  });
});

describe('what it leaves alone', () => {
  it('never writes the document root or the body, while it opens, moves and closes', () => {
    const { host } = mount();
    const one = tab('a');
    const two = tab('b');
    layout(one.root, 400, 300, 100, 28);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.body, { attributes: true });
    const writes = rootWrites(() => {
      hover(one.trigger);
      movePointer(two.trigger);
      press('Escape');
      hover(tab('a').trigger);
      movePointer(null);
      advance(GRACE_MS);
    });
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(writes).toEqual([]);
    expect(records).toEqual([]);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect([...document.documentElement.style].filter((property) => property.startsWith('--'))).toEqual([]);
    expect(host.isConnected).toBe(true);
  });

  it('gives the trigger nothing: no description, no popup attributes, no title, and its attributes are its own after', () => {
    mount();
    const { trigger } = tab('a');
    const before = trigger.getAttributeNames().sort();
    hover(trigger);
    tabTo(trigger);
    press('Escape');
    for (const name of ['aria-describedby', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'title']) {
      expect(trigger.hasAttribute(name), name).toBe(false);
    }

    expect(trigger.getAttributeNames().sort()).toEqual(before);
  });

  it('is not given a hover, a focus or a key by an element it did not make: the card of one key never answers for another', () => {
    const { cards } = mount();
    const one = tab('a');
    const two = tab('b');
    hover(one.trigger);
    expect(cards.getSnapshot()).toMatchObject({ key: 'a' });
    expect(cards.getSnapshot()?.trigger).toBe(one.trigger);
    expect(cards.getSnapshot()?.trigger).not.toBe(two.trigger);
  });
});

describe('close()', () => {
  it('closes the card that is open, and is a no-op when none is', () => {
    const { cards, host } = mount();
    cards.close();
    hover(tab('a').trigger);
    cards.close();
    expect(cards.getSnapshot()).toBeNull();
    expect(isOpen(host)).toBe(false);
  });

  it('does nothing before a host is attached, and after it is gone', () => {
    const cards: HoverCards = createHoverCards();
    expect(() => {
      cards.close();
      cards.settle('anything');
    }).not.toThrow();
    const state: CardState = cards.getSnapshot();
    expect(state).toBeNull();
  });
});
