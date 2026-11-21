import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ToastItem } from '../core/notices';
import { decide, HOME, samePlace, type Control, type Place } from './placement';
import { toastLabel } from './words';

// What the page tells the stack, and what the stack does about it (ch16 S79, P7; the mock's `place()` and its observers in shell-notify.js, the rule is in ./placement.ts): the stack is measured against the controls
// of the page after every change to it, and, once things have settled for 120 ms, after a resize, a scroll and any change of the page under it that moves a control (an element added or removed, `hidden`, `inert`,
// `open`, `aria-expanded`, a class or a style changed). It watches only while there is a toast: with none it holds no observer, no listener and no timer.

/** How long the page is still before the stack is decided again. */
export const SETTLE_MS = 120;

/** What a person can act on (the mock's `ACTIONABLE`): native controls and the interactive roles. A focusable table row or scroll area (a tabindex alone) is not one: the link or the button inside it is. */
const ACTIONABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="treeitem"], [role="option"]';

/** The smallest box that is a control, in px: anything under it is a mark, not something to point at. */
const LEAST = 6;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/**
 * Every visible control of the page but the stack's own: its box, and, asked lazily and at most once, whether the point at its centre really reaches it (one clipped by a scroll area, or covered, does not). A control
 * that is `aria-disabled` is one: it stays focusable and says why it is off. A natively `disabled` one is not: it can be neither focused nor pointed at for a reason. Nothing in an `inert` or `hidden` subtree is.
 */
function controlsOf(layer: Element): Control[] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const controls: Control[] = [];
  for (const element of document.querySelectorAll(ACTIONABLE)) {
    if (layer.contains(element) || ('disabled' in element && element.disabled === true)) {
      continue;
    }

    const box = element.getBoundingClientRect();
    if (box.width < LEAST || box.height < LEAST || box.bottom <= 0 || box.right <= 0 || box.top >= height || box.left >= width || element.closest('[inert],[hidden]') !== null) {
      continue;
    }

    let reached: boolean | undefined;
    controls.push({
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      reached: () => {
        reached ??= document.elementsFromPoint(clamp(Math.round((box.left + box.right) / 2), 0, width - 1), clamp(Math.round((box.top + box.bottom) / 2), 0, height - 1)).includes(element);
        return reached;
      },
    });
  }

  return controls;
}

/** Where the stack stands now: undefined while the page has no layout to measure (the stack has no box yet). */
function measure(layer: HTMLElement, host: HTMLElement, count: number, current: Place): Place | undefined {
  const home = layer.getBoundingClientRect();
  const width = Math.round(home.width);
  const height = Math.ceil(host.getBoundingClientRect().height);
  if (width === 0 || height === 0) {
    return undefined;
  }

  return decide({ controls: controlsOf(layer), viewport: window.innerWidth, home: { right: Math.round(home.right), bottom: Math.round(home.bottom), width }, count, height, current });
}

/** Decides again once the page has been still for `SETTLE_MS`; answers what undoes all of it. Only the page outside the layer counts: the stack changing itself is not news. */
function watch(layer: HTMLElement, host: HTMLElement, again: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const soon = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      frame = requestAnimationFrame(again);
    }, SETTLE_MS);
  };

  const sizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(soon);
  sizes?.observe(host);
  const changes = new MutationObserver((records) => {
    if (!records.every((record) => layer.contains(record.target))) {
      soon();
    }
  });
  changes.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'inert', 'open', 'aria-expanded'] });
  window.addEventListener('resize', soon);
  document.addEventListener('scroll', soon, { capture: true, passive: true });
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    sizes?.disconnect();
    changes.disconnect();
    window.removeEventListener('resize', soon);
    document.removeEventListener('scroll', soon, { capture: true });
  };
}

/** What a screen reader is told of toasts that have no room: the one, in the words of its toast, or how many. */
export function yieldText(items: readonly ToastItem[]): string {
  const [only] = items;
  if (items.length === 1 && only?.record !== undefined) {
    const { severity, title, text } = only.record;
    return `${toastLabel(severity, title)}${text === '' ? '' : `. ${text}`}`;
  }

  const count = items.reduce((total, item) => total + (item.summary?.count ?? 1), 0);
  return `${String(count)} new notifications.`;
}

/**
 * Where the stack stands. `layer` is home (it does not move: it is the box the stack comes home to and the window's live region), `host` is the stack, which is the one that moves, and `items` is what the model
 * composed. The stack is decided again whenever `items` is a new list, before it is painted, so that a toast is never seen over a control for a frame; and then while the page changes under it. A stack that has no
 * room at all is hidden and inert, and the toasts that nobody can see are told once, politely, or assertively when one of them is an error the user caused: no toast, no live region, so nothing else would tell them.
 * While it yields (the lead's ruling of 2026-11-21, "never lose a message unseen"): the model's clocks are HELD (`hold`), as on hover and focus, so that a timed toast cannot expire where nobody can read it (there is no
 * centre yet; the mock's clocks keep running); and a focus that is inside the stack is given back (`giveBack`) before the browser drops it to the body, because the stack is inert.
 */
export function usePlacement(
  layer: RefObject<HTMLElement | null>,
  host: RefObject<HTMLElement | null>,
  items: readonly ToastItem[],
  tell: (text: string, options: { readonly urgent: boolean }) => void,
  holds: { readonly hold: (reason: 'yield', on: boolean) => boolean },
  giveBack: () => void,
): Place {
  const [place, setPlace] = useState<Place>(HOME);
  const stands = useRef<Place>(HOME);
  const told = useRef(new Set<string>());
  const count = items.length;

  useLayoutEffect(() => {
    const home = layer.current;
    const stack = host.current;
    const stand = (next: Place): void => {
      if (!samePlace(next, stands.current)) {
        stands.current = next;
        setPlace(next);
      }
    };

    const decide = (): void => {
      if (count === 0) {
        stand(HOME);
      } else if (home !== null && stack !== null) {
        const next = measure(home, stack, count, stands.current);
        if (next !== undefined) {
          stand(next);
        }
      }
    };

    decide();
    return count === 0 || home === null || stack === null ? undefined : watch(home, stack, decide);
  }, [layer, host, items, count]);

  useEffect(() => {
    if (place.mode !== 'yield') {
      told.current.clear();
      return;
    }

    const fresh = items.filter((item) => !told.current.has(item.key));
    if (fresh.length > 0) {
      for (const item of fresh) {
        told.current.add(item.key);
      }

      tell(yieldText(fresh), { urgent: fresh.some((item) => item.urgent) });
    }
  }, [place.mode, items, tell]);

  useEffect(() => {
    if (place.mode !== 'yield') {
      return undefined;
    }

    holds.hold('yield', true);
    return () => {
      holds.hold('yield', false);
    };
  }, [place.mode, holds]);

  // Before the browser's own fixing of a focus that is in an element that has just become inert (it drops it to the body), the commit that made the stack inert has just been made and nothing has been painted.
  useLayoutEffect(() => {
    if (place.mode === 'yield') {
      giveBack();
    }
  }, [place.mode, giveBack]);

  return place;
}
