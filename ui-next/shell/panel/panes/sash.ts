import { fitRatios, minRatio, moveBoundary, type PaneAxis, type PanelStore, type ToolId } from '../../core/panel';

// The sash between two panes of a tool's group: its geometry, its drag and its keys. The model owns the shares (`moveSash`); this owns pixels. What a drag costs is the panel splitter's rule (./../splitter.ts, HLT-34): a pointer
// move writes no state and renders nothing, one animation frame writes ONE style on each of the two panes beside the sash (`flex-grow`), the model is committed once, on release, and the inline value is given back to the stylesheet once
// React has drawn the committed shares. Escape and a cancelled pointer put the shares back as they were. The minimum is the layout's 80 px, enforced here in pixels (`minRatio`) as the model enforces it in shares.

/** Pixels each key moves a sash by, and with Shift. */
export const SASH_STEP = 16;
export const SASH_STEP_SHIFT = 64;

/** What the controller reads of the DOM, once per gesture. */
export type Geometry = {
  /** Where the panes begin along the axis, in pixels from the viewport's origin. */
  readonly start: number;
  /** The length the panes share: the deck's, less its sashes. */
  readonly extent: number;
  /** The thickness of one sash. */
  readonly sash: number;
};

/**
 * The position of a boundary's centre as a share of the extent, from a pointer: the panes before the boundary and the sashes before and half this one lie between the start and the pointer, and only the panes count in the extent.
 * `boundary` is the index of the pane before the sash.
 */
export function positionOf(pointer: number, geometry: Geometry, boundary: number): number {
  return (pointer - geometry.start - boundary * geometry.sash - geometry.sash / 2) / geometry.extent;
}

/** The shares as a sash drag or key would leave them: within the minimum for the extent, the two panes beside the sash given what they had together. */
export function sharesAfter(ratios: readonly number[], boundary: number, position: number, extent: number): readonly number[] {
  const min = minRatio(extent, ratios.length);
  return moveBoundary(fitRatios(ratios, min), boundary, position, min);
}

/** The share of the whole at a boundary's centre: the shares before it, plus the share of the pane before it. */
export const boundaryOf = (ratios: readonly number[], boundary: number): number => ratios.slice(0, boundary + 1).reduce((total, one) => total + one, 0);

export type SashKey = { readonly key: string; readonly shiftKey: boolean; readonly altKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly isComposing?: boolean | undefined; readonly preventDefault: () => void };

export type SashPointer = { readonly button: number; readonly isPrimary: boolean; readonly pointerId: number; readonly clientX: number; readonly clientY: number; readonly currentTarget: { setPointerCapture?: ((id: number) => void) | undefined } };

export type SashOptions = {
  readonly store: PanelStore;
  readonly tool: ToolId;
  /** The pane before the sash. */
  readonly boundary: number;
  readonly axis: PaneAxis;
  /** The deck's measure now: read when a gesture starts and when a key is pressed, never per frame. */
  readonly geometry: () => Geometry | null;
  /** The two bodies beside the sash, in order: the only elements a drag writes to. */
  readonly panes: () => readonly [HTMLElement | null, HTMLElement | null];
  /** The window's element a drag marks, so that the cursor and the line show wherever the pointer is. Never `<html>`. */
  readonly marked: () => HTMLElement | null;
};

export type Sash = {
  readonly pointerDown: (event: SashPointer) => void;
  readonly pointerMove: (event: Pick<SashPointer, 'pointerId' | 'clientX' | 'clientY'>) => void;
  readonly pointerUp: (event: Pick<SashPointer, 'pointerId' | 'clientX' | 'clientY'>) => void;
  readonly cancel: () => void;
  readonly key: (event: SashKey) => void;
  /** A double click: every pane the same share again. */
  readonly reset: () => void;
  readonly dragging: () => boolean;
  /** Gives the shares back to the stylesheet: removes what a drag wrote, unless one is running. */
  readonly release: () => void;
  readonly dispose: () => void;
};

type Drag = {
  readonly pointerId: number;
  readonly geometry: Geometry;
  readonly ratios: readonly number[];
  raw: number;
  applied: readonly number[] | undefined;
  dirty: boolean;
  frame: number;
};

const groupOf = (store: PanelStore, tool: ToolId) => (Object.hasOwn(store.getSnapshot().panes, tool) ? store.getSnapshot().panes[tool] : undefined);

export function createSash({ store, tool, boundary, axis, geometry, panes, marked }: SashOptions): Sash {
  let drag: Drag | null = null;
  const coordinate = (event: { readonly clientX: number; readonly clientY: number }): number => (axis === 'row' ? event.clientX : event.clientY);

  const write = (session: Drag): void => {
    session.frame = 0;
    if (!session.dirty) {
      return;
    }

    session.dirty = false;
    const shares = sharesAfter(session.ratios, boundary, positionOf(session.raw, session.geometry, boundary), session.geometry.extent);
    if (session.applied?.[boundary] === shares[boundary]) {
      return;
    }

    session.applied = shares;
    const [before, after] = panes();
    if (before !== null && before !== undefined) {
      before.style.flexGrow = String(shares[boundary]);
    }

    if (after !== null && after !== undefined) {
      after.style.flexGrow = String(shares[boundary + 1]);
    }
  };

  const clear = (): void => {
    for (const element of panes()) {
      if (element !== null) {
        element.style.flexGrow = '';
      }
    }
  };

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && drag !== null) {
      event.preventDefault();
      event.stopPropagation();
      end(false, undefined);
    }
  };

  function end(commit: boolean, raw: number | undefined): void {
    const session = drag;
    if (session === null) {
      return;
    }

    drag = null;
    cancelAnimationFrame(session.frame);
    window.removeEventListener('keydown', onEscape, true);
    marked()?.removeAttribute('data-resizing');
    const final = raw ?? session.raw;
    // The window may have changed while the pointer was down: the shares committed are read against the deck as it is when the pointer is released (its start and its length), as the panel splitter reads the window's height again then.
    const now = geometry() ?? session.geometry;
    const answer = commit ? store.moveSash(tool, boundary, positionOf(final, now, boundary), now.extent) : undefined;
    // A commit that changed the shares is drawn by React in a moment, and the deck hands the inline value back then; any other end gives it back here.
    if (answer?.status !== 'done') {
      clear();
    }
  }

  return {
    pointerDown: (event) => {
      const measured = geometry();
      const group = groupOf(store, tool);
      if (drag !== null || event.button !== 0 || !event.isPrimary || measured === null || group === undefined || boundary + 1 >= group.panes.length) {
        return;
      }

      drag = { pointerId: event.pointerId, geometry: measured, ratios: group.ratios, raw: coordinate(event), applied: undefined, dirty: false, frame: 0 };
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A synthetic pointer cannot be captured: the drag still follows the events it gets.
      }

      marked()?.setAttribute('data-resizing', axis === 'row' ? 'x' : 'y');
      window.addEventListener('keydown', onEscape, true);
    },
    pointerMove: (event) => {
      const session = drag;
      if (session?.pointerId !== event.pointerId) {
        return;
      }

      session.raw = coordinate(event);
      session.dirty = true;
      if (session.frame === 0) {
        session.frame = requestAnimationFrame(() => {
          write(session);
        });
      }
    },
    pointerUp: (event) => {
      const session = drag;
      if (session !== null && event.pointerId === session.pointerId) {
        end(true, coordinate(event));
      }
    },
    cancel: () => {
      end(false, undefined);
    },
    key: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing === true || drag !== null) {
        return;
      }

      const group = groupOf(store, tool);
      const measured = geometry();
      if (group === undefined || measured === null || boundary + 1 >= group.panes.length) {
        return;
      }

      const forward = axis === 'row' ? 'ArrowRight' : 'ArrowDown';
      const back = axis === 'row' ? 'ArrowLeft' : 'ArrowUp';
      const here = boundaryOf(group.ratios, boundary);
      const step = (event.shiftKey ? SASH_STEP_SHIFT : SASH_STEP) / measured.extent;
      let position: number | undefined;
      if (event.key === forward) {
        position = here + step;
      } else if (event.key === back) {
        position = here - step;
      } else if (event.key === 'Home') {
        position = 0;
      } else if (event.key === 'End') {
        position = 1;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        store.equalisePanes(tool, measured.extent);
        return;
      }

      if (position === undefined) {
        return;
      }

      event.preventDefault();
      store.moveSash(tool, boundary, position, measured.extent);
    },
    reset: () => {
      const measured = geometry();
      if (measured !== null) {
        store.equalisePanes(tool, measured.extent);
      }
    },
    dragging: () => drag !== null,
    release: () => {
      if (drag === null) {
        clear();
      }
    },
    dispose: () => {
      end(false, undefined);
    },
  };
}
