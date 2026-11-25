import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragOut } from './core/tabs';
import { bindStripDrag, dropSlot, stripReceiver } from './stripDrag';

// The pointer's drag of a tab (ch16 S45, S56 to S59), without React and with a frame queue of its own, as the splitter's test has: the drop rule on plain numbers, then what the drag writes to the document, once per
// frame and never to the root, and what it leaves behind when it ends (docs/ui-next/optimisations.md MNR-K3, LIB-32). That the order changes, and what is said of it, is the strip's test (tabs/TabStrip.test.tsx).

describe('the place a drop asks for', () => {
  // Four faces 100 px wide and 4 px apart: their middles are at 50, 154, 258 and 362.
  const spans = (places: ReadonlyArray<readonly [number, number]>) => places.map(([left, right]) => ({ left, right }));
  const faces = spans([[0, 100], [104, 204], [208, 308], [312, 412]]);
  const slot = (x: number, from = 0, zone = 0) => dropSlot(x, faces, from, zone, false);

  it('is the gap before the first face whose middle the pointer has not passed, and the marker stands in the middle of that gap, 2 px from the faces', () => {
    expect([10, 100, 200, 300, 400].map((x) => slot(x, 0).x)).toEqual([-2, 102, 206, 310, 414]);
  });

  it('is the index the tab has once it has left its place, so the two gaps beside the tab itself ask for the place it is in', () => {
    expect([10, 100, 200, 300, 400].map((x) => slot(x, 1).to)).toEqual([0, 1, 1, 2, 3]);
  });

  it('reads right to left in a strip that is, and puts the marker in the same gap', () => {
    const mirrored = faces.map(({ left, right }) => ({ left: 500 - right, right: 500 - left }));
    expect(dropSlot(300, mirrored, 0, 0, true)).toEqual({ to: 1, x: 294, pinned: undefined });
    expect(dropSlot(450, mirrored, 2, 0, true)).toMatchObject({ to: 0, x: 502 });
  });

  it('says which side of the separator of the pinned tabs a drop is on, and puts the marker on that side: the one gap there is two', () => {
    const pinned = spans([[0, 100], [104, 204], [213, 313], [317, 417]]);
    expect(dropSlot(206, pinned, 3, 2, false)).toEqual({ to: 2, x: 206, pinned: true });
    expect(dropSlot(211, pinned, 3, 2, false)).toEqual({ to: 2, x: 211, pinned: false });
  });

  it('leaves it to the index everywhere else: inside the pinned tabs, after them, at the ends, and where nothing is pinned', () => {
    expect([100, 300, 10, 400].map((x) => slot(x, 3, 2).pinned)).toEqual([undefined, undefined, undefined, undefined]);
    expect([10, 400].map((x) => slot(x, 3, 4).pinned)).toEqual([undefined, undefined]);
    expect([10, 200].map((x) => slot(x, 3, 0).pinned)).toEqual([undefined, undefined]);
  });
});

let queue: Array<{ readonly id: number; readonly run: () => void }> = [];
let ids = 0;
// A drag a test leaves running keeps its listeners on the window: every strip a test made is unbound after it.
const unbinds: Array<() => void> = [];

beforeEach(() => {
  queue = [];
  ids = 0;
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    ids += 1;
    queue.push({ id: ids, run });
    return ids;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue = queue.filter((one) => one.id !== id);
  });
});

afterEach(() => {
  for (const unbind of unbinds.splice(0)) {
    unbind();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** One frame: every callback asked for since the last one runs. */
function frame(): void {
  const due = queue;
  queue = [];
  for (const one of due) {
    one.run();
  }
}

const rect = (left: number, right: number) => () => ({ left, right, width: right - left, top: 6, bottom: 34, height: 28, x: left, y: 6, toJSON: () => ({}) });
const pointer = (x: number, y = 20, extra: PointerEventInit = {}): PointerEventInit => ({ bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra });
const fire = (target: EventTarget, type: string, x: number, y?: number, extra?: PointerEventInit) => target.dispatchEvent(new PointerEvent(type, pointer(x, y, extra)));

/** The pointer travels to a point, and the frame that draws it runs. */
const travel = (target: EventTarget, x: number, y?: number, extra?: PointerEventInit) => {
  fire(target, 'pointermove', x, y, extra);
  frame();
};

/** A window with a strip of four tabs, a, b, c and d, each in a face with its close control, and the page they control. jsdom lays nothing out: the faces are 100 px wide and 4 px apart from x = 0, the scroller 500 px wide and 28 px high from y = 6, the page 400 by 300 from (10, 50). */
function setup(pinned = 0, onDragOut?: (id: string) => DragOut | undefined) {
  const onMove = vi.fn();
  const shell = document.createElement('div');
  shell.dataset.shellPart = 'window';
  const scroller = document.createElement('div');
  shell.append(scroller);
  ['a', 'b', 'c', 'd'].forEach((id, at) => {
    const face = document.createElement('div');
    face.dataset.tabId = id;
    face.toggleAttribute('data-pinned', at < pinned);
    face.innerHTML = `<button type="button" role="tab" id="tab-${id}" aria-controls="page" data-tab-id="${id}">${id}</button><button type="button" aria-hidden="true">close</button>`;
    face.getBoundingClientRect = rect(at * 104, at * 104 + 100);
    scroller.append(face);
  });

  scroller.getBoundingClientRect = rect(0, 500);
  const page = document.createElement('div');
  page.id = 'page';
  page.getBoundingClientRect = () => ({ left: 10, right: 410, width: 400, top: 50, bottom: 350, height: 300, x: 10, y: 50, toJSON: () => ({}) });
  shell.append(page);
  document.body.append(shell);
  const unbind = bindStripDrag(scroller, onMove, onDragOut);
  unbinds.push(unbind);
  const part = (name: string) => shell.querySelector<HTMLElement>(`[data-shell-part="${name}"]`);
  const tab = (id: string) => shell.querySelector<HTMLElement>(`#tab-${id}`)!;
  return { onMove, shell, scroller, unbind, tab, face: (id: string) => tab(id).parentElement!, layer: () => part('tabDrag'), marker: () => part('tabDrag')?.firstElementChild as HTMLElement | undefined, zone: () => part('tabDrag')?.firstElementChild as HTMLElement | undefined, ghost: () => part('tabGhost') };
}

/** Presses on the tab `a` at x = 50 and travels to `to`: the drag is begun, and drawn once the frame runs. */
function drag(to: number, y?: number, onDragOut?: (id: string) => DragOut | undefined) {
  const s = setup(0, onDragOut);
  fire(s.tab('a'), 'pointerdown', 50);
  travel(s.scroller, to, y);
  return s;
}

describe('a drag', () => {
  it('begins when the pointer has travelled 6 px and not before: a press that stays under it draws nothing and drops nothing', () => {
    const { tab, scroller, shell, layer, onMove } = setup();
    fire(tab('a'), 'pointerdown', 50);
    travel(scroller, 53, 24);
    expect(shell).not.toHaveAttribute('data-tab-dragging');
    expect(layer()).toBeNull();
    fire(scroller, 'pointerup', 53, 24);
    expect(onMove).not.toHaveBeenCalled();

    fire(tab('a'), 'pointerdown', 50);
    travel(scroller, 56);
    expect(shell).toHaveAttribute('data-tab-dragging');
  });

  it('marks the window and the face and draws one layer, in the window: the marker and a copy of the tab, which has none of the tab\'s ids and is as wide as it', () => {
    const { shell, face, layer, ghost } = drag(300);

    expect(shell).toHaveAttribute('data-tab-dragging');
    expect(face('a')).toHaveAttribute('data-dragging');
    expect(shell.querySelectorAll('[data-shell-part="tabDrag"]')).toHaveLength(1);
    expect(layer()).toHaveAttribute('popover', 'manual');
    expect(layer()?.parentElement).toBe(shell);
    expect(layer()).toContainElement(ghost() ?? null);
    expect(ghost()).toHaveTextContent('a');
    expect(ghost()?.querySelector('[id]')).toBeNull();
    expect(ghost()?.style.inlineSize).toBe('100px');
  });

  it('places the marker in the gap the pointer is over and the ghost at the pointer, 12 px from it, and the root of the document is not touched', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const { marker, ghost } = drag(300);

    expect(marker()?.style.translate).toBe('310px 6px');
    expect(ghost()?.style.translate).toBe('312px 32px');
    expect(root.hasAttribute('data-tab-dragging')).toBe(false);
    expect(root.getAttribute('style')).toBe(before);
  });

  it('writes one position for the marker and one for the ghost in a frame, however many moves come in it, and nothing before it', () => {
    const { scroller } = drag(300);
    const writes = vi.spyOn(Object.getPrototypeOf(scroller.style) as CSSStyleDeclaration, 'translate', 'set');
    for (let x = 301; x <= 310; x += 1) {
      fire(scroller, 'pointermove', x);
    }

    expect(writes).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    frame();
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('asks for the move once, on the release, with the place the marker shows, and leaves nothing behind', () => {
    const { shell, scroller, onMove } = drag(300);
    expect(onMove).not.toHaveBeenCalled();
    fire(scroller, 'pointerup', 300);

    expect(onMove.mock.calls).toEqual([['a', 2, undefined]]);
    expect(shell.querySelector('[data-tab-dragging], [data-dragging], [data-shell-part="tabDrag"], [style]')).toBeNull();
    expect(shell).not.toHaveAttribute('data-tab-dragging');
  });

  it('takes Escape before whatever is below it in the window', () => {
    const { scroller } = drag(300);
    const below = vi.fn();
    document.addEventListener('keydown', below);

    expect(scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))).toBe(false);
    expect(below).not.toHaveBeenCalled();
    document.removeEventListener('keydown', below);
  });

  it('hides the marker 18 px below the strip and drops nothing there, and shows it again within 9 px of the strip, as the window\'s edge does too', () => {
    const { scroller, marker, onMove } = drag(300);
    travel(scroller, 300, 58);
    expect(marker()?.hidden).toBe(false);
    travel(scroller, 300, 59);
    expect(marker()?.hidden).toBe(true);
    travel(scroller, 300, 50);
    expect(marker()?.hidden).toBe(true);
    travel(scroller, 300, 48);
    expect(marker()?.hidden).toBe(false);
    travel(scroller, -5, 20);
    expect(marker()?.hidden).toBe(true);
    travel(scroller, 300, 20);
    travel(scroller, 300, 60);
    fire(scroller, 'pointerup', 300, 60);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('scrolls the strip at its edges, faster the nearer the edge, a step a frame for as long as it can', () => {
    const { scroller } = drag(300);
    let left = 0;
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => (left = Math.min(40, Math.max(0, value))) });

    travel(scroller, 490);
    expect(left).toBe(14);
    frame();
    expect(left).toBe(28);
    travel(scroller, 600);
    expect(left).toBe(40);
    frame();
    expect(queue).toHaveLength(0);
    travel(scroller, 10);
    expect(left).toBe(26);
  });

  it.each([
    ['the secondary button', { button: 2 }],
    ['a touch, which scrolls the strip', { pointerType: 'touch' }],
    ['a pointer that is not the primary one', { isPrimary: false }],
  ])('ignores %s', (_what, extra) => {
    const { tab, scroller, shell } = setup();
    fire(tab('a'), 'pointerdown', 50, 20, extra);
    travel(scroller, 300, 20, extra);

    expect(shell).not.toHaveAttribute('data-tab-dragging');
  });

  it('ignores a press that is not on a tab: the close control, the strip between the tabs, and Control on a Mac, where it is the secondary button', () => {
    const { face, scroller, shell } = setup();
    for (const target of [face('a').lastElementChild!, scroller]) {
      fire(target, 'pointerdown', 50);
      travel(scroller, 300);
      expect(shell).not.toHaveAttribute('data-tab-dragging');
    }

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    fire(face('a').firstElementChild!, 'pointerdown', 50, 20, { ctrlKey: true });
    travel(scroller, 300);
    expect(shell).not.toHaveAttribute('data-tab-dragging');
  });

  it('reads a strip that is right to left from its right edge: the first tab is the one at the right', () => {
    const { scroller, tab, marker, onMove } = setup();
    scroller.style.direction = 'rtl';
    [...scroller.children].forEach((face, at) => {
      (face as HTMLElement).getBoundingClientRect = rect(400 - at * 104, 500 - at * 104);
    });

    fire(tab('a'), 'pointerdown', 450);
    travel(scroller, 300);
    expect(marker()?.style.translate).toBe('294px 6px');
    fire(scroller, 'pointerup', 300);
    expect(onMove.mock.calls).toEqual([['a', 1, undefined]]);
  });

  it('follows the pointer that pressed and no other', () => {
    const { scroller, onMove, marker } = drag(300);
    travel(scroller, 10, 20, { pointerId: 2 });
    expect(marker()?.style.translate).toBe('310px 6px');
    fire(scroller, 'pointerup', 10, 20, { pointerId: 2 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('is ended as a cancel when the strip goes, and the strip no longer starts one', () => {
    const { shell, scroller, tab, unbind, onMove } = drag(300);
    unbind();

    expect(shell.querySelector('[data-tab-dragging], [data-dragging], [data-shell-part="tabDrag"]')).toBeNull();
    fire(scroller, 'pointerup', 300);
    fire(tab('a'), 'pointerdown', 50);
    travel(scroller, 300);
    expect(shell).not.toHaveAttribute('data-tab-dragging');
    expect(onMove).not.toHaveBeenCalled();
  });
});

/** What a strip is given to take a tab out of it: asked for when the pointer first leaves, and told the way the drag goes on. */
const way = () => {
  const session = { move: vi.fn<(x: number, y: number) => void>(), drop: vi.fn<(x: number, y: number) => void>(), cancel: vi.fn<() => void>() };
  return { session, onDragOut: vi.fn<(id: string) => typeof session>(() => session) };
};

describe('a drag out of the strip (ch16 S58)', () => {
  it('asks for the way out once, when the pointer first leaves the strip, tells it where the pointer is while it is out, and drops through it on the release, with the point of the release', () => {
    const { session, onDragOut } = way();
    const { scroller, onMove, shell } = drag(300, 20, onDragOut);
    expect(onDragOut).not.toHaveBeenCalled();

    travel(scroller, 300, 60);
    travel(scroller, 320, 70);
    expect(onDragOut.mock.calls).toEqual([['a']]);
    expect(session.move.mock.calls).toEqual([[300, 60], [320, 70]]);
    fire(scroller, 'pointerup', 330, 72);

    expect(session.drop.mock.calls).toEqual([[330, 72]]);
    expect(session.cancel).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(shell.querySelector('[data-tab-dragging], [data-dragging], [data-shell-part="tabDrag"]')).toBeNull();
  });

  it('is out beyond the window\'s edge as well, and a release in the strip is a drop that has no way out to tell', () => {
    const out = way();
    const edge = drag(-5, 20, out.onDragOut);
    fire(edge.scroller, 'pointerup', -5, 20);
    expect(out.session.drop.mock.calls).toEqual([[-5, 20]]);

    const inside = way();
    const strip = drag(300, 20, inside.onDragOut);
    fire(strip.scroller, 'pointerup', 300);
    expect(inside.onDragOut).not.toHaveBeenCalled();
    expect(strip.onMove.mock.calls).toEqual([['a', 2, undefined]]);
  });

  it.each([
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['the window\'s blur', () => window.dispatchEvent(new Event('blur'))],
    ['a cancelled pointer', () => fire(window, 'pointercancel', 300, 60)],
  ])('cancels the way out when %s ends the drag, and drops nothing', (_cause, end) => {
    const { session, onDragOut } = way();
    const { scroller, onMove } = drag(300, 60, onDragOut);

    end();
    fire(scroller, 'pointerup', 300, 60);

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect([session.drop, onMove].map((fn) => fn.mock.calls.length)).toEqual([0, 0]);
  });

  it('cancels the way out when the pointer comes back into the strip, and asks for another when it goes out again', () => {
    const { session, onDragOut } = way();
    const { scroller, onMove } = drag(300, 60, onDragOut);
    travel(scroller, 300, 48);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    travel(scroller, 310, 40);
    expect(session.move).toHaveBeenCalledTimes(1);
    travel(scroller, 300, 70);
    expect(onDragOut).toHaveBeenCalledTimes(2);
    fire(scroller, 'pointerup', 300, 70);

    expect(session.drop).toHaveBeenCalledTimes(1);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('outlines the page the tab goes to while the pointer is out of the strip, as the zone of S58 does: placed over it, hidden in the strip, and gone with the drag', () => {
    const { scroller, zone, layer } = drag(300, 20, way().onDragOut);
    expect(zone()).toHaveProperty('hidden', true);
    expect(zone()?.style.translate).toBe('10px 50px');
    expect([zone()?.style.inlineSize, zone()?.style.blockSize]).toEqual(['400px', '300px']);

    travel(scroller, 300, 60);
    expect(zone()).toHaveProperty('hidden', false);
    travel(scroller, 300, 48);
    expect(zone()).toHaveProperty('hidden', true);

    travel(scroller, 300, 70);
    const gone = layer();
    fire(scroller, 'pointerup', 300, 70);
    expect(gone?.isConnected).toBe(false);
  });

  it('draws no outline where the strip has nowhere to take the tab: it only cancels there', () => {
    const { layer, scroller, marker, onMove } = drag(300, 60);

    expect(layer()?.children).toHaveLength(2);
    expect(marker()?.hidden).toBe(true);
    fire(scroller, 'pointerup', 300, 60);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('a strip as the place a tab dragged in from another window lands (ch16 S58)', () => {
  const strip = (pinned = 0) => {
    const s = setup(pinned);
    return { ...s, receive: stripReceiver(s.scroller) };
  };

  it('marks the gap the point is over with the marker of the drag, one marker however often it is asked, and answers the index the tab takes there', () => {
    const { shell, receive } = strip();

    expect(receive({ x: 300, y: 20 })).toMatchObject({ to: 3, pinned: undefined });
    const marker = shell.querySelector<HTMLElement>('[data-shell-part="tabDrag"] > :first-child');
    expect(marker?.style.translate).toBe('310px 6px');
    expect(marker?.parentElement?.parentElement).toBe(shell);
    expect(receive({ x: 10, y: 20 })).toMatchObject({ to: 0 });
    expect(shell.querySelectorAll('[data-shell-part="tabDrag"]')).toHaveLength(1);
    expect(marker?.style.translate).toBe('0px 6px');
    expect(receive({ x: 450, y: 20 })).toMatchObject({ to: 4 });
  });

  it('says which side of the separator of the pinned tabs the point is on', () => {
    const { receive } = strip(2);

    expect([205, 207].map((x) => receive({ x, y: 20 })?.pinned)).toEqual([true, false]);
  });

  it('takes the marker away and answers nothing for a point that is not in the strip\'s row (6 px above or below it) and for none', () => {
    const { shell, receive } = strip();
    const layer = () => shell.querySelector('[data-shell-part="tabDrag"]');

    for (const point of [{ x: 300, y: 41 }, { x: 300, y: -1 }, undefined]) {
      receive({ x: 300, y: 20 });
      expect(layer()).not.toBeNull();
      expect(receive(point)).toBeUndefined();
      expect(layer()).toBeNull();
    }

    expect(receive({ x: 300, y: 40 })).toBeDefined();
    expect(receive({ x: 300, y: 0 })).toBeDefined();
  });
});
