import { useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent, type PointerEvent, type RefObject } from 'react';
import { restoreFocus } from '../palette/focus';
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
};

/**
 * The handlers of the layer (`layer` is its element), and what it does after every draw (`toasts` is how many it drew): the holds are asked whether their cause still stands, and a focus that was in a toast that is
 * gone goes back to where it was (`restoreFocus`: only a focus that is lost, on the body, is given back; one that is somewhere, the user put there). Leaving the window lets go of every hold.
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
    const lost = trail.current;
    if (lost !== null && !lost.element.isConnected) {
      trail.current = null;
      restoreFocus({ element: lost.origin });
    }
  });

  return {
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
