import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindStripDrag, dropSlot } from './stripDrag';

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

/** A window with a strip of four tabs, a, b, c and d, each in a face with its close control. jsdom lays nothing out: the faces are 100 px wide and 4 px apart from x = 0, the scroller 500 px wide and 28 px high from y = 6. */
function setup(pinned = 0) {
  const onMove = vi.fn();
  const shell = document.createElement('div');
  shell.dataset.shellPart = 'window';
  const scroller = document.createElement('div');
  shell.append(scroller);
  ['a', 'b', 'c', 'd'].forEach((id, at) => {
    const face = document.createElement('div');
    face.dataset.tabId = id;
    face.toggleAttribute('data-pinned', at < pinned);
    face.innerHTML = `<button type="button" role="tab" id="tab-${id}" data-tab-id="${id}">${id}</button><button type="button" aria-hidden="true">close</button>`;
    face.getBoundingClientRect = rect(at * 104, at * 104 + 100);
    scroller.append(face);
  });

  scroller.getBoundingClientRect = rect(0, 500);
  document.body.append(shell);
  const unbind = bindStripDrag(scroller, onMove);
  unbinds.push(unbind);
  const part = (name: string) => shell.querySelector<HTMLElement>(`[data-shell-part="${name}"]`);
  const tab = (id: string) => shell.querySelector<HTMLElement>(`#tab-${id}`)!;
  return { onMove, shell, scroller, unbind, tab, face: (id: string) => tab(id).parentElement!, layer: () => part('tabDrag'), marker: () => part('tabDrag')?.firstElementChild as HTMLElement | undefined, ghost: () => part('tabGhost') };
}

/** Presses on the tab `a` at x = 50 and travels to `to`: the drag is begun, and drawn once the frame runs. */
function drag(to: number, y?: number) {
  const s = setup();
  fire(s.tab('a'), 'pointerdown', 50);
  fire(s.scroller, 'pointermove', to, y);
  frame();
  return s;
}

describe('a drag', () => {
  it('begins when the pointer has travelled 6 px and not before: a press that stays under it draws nothing and drops nothing', () => {
    const { tab, scroller, shell, layer, onMove } = setup();
    fire(tab('a'), 'pointerdown', 50);
    fire(scroller, 'pointermove', 53, 24);
    frame();
    expect(shell).not.toHaveAttribute('data-tab-dragging');
    expect(layer()).toBeNull();
    fire(scroller, 'pointerup', 53, 24);
    expect(onMove).not.toHaveBeenCalled();

    fire(tab('a'), 'pointerdown', 50);
    fire(scroller, 'pointermove', 56);
    frame();
    expect(shell).toHaveAttribute('data-tab-dragging');
  });

  it('marks the window and the face and draws one layer, in the window: the marker and a copy of the tab, which has none of the tab\'s ids and is as wide as it', () => {
    const { shell, face, layer, marker, ghost } = drag(300);

    expect(shell).toHaveAttribute('data-tab-dragging');
    expect(face('a')).toHaveAttribute('data-dragging');
    expect(shell.querySelectorAll('[data-shell-part="tabDrag"]')).toHaveLength(1);
    expect(layer()).toHaveAttribute('popover', 'manual');
    expect(layer()?.parentElement).toBe(shell);
    expect(layer()).toContainElement(marker() ?? null);
    expect(ghost()).toHaveTextContent('a');
    expect(ghost()?.querySelector('[id]')).toBeNull();
    expect(document.querySelectorAll('#tab-a')).toHaveLength(1);
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

  it('tells which side of the separator the drop is on, for the strip\'s own rule of the pinned tabs', () => {
    const { tab, scroller, onMove } = setup(2);
    fire(tab('d'), 'pointerdown', 360);
    fire(scroller, 'pointermove', 200);
    frame();
    fire(scroller, 'pointerup', 200);
    fire(tab('d'), 'pointerdown', 360);
    fire(scroller, 'pointermove', 212);
    frame();
    fire(scroller, 'pointerup', 212);

    expect(onMove.mock.calls).toEqual([['d', 2, true], ['d', 2, false]]);
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
    const at = (x: number, y: number) => {
      fire(scroller, 'pointermove', x, y);
      frame();
    };

    at(300, 58);
    expect(marker()?.hidden).toBe(false);
    at(300, 59);
    expect(marker()?.hidden).toBe(true);
    at(300, 50);
    expect(marker()?.hidden).toBe(true);
    at(300, 48);
    expect(marker()?.hidden).toBe(false);
    at(-5, 20);
    expect(marker()?.hidden).toBe(true);
    at(300, 20);
    at(300, 60);
    fire(scroller, 'pointerup', 300, 60);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('scrolls the strip at its edges, faster the nearer the edge, a step a frame for as long as it can', () => {
    const { scroller } = drag(300);
    let left = 0;
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => (left = Math.min(40, Math.max(0, value))) });

    fire(scroller, 'pointermove', 490);
    frame();
    expect(left).toBe(14);
    frame();
    expect(left).toBe(28);
    fire(scroller, 'pointermove', 600);
    frame();
    expect(left).toBe(40);
    frame();
    expect(queue).toHaveLength(0);
    fire(scroller, 'pointermove', 10);
    frame();
    expect(left).toBe(26);
  });

  it.each([
    ['the secondary button', { button: 2 }],
    ['a touch, which scrolls the strip', { pointerType: 'touch' }],
    ['a pointer that is not the primary one', { isPrimary: false }],
  ])('ignores %s', (_what, extra) => {
    const { tab, scroller, shell } = setup();
    fire(tab('a'), 'pointerdown', 50, 20, extra);
    fire(scroller, 'pointermove', 300, 20, extra);
    frame();

    expect(shell).not.toHaveAttribute('data-tab-dragging');
  });

  it('ignores a press that is not on a tab: the close control, the strip between the tabs, and Control on a Mac, where it is the secondary button', () => {
    const { face, scroller, shell } = setup();
    for (const target of [face('a').lastElementChild!, scroller]) {
      fire(target, 'pointerdown', 50);
      fire(scroller, 'pointermove', 300);
      frame();
      expect(shell).not.toHaveAttribute('data-tab-dragging');
    }

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    fire(face('a').firstElementChild!, 'pointerdown', 50, 20, { ctrlKey: true });
    fire(scroller, 'pointermove', 300);
    frame();
    expect(shell).not.toHaveAttribute('data-tab-dragging');
  });

  it('reads a strip that is right to left from its right edge: the first tab is the one at the right', () => {
    const { scroller, tab, marker, onMove } = setup();
    scroller.style.direction = 'rtl';
    [...scroller.children].forEach((face, at) => {
      (face as HTMLElement).getBoundingClientRect = rect(400 - at * 104, 500 - at * 104);
    });

    fire(tab('a'), 'pointerdown', 450);
    fire(scroller, 'pointermove', 300);
    frame();
    expect(marker()?.style.translate).toBe('294px 6px');
    fire(scroller, 'pointerup', 300);
    expect(onMove.mock.calls).toEqual([['a', 1, undefined]]);
  });

  it('follows the pointer that pressed and no other', () => {
    const { scroller, onMove, marker } = drag(300);
    fire(scroller, 'pointermove', 10, 20, { pointerId: 2 });
    frame();
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
    fire(scroller, 'pointermove', 300);
    frame();
    expect(shell).not.toHaveAttribute('data-tab-dragging');
    expect(onMove).not.toHaveBeenCalled();
  });
});
