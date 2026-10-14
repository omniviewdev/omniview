/**
 * Library-agnostic DOM helpers. Benches find things the way a user would
 * (text, roles, scrollable areas), not by component-library class names, so
 * they keep working while screens move from MUI to base-ui.
 */
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

export interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

/** Mount synchronously into a fresh full-viewport container. */
export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden;';
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  return {
    container,
    root,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

export function el<P extends object>(type: React.ComponentType<P> | string, props?: P | null, ...children: React.ReactNode[]) {
  return createElement(type as any, props as any, ...children);
}

/**
 * Resolve once `predicate` returns a truthy value. Re-checks after every DOM
 * mutation (microtask timing, no frame quantization) and on each frame as a
 * fallback for changes that are not mutations (e.g. layout).
 */
export function waitFor<T>(predicate: () => T | null | undefined | false, { timeout = 30_000, label = 'condition' } = {}): Promise<T> {
  const first = predicate();
  if (first) return Promise.resolve(first);
  return new Promise<T>((resolve, reject) => {
    let raf = 0;
    const done = (value: T) => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      const value = predicate();
      if (value) done(value);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    const tick = () => { check(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const timer = setTimeout(() => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      reject(new Error(`waitFor timed out: ${label}`));
    }, timeout);
  });
}

/** Innermost element whose own text content equals `text`. */
export function findByText(root: ParentNode, text: string | RegExp): HTMLElement | null {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue?.trim() ?? '';
    if (typeof text === 'string' ? value === text : text.test(value)) return n.parentElement;
  }
  return null;
}

export function hasText(root: ParentNode, text: string | RegExp): boolean {
  return findByText(root, text) !== null;
}

/** The scrollable element with the most overflow under `root` (the main list/table body). */
export function findScrollable(root: ParentNode, axis: 'y' | 'x' = 'y'): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestOverflow = 0;
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    const overflow = axis === 'y' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
    if (overflow <= bestOverflow) continue;
    const style = getComputedStyle(node);
    const o = axis === 'y' ? style.overflowY : style.overflowX;
    if (o === 'auto' || o === 'scroll') {
      best = node;
      bestOverflow = overflow;
    }
  }
  return best;
}

/**
 * One synchronous scroll step: move, deliver the scroll event, and force
 * style + layout so the measured time covers JS, React commit and layout.
 */
export function scrollStep(el: HTMLElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
  void el.getBoundingClientRect();
  void document.body.offsetHeight;
}

/** Force style recalculation + layout of the whole document. */
export function forceLayout(): void {
  void document.body.offsetHeight;
}

export const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

export function click(target: Element): void {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  target.dispatchEvent(new MouseEvent('mousedown', opts));
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  target.dispatchEvent(new MouseEvent('mouseup', opts));
  target.dispatchEvent(new MouseEvent('click', opts));
}

export function gc(): void {
  (globalThis as any).gc?.();
}
