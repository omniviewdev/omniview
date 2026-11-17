import { useLayoutEffect, useState, type RefObject } from 'react';

/** The height of an element in whole pixels: what a row is, read from the probe. */
export const heightOf = (element: Element): number => Math.round(element.getBoundingClientRect().height);

/** The width of an element's content box, scrollbar excluded: what the columns have to share. */
export const widthOf = (element: Element): number => element.clientWidth;

/**
 * A measure of one element that follows it: read once before the first paint and again whenever the element's size changes, through one
 * ResizeObserver. `fallback` stands until the element has a size (it has none before layout, nor in a test without one). A reading of 0
 * is not a measure and keeps the last one.
 */
export function useMeasure(ref: RefObject<Element | null>, read: (element: Element) => number, fallback: number): number {
  const [value, setValue] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }

    const update = () => {
      const next = read(element);
      if (next > 0) {
        setValue(next);
      }
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, read]);
  return value;
}
