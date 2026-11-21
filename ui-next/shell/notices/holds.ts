import type { HoldReason } from '../core/notices';

// What the pointer and the focus tell the model about the stack (ch16 S78; the mock's `setPaused`, `pointerover`, `pointerout`, `focusin` and `focusout`, shell-notify.js): while either is in the stack the clocks of
// its toasts wait, as one, and when both are gone they run again with at least two seconds to be read (the model's rule). This is the view's half: it turns events into the model's `hold` input and keeps it true.
// Framework-free, so the rules are tests with a fake clock and no DOM.

/** How long a pointer that left a toast, or whose toast was drawn again, is held on to before the stack is asked whether a toast is under it: the 8 px between two toasts is not a place to leave to (the mock's 120 ms). */
export const LEAVE_MS = 120;

export type HoldStore = { readonly hold: (reason: HoldReason, on: boolean) => boolean };

/** What is true of the stack after a draw: how many toasts it has, and whether one of them has the focus. */
export type Settled = { readonly toasts: number; readonly focus: boolean };

/** Whether a toast is under the pointer now (`:hover` on the stack). It is asked a moment after the pointer left, or after a draw, and what it answers then is what counts. */
export type Over = () => boolean;

export type Holds = {
  /** The pointer is over a toast. */
  readonly pointerOver: () => void;
  /** The pointer left a toast for something that is not one. */
  readonly pointerOut: (over: Over) => void;
  readonly focusIn: () => void;
  readonly focusOut: () => void;
  /**
   * After a draw. A browser tells nobody that the toast under the pointer, or with the focus, was removed (no `pointerout`, and `focusout` in some engines only), so a hold is asked again whether its cause stands: the
   * focus at once (the document knows where it is), the pointer after a moment (the engine updates what is under it a frame or two after a draw). A stack with no toast has nothing to hold, and no timer.
   */
  readonly settle: (state: Settled, over: Over) => void;
  /** The window goes: let go of what is held, and drop the timer. */
  readonly dispose: () => void;
};

export function createHolds(store: HoldStore): Holds {
  let pointer = false;
  let focus = false;
  let asking: ReturnType<typeof setTimeout> | undefined;

  const stopAsking = (): void => {
    if (asking !== undefined) {
      clearTimeout(asking);
      asking = undefined;
    }
  };

  const releasePointer = (): void => {
    stopAsking();
    if (pointer) {
      pointer = false;
      store.hold('pointer', false);
    }
  };

  const releaseFocus = (): void => {
    if (focus) {
      focus = false;
      store.hold('focus', false);
    }
  };

  const askLater = (over: Over): void => {
    stopAsking();
    asking = setTimeout(() => {
      asking = undefined;
      if (!over()) {
        releasePointer();
      }
    }, LEAVE_MS);
  };

  return {
    pointerOver: () => {
      stopAsking();
      if (!pointer) {
        pointer = true;
        store.hold('pointer', true);
      }
    },
    pointerOut: (over) => {
      if (pointer) {
        askLater(over);
      }
    },
    focusIn: () => {
      if (!focus) {
        focus = true;
        store.hold('focus', true);
      }
    },
    focusOut: releaseFocus,
    settle: (state, over) => {
      if (state.toasts === 0) {
        releasePointer();
      } else if (pointer) {
        askLater(over);
      }

      if (state.toasts === 0 || !state.focus) {
        releaseFocus();
      }
    },
    dispose: () => {
      releasePointer();
      releaseFocus();
    },
  };
}
