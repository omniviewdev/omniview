import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowMenu, type RowMenuHandle, type RowMenuState } from './handle';

// The handle is the part's one owner of what is open, for which row and from which trigger. It works on plain elements (no React here):
// the popup component only draws what the handle says. These tests are the contract of the handle itself: what it writes on the active
// trigger, which listeners and observers it holds and when, and what it does with focus when the menu closes (docs/ui-next/optimisations.md
// T-08, MNR-T6; the focus rules are the menu button pattern's and the mock's, shell-menu.js).
type Row = { readonly key: string };
const ROW_A: Row = { key: 'a' };
const ROW_B: Row = { key: 'b' };

let nodes: HTMLElement[] = [];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    created.setAttribute(name, value);
  }

  parent.append(created);
  return created;
}

/** A table region (a Tab stop, as the DataTable's is) holding two triggers, a control outside it, and the popup the component would draw. */
function page(handle: RowMenuHandle<Row>, { region: tabindex = true }: { region?: boolean } = {}) {
  const host = element('div', document.body);
  nodes.push(host);
  const region = element('div', host, tabindex ? { role: 'region', tabindex: '0' } : { role: 'region' });
  const first = element('button', element('div', region), { type: 'button', 'aria-haspopup': 'menu' });
  const second = element('button', element('div', region), { type: 'button', 'aria-haspopup': 'menu' });
  const outside = element('button', host, { type: 'button' });
  const popup = element('div', host, { id: handle.id, role: 'menu', tabindex: '-1' });
  const item = element('button', popup, { type: 'button', role: 'menuitem', tabindex: '-1' });
  return { host, region, first, second, outside, popup, item };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Listeners the handle adds to the window or the document, live (added and not yet removed), as `target:type:capture`. The window of the test
// environment keeps its own bound methods, so they are replaced on the window itself; every other target goes through EventTarget.prototype.
function trackListeners() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const windowAdd = window.addEventListener;
  const windowRemove = window.removeEventListener;
  const ids = new WeakMap<object, number>();
  const live = new Set<string>();
  let next = 0;
  const key = (name: 'window' | 'document', type: string, listener: unknown, options: unknown) => {
    if (typeof listener !== 'function') {
      return undefined;
    }

    let id = ids.get(listener);
    if (id === undefined) {
      next += 1;
      id = next;
      ids.set(listener, id);
    }

    const capture = typeof options === 'boolean' ? options : (options as { capture?: boolean } | undefined)?.capture === true;
    return `${name}:${type}:${String(capture)}:${id}`;
  };

  EventTarget.prototype.addEventListener = function patched(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    const entry = this === document ? key('document', type, listener, options) : undefined;
    if (entry !== undefined) {
      live.add(entry);
    }

    add.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function patched(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const entry = this === document ? key('document', type, listener, options) : undefined;
    if (entry !== undefined) {
      live.delete(entry);
    }

    remove.call(this, type, listener, options);
  };

  window.addEventListener = function patched(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    const entry = key('window', type, listener, options);
    if (entry !== undefined) {
      live.add(entry);
    }

    windowAdd.call(window, type, listener, options);
  } as typeof window.addEventListener;

  window.removeEventListener = function patched(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const entry = key('window', type, listener, options);
    if (entry !== undefined) {
      live.delete(entry);
    }

    windowRemove.call(window, type, listener, options);
  } as typeof window.removeEventListener;

  return {
    live: () => [...live].map((entry) => entry.split(':').slice(0, 3).join(':')).sort(),
    stop: () => {
      EventTarget.prototype.addEventListener = add;
      EventTarget.prototype.removeEventListener = remove;
      window.addEventListener = windowAdd;
      window.removeEventListener = windowRemove;
    },
  };
}

// MutationObservers made and disconnected while it counts, in the order they were made.
function countObservers() {
  const created: MutationObserver[] = [];
  const disconnected: number[] = [];
  const Real = MutationObserver;
  class Counting extends Real {
    constructor(callback: MutationCallback) {
      super(callback);
      created.push(this);
    }

    override disconnect() {
      disconnected.push(created.indexOf(this));
      super.disconnect();
    }
  }

  vi.stubGlobal('MutationObserver', Counting);
  return { created, disconnected };
}

const epochOf = (state: RowMenuState<Row>) => (state.open ? state.epoch : -1);

beforeEach(() => {
  nodes = [];
});

afterEach(() => {
  for (const node of nodes) {
    node.remove();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createRowMenu', () => {
  it('returns a closed handle with a popup id of its own; no two handles share one', () => {
    const one = createRowMenu<Row>();
    const two = createRowMenu<Row>();
    expect(one.id).toMatch(/^ov-row-menu-\d+$/);
    expect(two.id).not.toBe(one.id);
    expect(one.getSnapshot()).toEqual({ open: false });
    expect(one.getSnapshot()).toBe(one.getSnapshot());
  });

  it('holds no listener and no observer until a menu opens', () => {
    const listeners = trackListeners();
    const observers = countObservers();
    try {
      createRowMenu<Row>();
      expect(listeners.live()).toEqual([]);
      expect(observers.created).toHaveLength(0);
    } finally {
      listeners.stop();
    }
  });

  it('opens for a row from an anchor, and says so to every subscriber once, with a number that is new for each opening', () => {
    const handle = createRowMenu<Row>();
    const { first, second } = page(handle);
    const heard = vi.fn();
    const alsoHeard = vi.fn();
    handle.subscribe(heard);
    handle.subscribe(alsoHeard);
    handle.open(first, ROW_A);
    const opened = handle.getSnapshot();
    expect(opened).toMatchObject({ open: true, row: ROW_A, anchor: first, focus: 'first' });
    expect(Object.keys(opened).sort()).toEqual(['anchor', 'epoch', 'focus', 'open', 'row']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(alsoHeard).toHaveBeenCalledTimes(1);
    expect(handle.getSnapshot()).toBe(opened);
    handle.close();
    handle.open(second, ROW_B, 'last');
    const again = handle.getSnapshot();
    expect(again).toMatchObject({ open: true, row: ROW_B, anchor: second, focus: 'last' });
    expect(epochOf(again)).toBeGreaterThan(epochOf(opened));
  });

  it('stops telling a subscriber that has unsubscribed', () => {
    const handle = createRowMenu<Row>();
    const { first } = page(handle);
    const heard = vi.fn();
    const stop = handle.subscribe(heard);
    stop();
    handle.open(first, ROW_A);
    expect(heard).not.toHaveBeenCalled();
  });

  it('toggles: the same anchor closes it, another anchor opens it for that anchor\'s row', () => {
    const handle = createRowMenu<Row>();
    const { first, second } = page(handle);
    handle.toggle(first, ROW_A, 'menu');
    expect(handle.getSnapshot()).toMatchObject({ open: true, row: ROW_A, focus: 'menu' });
    handle.toggle(first, ROW_A, 'menu');
    expect(handle.getSnapshot()).toEqual({ open: false });
    handle.toggle(first, ROW_A);
    handle.toggle(second, ROW_B);
    expect(handle.getSnapshot()).toMatchObject({ open: true, row: ROW_B, anchor: second });
  });

  it('closes once: a second close tells nobody and a close of a closed menu does nothing', () => {
    const handle = createRowMenu<Row>();
    const { first } = page(handle);
    const heard = vi.fn();
    handle.close();
    handle.open(first, ROW_A);
    handle.subscribe(heard);
    handle.close();
    handle.close();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('what the handle writes on the active trigger', () => {
  it('sets aria-expanded and aria-controls on the one trigger that is open, and nowhere else', () => {
    const handle = createRowMenu<Row>();
    const { first, second } = page(handle);
    for (const trigger of [first, second]) {
      expect(trigger.hasAttribute('aria-expanded')).toBe(false);
      expect(trigger.hasAttribute('aria-controls')).toBe(false);
    }

    handle.open(first, ROW_A);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-controls')).toBe(handle.id);
    expect(document.getElementById(handle.id)?.getAttribute('role')).toBe('menu');
    expect(second.hasAttribute('aria-expanded')).toBe(false);
    expect(second.hasAttribute('aria-controls')).toBe(false);
  });

  it('moves them to the next trigger when the menu opens from another one, and takes them off on close', () => {
    const handle = createRowMenu<Row>();
    const { first, second } = page(handle);
    handle.open(first, ROW_A);
    handle.open(second, ROW_B);
    expect(first.hasAttribute('aria-expanded')).toBe(false);
    expect(first.hasAttribute('aria-controls')).toBe(false);
    expect(second.getAttribute('aria-expanded')).toBe('true');
    handle.close();
    expect(second.hasAttribute('aria-expanded')).toBe(false);
    expect(second.hasAttribute('aria-controls')).toBe(false);
  });
});

describe('the listeners and the observer of an open menu', () => {
  it('holds none while closed, exactly three while open (a press, a scroll and a resize), and none after it closes', () => {
    const listeners = trackListeners();
    try {
      const handle = createRowMenu<Row>();
      const { first } = page(handle);
      expect(listeners.live()).toEqual([]);
      handle.open(first, ROW_A);
      expect(listeners.live()).toEqual(['window:pointerdown:true', 'window:resize:false', 'window:scroll:true']);
      handle.close();
      expect(listeners.live()).toEqual([]);
    } finally {
      listeners.stop();
    }
  });

  it('holds the same three when the menu moves to another trigger, never six', () => {
    const listeners = trackListeners();
    try {
      const handle = createRowMenu<Row>();
      const { first, second } = page(handle);
      handle.open(first, ROW_A);
      handle.open(second, ROW_B);
      expect(listeners.live()).toHaveLength(3);
      handle.close();
      expect(listeners.live()).toEqual([]);
    } finally {
      listeners.stop();
    }
  });

  it('creates one MutationObserver when it opens and disconnects it when it closes', () => {
    const observers = countObservers();
    const handle = createRowMenu<Row>();
    const { first, second } = page(handle);
    expect(observers.created).toHaveLength(0);
    handle.open(first, ROW_A);
    expect(observers.created).toHaveLength(1);
    expect(observers.disconnected).toEqual([]);
    handle.open(second, ROW_B);
    expect(observers.created).toHaveLength(2);
    expect(observers.disconnected).toEqual([0]);
    handle.close();
    expect(observers.disconnected).toEqual([0, 1]);
    handle.close();
    expect(observers.disconnected).toEqual([0, 1]);
  });
});

describe('closing', () => {
  it('closes on a press outside the menu and its trigger, and returns focus to the trigger first', () => {
    const handle = createRowMenu<Row>();
    const { first, outside, item } = page(handle);
    handle.open(first, ROW_A);
    item.focus();
    fireEvent.pointerDown(outside);
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(document.activeElement).toBe(first);
  });

  it('stays open for a press inside the popup, and for a press on its own trigger (the click toggles it)', () => {
    const handle = createRowMenu<Row>();
    const { first, popup, item } = page(handle);
    handle.open(first, ROW_A);
    fireEvent.pointerDown(popup);
    fireEvent.pointerDown(item);
    fireEvent.pointerDown(first);
    expect(handle.getSnapshot().open).toBe(true);
  });

  it('closes when the page scrolls under it: the viewport, the table region, anything that holds the trigger; not a scroll elsewhere or in the popup', () => {
    const handle = createRowMenu<Row>();
    const { first, region, outside, popup } = page(handle);
    handle.open(first, ROW_A);
    fireEvent.scroll(outside);
    fireEvent.scroll(popup);
    expect(handle.getSnapshot().open).toBe(true);
    fireEvent.scroll(region);
    expect(handle.getSnapshot().open).toBe(false);
    handle.open(first, ROW_A);
    fireEvent.scroll(document);
    expect(handle.getSnapshot().open).toBe(false);
    handle.open(first, ROW_A);
    fireEvent.scroll(window);
    expect(handle.getSnapshot().open).toBe(false);
  });

  it('closes when the window is resized: it is placed once, so it does not follow', () => {
    const handle = createRowMenu<Row>();
    const { first } = page(handle);
    handle.open(first, ROW_A);
    fireEvent(window, new Event('resize'));
    expect(handle.getSnapshot().open).toBe(false);
  });

  it('returns focus to the trigger without scrolling it into view, when focus is in the popup', () => {
    const handle = createRowMenu<Row>();
    const { first, item } = page(handle);
    const focus = vi.spyOn(first, 'focus');
    handle.open(first, ROW_A);
    item.focus();
    handle.close();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(first);
  });

  it('returns focus to the trigger when focus is nowhere (the body)', () => {
    const handle = createRowMenu<Row>();
    const { first } = page(handle);
    handle.open(first, ROW_A);
    expect(document.activeElement).toBe(document.body);
    handle.close();
    expect(document.activeElement).toBe(first);
  });

  it('does not take focus from an element that has it: the user went there', () => {
    const handle = createRowMenu<Row>();
    const { first, outside } = page(handle);
    handle.open(first, ROW_A);
    outside.focus();
    handle.close();
    expect(document.activeElement).toBe(outside);
  });

  it('leaves focus alone when told not to restore it', () => {
    const handle = createRowMenu<Row>();
    const { first, item } = page(handle);
    handle.open(first, ROW_A);
    item.focus();
    handle.close({ restoreFocus: false });
    expect(document.activeElement).toBe(item);
    expect(first.hasAttribute('aria-expanded')).toBe(false);
  });
});

describe('the trigger leaves the page while the menu is open', () => {
  it('closes the menu and moves focus to the nearest focusable ancestor of the trigger: the table region (a virtual row left the window, or its record was deleted)', async () => {
    const handle = createRowMenu<Row>();
    const { first, region, item } = page(handle);
    handle.open(first, ROW_A);
    item.focus();
    first.parentElement?.remove();
    await flush();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(document.activeElement).toBe(region);
  });

  it('falls back to the document body when the trigger has no focusable ancestor', async () => {
    const handle = createRowMenu<Row>();
    const { first, item } = page(handle, { region: false });
    handle.open(first, ROW_A);
    item.focus();
    first.remove();
    await flush();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(document.activeElement).toBe(document.body);
  });

  it('does not look at the trigger when nothing was removed: a mutation elsewhere keeps the menu open', async () => {
    const handle = createRowMenu<Row>();
    const { first, outside } = page(handle);
    handle.open(first, ROW_A);
    outside.remove();
    await flush();
    expect(handle.getSnapshot().open).toBe(true);
  });

  it('leaves the other focus alone when the user already moved it', async () => {
    const handle = createRowMenu<Row>();
    const { first, outside } = page(handle);
    handle.open(first, ROW_A);
    outside.focus();
    first.remove();
    await flush();
    expect(handle.getSnapshot().open).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});
