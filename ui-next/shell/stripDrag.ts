import { platformOf } from './core/chords';
import type { DragOut, TabPlace, TabReceiver } from './core/tabs';
import styles from './stripDrag.module.css';

// The pointer's way to move a tab in a strip (ch16 S45, S56 to S59), bound by `useTablist` for every strip of the shell that can move one. A strip is a scroller whose direct children are the tabs' faces; a tab is the `role="tab"`
// element in a face, and the faces with `data-pinned` are the pinned tabs, at the start. A press on a tab that travels 6 px is a drag, and a drag costs next to nothing (docs/ui-next/optimisations.md MNR-K3, LIB-32): the DOM keeps its
// order (S59) and the order is committed once, on the release, through `onMove`, the callback the keyboard asks. A pointer move writes nothing: ONE animation-frame callback places the marker and the ghost, each with ONE `style.translate`,
// and scrolls the strip while the pointer is at its edge. The window, never <html>, carries `data-tab-dragging`, and the face dragged `data-dragging`. The marker and the ghost (a copy of the face, `data-shell-part="tabGhost"`, which
// the strip's stylesheet draws on the popup's plane, S57) are one popover, so the top layer holds them without a z-index. Escape (before anything below it), the window's blur and a cancelled pointer put everything back as it was.

const THRESHOLD = 6;
const OFFSET = 12;
// S58: the row's room under a face, how far below the row the pointer has left the strip, and how far it must come back.
const ROW = 6;
const LEAVE = 18;
const RETURN = 9;
// How near an edge of the strip the pointer scrolls it, and the most it scrolls in a frame.
const EDGE = 32;
const STEP = 20;

/** Where a drop lands: the place the tab takes (what `onMove` is asked for) and where the marker stands on the screen. */
type DropSlot = TabPlace & { readonly x: number };

/**
 * Where a drop at `pointer` lands among `faces`, left to right on the screen: the gap before the first face whose middle the pointer has not passed (S56). `from` is the index of the tab dragged, and the first `zone`
 * faces are pinned. A strip that reads right to left is read as its mirror. The marker stands 2 px out from the face before the gap (the one after it, at the start); beside the separator of the pinned tabs the gap
 * is two, one on each side of it (S23), and the side the pointer is on chooses.
 */
export function dropSlot(pointer: number, faces: ReadonlyArray<{ readonly left: number; readonly right: number }>, from: number, zone: number, rtl: boolean): DropSlot {
  const sign = rtl ? -1 : 1;
  const spans = faces.map(({ left, right }) => (rtl ? { start: -right, end: -left } : { start: left, end: right }));
  const at = sign * pointer;
  const found = spans.findIndex(({ start, end }) => (start + end) / 2 >= at);
  const gap = found < 0 ? spans.length : found;
  const before = spans[gap - 1];
  const after = spans[gap];
  const pinned = gap === zone && before !== undefined && after !== undefined ? at < (before.end + after.start) / 2 : undefined;
  const edge = after !== undefined && (before === undefined || pinned === false) ? after.start - 2 : (before?.end ?? 0) + 2;
  return { to: gap > from ? gap - 1 : gap, x: sign * edge, pinned };
}

/** How far the strip scrolls in a frame for a pointer at `x`: nothing until it is 32 px from an edge of the strip, then more and more, to 20 px at the edge and beyond it. */
function edgeSpeed(x: number, box: DOMRect): number {
  const toward = (depth: number) => Math.min(STEP, Math.ceil((depth / EDGE) * STEP));
  const start = box.left + EDGE - x;
  const end = x - (box.right - EDGE);
  return start > 0 ? -toward(start) : end > 0 ? toward(end) : 0;
}

/** A pointer is down on a tab; `stop` takes off the window the listeners the press added. */
type Press = {
  readonly id: string;
  readonly face: Element;
  readonly home: HTMLElement;
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  readonly stop: AbortController;
  x: number;
  y: number;
};

/** The pointer has travelled: what is drawn, and where a release would drop. `away` is the way out the strip was asked for when the pointer went out of it, for as long as it is out. */
type Drag = { readonly layer: HTMLElement; readonly marker: HTMLElement; readonly ghost: HTMLElement; readonly zone: HTMLElement | undefined; readonly rtl: boolean; out: boolean; away: DragOut | undefined; slot: DropSlot | undefined; frame: number };

/** The layer of a drag: one popover in the window, which the top layer holds over the window without a z-index, with the marker of the place a drop lands and the `parts` that go with it. */
type Stage = { readonly layer: HTMLElement; readonly marker: HTMLElement };

function stage(home: HTMLElement, ...parts: HTMLElement[]): Stage {
  const layer = document.createElement('div');
  const marker = document.createElement('div');
  layer.className = styles.layer;
  marker.className = styles.marker;
  layer.dataset.shellPart = 'tabDrag';
  layer.setAttribute('popover', 'manual');
  layer.setAttribute('inert', '');
  layer.append(marker, ...parts);
  home.append(layer);
  layer.showPopover();
  return { layer, marker };
}

/** Where a drop at `x` lands among the faces of the strip, and the marker put there (`translate`, in the window's pixels). `face` is the face dragged: a tab from another window has none, and takes a gap among them all. */
function slotAt(scroller: HTMLElement, box: DOMRect, marker: HTMLElement, x: number, face: Element | undefined, rtl: boolean): DropSlot {
  const within = (at: number) => Math.min(Math.max(at, box.left), box.right);
  const faces = [...scroller.children];
  const slot = dropSlot(within(x), faces.map((one) => one.getBoundingClientRect()), face === undefined ? faces.length : faces.indexOf(face), faces.filter((one) => one.hasAttribute('data-pinned')).length, rtl);
  marker.style.translate = `${String(within(slot.x))}px ${String(box.top)}px`;
  return slot;
}

/** The page a tab released outside the strip goes to, outlined where it is and named, and hidden until the pointer is out of the strip (S58). */
function outline(page: HTMLElement): HTMLElement {
  const { left, top, width, height } = page.getBoundingClientRect();
  const zone = document.createElement('div');
  zone.className = styles.zone;
  zone.hidden = true;
  Object.assign(zone.style, { translate: `${String(left)}px ${String(top)}px`, inlineSize: `${String(width)}px`, blockSize: `${String(height)}px` });
  return zone;
}

/**
 * The strip as the place a tab dragged in from another window lands (S58): given the point of this window the tab is over, it marks the gap a drop there would give it, with the marker a drag in the strip has, and says the place it takes. A point that is
 * not in the strip's row (6 px above or below the faces), or none, takes the marker away and says nothing.
 */
export function stripReceiver(scroller: HTMLElement): TabReceiver {
  let staged: Stage | undefined;
  return (at) => {
    const box = scroller.getBoundingClientRect();
    const home = scroller.closest<HTMLElement>('[data-shell-part="window"]');
    if (at === undefined || home === null || at.y < box.top - ROW || at.y > box.bottom + ROW) {
      staged?.layer.remove();
      staged = undefined;
      return undefined;
    }

    staged ??= stage(home);
    return slotAt(scroller, box, staged.marker, at.x, undefined, getComputedStyle(scroller).direction === 'rtl');
  };
}

/**
 * Makes the tabs of the strip draggable, and returns the way to stop. A drop asks `onMove` for the tab, the index it takes and, beside the separator of the pinned tabs, the side it is dropped on. When the pointer first goes out of the strip `onDragOut` is asked
 * for the tab's way out, which is told where the pointer is while it is out and how the drag ends there: a release (a drop), or anything else, including the pointer coming back.
 */
export function bindStripDrag(scroller: HTMLElement, onMove: (id: string, to: number, pinned?: boolean) => void, onDragOut?: (id: string) => DragOut | undefined): () => void {
  let press: Press | undefined;
  let drag: Drag | undefined;

  // The one place a drag ends. With the release of the pointer it drops the tab where the marker is, or through its way out when the pointer is out of the strip; without, the tab stays where it was.
  function end(release?: PointerEvent): void {
    const pressed = press;
    const dragged = drag;
    press = undefined;
    drag = undefined;
    pressed?.stop.abort();
    if (pressed === undefined || dragged === undefined) {
      return;
    }

    cancelAnimationFrame(dragged.frame);
    dragged.layer.remove();
    pressed.face.removeAttribute('data-dragging');
    pressed.home.removeAttribute('data-tab-dragging');
    if (release === undefined) {
      dragged.away?.cancel();
    } else if (dragged.out) {
      dragged.away?.drop(release.clientX, release.clientY);
    } else if (dragged.slot !== undefined) {
      onMove(pressed.id, dragged.slot.to, dragged.slot.pinned);
    }
  }

  function draw(pressed: Press, dragged: Drag): void {
    dragged.frame = 0;
    const box = scroller.getBoundingClientRect();
    const { x, y } = pressed;
    const below = y - (box.bottom + ROW);
    dragged.out = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight || (dragged.out ? below >= RETURN : below > LEAVE);
    dragged.marker.hidden = dragged.out;
    dragged.zone?.toggleAttribute('hidden', !dragged.out);
    dragged.ghost.style.translate = `${String(x + OFFSET)}px ${String(y + OFFSET)}px`;
    if (dragged.out) {
      dragged.away ??= onDragOut?.(pressed.id);
      dragged.away?.move(x, y);
      return;
    }

    dragged.away?.cancel();
    dragged.away = undefined;

    // The strip scrolls before the faces are measured, so that the marker is drawn where they are; it goes on in the next frame for as long as it moves.
    const was = scroller.scrollLeft;
    const push = edgeSpeed(x, box);
    if (push !== 0) {
      scroller.scrollLeft += push;
    }

    dragged.slot = slotAt(scroller, box, dragged.marker, x, pressed.face, dragged.rtl);
    if (scroller.scrollLeft !== was) {
      schedule(pressed, dragged);
    }
  }

  function schedule(pressed: Press, dragged: Drag): void {
    dragged.frame = requestAnimationFrame(() => {
      draw(pressed, dragged);
    });
  }

  // The pointer has travelled far enough. The ghost is a copy of the face, made before the face is marked, without the id its tab holds once. The page is the one the tab controls, where the strip can take a tab out.
  function begin(pressed: Press): Drag {
    const page = onDragOut === undefined ? null : document.getElementById(pressed.face.querySelector('[role="tab"]')?.getAttribute('aria-controls') ?? '');
    const zone = page === null ? undefined : outline(page);
    const ghost = pressed.face.cloneNode(true) as HTMLElement;
    for (const element of ghost.querySelectorAll('[id]')) {
      element.removeAttribute('id');
    }

    ghost.dataset.shellPart = 'tabGhost';
    ghost.style.inlineSize = `${String(pressed.face.getBoundingClientRect().width)}px`;
    const { layer, marker } = stage(pressed.home, ghost);
    if (zone !== undefined) {
      layer.prepend(zone);
    }

    pressed.home.setAttribute('data-tab-dragging', '');
    pressed.face.setAttribute('data-dragging', '');
    try {
      scroller.setPointerCapture(pressed.pointerId);
    } catch {
      // There is no such pointer to capture where the events are made up: the drag still follows the events it gets.
    }

    return { layer, marker, ghost, zone, rtl: getComputedStyle(scroller).direction === 'rtl', out: false, away: undefined, slot: undefined, frame: 0 };
  }

  const onPointer = (event: PointerEvent): void => {
    const pressed = press;
    if (pressed?.pointerId !== event.pointerId) {
      return;
    }

    if (event.type === 'pointerup') {
      end(event);
    } else if (event.type === 'pointercancel') {
      end();
    } else {
      pressed.x = event.clientX;
      pressed.y = event.clientY;
      if (drag === undefined && Math.hypot(pressed.x - pressed.x0, pressed.y - pressed.y0) >= THRESHOLD) {
        drag = begin(pressed);
      }

      if (drag?.frame === 0) {
        schedule(pressed, drag);
      }
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end();
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    const id = tab?.dataset.tabId;
    const face = tab === null ? undefined : [...scroller.children].find((child) => child.contains(tab));
    const home = scroller.closest<HTMLElement>('[data-shell-part="window"]');
    // The primary button of a mouse or a pen, on a tab and not on its close control. A touch scrolls the strip, and Control with a press is a Mac's secondary button, which opens the tab's menu.
    if (id === undefined || face === undefined || home === null || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch' || (event.ctrlKey && platformOf(navigator) === 'mac')) {
      return;
    }

    end();
    const stop = new AbortController();
    press = { id, face, home, pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, stop };
    const { signal } = stop;
    window.addEventListener('pointermove', onPointer, { signal });
    window.addEventListener('pointerup', onPointer, { signal });
    window.addEventListener('pointercancel', onPointer, { signal });
    window.addEventListener('blur', () => {
      end();
    }, { signal });
    window.addEventListener('keydown', onKey, { signal, capture: true });
  };

  scroller.addEventListener('pointerdown', onPointerDown);
  return () => {
    end();
    scroller.removeEventListener('pointerdown', onPointerDown);
  };
}
