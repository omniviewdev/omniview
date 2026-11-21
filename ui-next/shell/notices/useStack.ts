import { useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent, type PointerEvent, type RefObject } from 'react';
import { focusPage } from '../panel/focus';
import { createHolds, type HoldStore } from './holds';

// What the DOM tells the toast layer, and what the layer does about it: the pointer and the focus in the stack hold the model's clocks (./holds.ts), and a focus that was in the stack when the toast that had it went
// is given back to where it came from (ch16 S12, S13: closing a layer restores the focus to its opener, or to the nearest logical target, and a toast never traps the user). A toast never takes the focus on its own: nothing
// here moves the focus into the stack, F6 and Tab do (the shell's region keys, `useRegionKeys`).

/** The toast a node is in. */
const TOAST = '[data-notices-part="toast"]';

const inToast = (node: EventTarget | null): boolean => node instanceof Element && node.closest(TOAST) !== null;

/** Where the focus is in the stack: the control that has it, and the one it came from when it entered. Kept only while it is there. */
type Trail = { readonly element: Element; readonly origin: HTMLElement | null };

/** An element the focus can be given back to: still in the document, and not the body, which is where the focus is when nothing has it. */
const usable = (node: EventTarget | null): node is HTMLElement => node instanceof HTMLElement && node.isConnected && node !== document.body && node !== document.documentElement;

export type StackEvents = {
  readonly onPointerOver: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerOut: (event: PointerEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
  /** The stack is about to be hidden and made inert while the focus is in it: gives the focus back now (to where it was, else the nearest control, else the page), never leaving it to the browser, which drops it to the body. */
  readonly giveBack: () => void;
};

/** What the mock's `rescueFocus` takes for a control to land on (shell-notify.js:961). */
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/**
 * The mock's fallback for a focus that has nowhere to go back to (`rescueFocus`, shell-notify.js:963, after "a dismissed toast that held focus: focus goes to the nearest toast, else back to where it was before it entered the
 * stack, else to the nearest control (ch 04 §5)"): the nearest control that comes before `from` in the document, else the first that comes after it. The stack's own controls, hidden and inert ones, and ones with no box are not candidates.
 */
function nearestControl(from: Element): HTMLElement | null {
  let before: HTMLElement | null = null;
  let after: HTMLElement | null = null;
  for (const candidate of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (from.contains(candidate) || candidate.closest('[inert],[hidden]') !== null || candidate.getClientRects().length === 0) {
      continue;
    }

    if ((from.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
      before = candidate;
    } else {
      after = candidate;
      break;
    }
  }

  return before ?? after;
}

/** Gives the focus to where it was before it entered the stack; when that is gone, to the mock's fallback, the nearest control; when there is none, to the page. Never to the body (ch16 S12: a layer that closes never drops the focus). */
function giveBackTo(origin: HTMLElement | null, from: Element): void {
  if (origin?.isConnected === true) {
    origin.focus({ preventScroll: true });
    if (document.activeElement === origin) {
      return;
    }
  }

  const near = nearestControl(from);
  if (near !== null) {
    near.focus({ preventScroll: true });
    if (document.activeElement === near) {
      return;
    }
  }

  focusPage();
}

/** The focus is on nothing: the body, where the browser leaves it when the element that had it is removed. */
const adrift = (): boolean => document.activeElement === null || document.activeElement === document.body || document.activeElement === document.documentElement;

/**
 * The handlers of the layer (`layer` is its element), and what it does after every draw (`toasts` is how many it drew): the holds are asked whether their cause still stands, and a focus that was in a toast that is
 * gone goes back to where it was (`giveBackTo`: only a focus that is adrift, on the body, is given back; one that is somewhere, the user put there). `giveBack` does the same for a stack that is hidden with the focus in it.
 * Leaving the window lets go of every hold.
 */
export function useStack(layer: RefObject<HTMLElement | null>, store: HoldStore, toasts: number): StackEvents {
  const holds = useMemo(() => createHolds(store), [store]);
  const trail = useRef<Trail | null>(null);

  useEffect(
    () => () => {
      holds.dispose();
    },
    [holds],
  );

  useLayoutEffect(() => {
    const element = layer.current;
    holds.settle({ toasts, focus: element?.contains(document.activeElement) === true }, () => element?.matches(':hover') === true);
    const gone = trail.current;
    if (gone !== null && !gone.element.isConnected) {
      trail.current = null;
      if (element !== null && adrift()) {
        giveBackTo(gone.origin, element);
      }
    }
  });

  return {
    giveBack: () => {
      const element = layer.current;
      if (element?.contains(document.activeElement) === true) {
        const origin = trail.current?.origin ?? null;
        trail.current = null;
        giveBackTo(origin, element);
      }
    },
    onPointerOver: (event) => {
      if (inToast(event.target)) {
        holds.pointerOver();
      }
    },
    onPointerOut: (event) => {
      if (inToast(event.target)) {
        const element = event.currentTarget;
        holds.pointerOut(() => element.matches(':hover'));
      }
    },
    onFocus: (event) => {
      holds.focusIn();
      const from = event.relatedTarget;
      const entering = !(from instanceof Node && event.currentTarget.contains(from));
      trail.current = { element: event.target, origin: entering ? (usable(from) ? from : null) : (trail.current?.origin ?? null) };
    },
    onBlur: (event) => {
      const to = event.relatedTarget;
      if (to instanceof Node && event.currentTarget.contains(to)) {
        return;
      }

      holds.focusOut();
      // A focus that left for somewhere that is not a toast is the user's now. One that left because its element was removed has no element to come back to, and is given back after the draw: the removal comes
      // first, and a control that is still there after this microtask was left on purpose.
      const element = event.target;
      queueMicrotask(() => {
        if (element.isConnected && trail.current?.element === element) {
          trail.current = null;
        }
      });
    },
  };
}
