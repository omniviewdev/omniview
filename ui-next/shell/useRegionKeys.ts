import { useEffect, type RefObject } from 'react';
import { cycle, escapeTarget } from './core/regions';

// The keyboard between the shell's regions (ch16 S12): F6 and Shift+F6 cycle them in reading order, Escape from any region but the page
// returns the focus to the page. Reading order is the DOM order, and the DOM says what is a region and where its focus goes:
//   data-shell-region="<id>"  a region that F6 visits
//   data-shell-focus          the element inside it (or itself) that takes the focus, set by whoever owns that element
// A region with no such element, or one that is hidden or inert, is not visited.

const PAGE = 'island';

type Stop = { readonly id: string; readonly target: HTMLElement };

function stopsOf(root: HTMLElement): Stop[] {
  const stops: Stop[] = [];
  for (const region of root.querySelectorAll<HTMLElement>('[data-shell-region]')) {
    const id = region.dataset.shellRegion;
    const target = region.matches('[data-shell-focus]') ? region : region.querySelector<HTMLElement>('[data-shell-focus]');
    if (id !== undefined && target !== null && region.closest('[inert], [hidden]') === null) {
      stops.push({ id, target });
    }
  }

  return stops;
}

/** The region the focus sits in, or undefined when it sits outside the shell. */
function regionOf(root: HTMLElement, node: EventTarget | null): string | undefined {
  if (!(node instanceof Element)) {
    return undefined;
  }

  const region = node.closest<HTMLElement>('[data-shell-region]');
  return region !== null && root.contains(region) ? region.dataset.shellRegion : undefined;
}

function move(event: KeyboardEvent, target: HTMLElement | undefined): void {
  if (target !== undefined) {
    event.preventDefault();
    target.focus();
  }
}

function onKeyDown(root: HTMLElement, event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  if (event.key === 'F6') {
    const stops = stopsOf(root);
    const next = cycle(stops.map((stop) => stop.id), regionOf(root, event.target), event.shiftKey ? -1 : 1);
    move(event, stops.find((stop) => stop.id === next)?.target);
  } else if (event.key === 'Escape' && !event.shiftKey) {
    const target = escapeTarget(regionOf(root, event.target), PAGE);
    move(event, stopsOf(root).find((stop) => stop.id === target)?.target);
  }
}

/**
 * One keydown listener on the document for as long as the shell is mounted: F6 works from anywhere in the window, including from
 * nothing focused (it then enters the first region), and a key something else already took is left alone.
 */
export function useRegionKeys(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) {
      return undefined;
    }

    const listener = (event: KeyboardEvent) => {
      onKeyDown(element, event);
    };

    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, [root]);
}
