// How the keyboard moves between the shell's regions (docs/ui-next/slices, ch16 S12), as functions over region names.
// Reading order is the DOM order, so the caller lists the regions that have something to focus in the order they appear and this decides
// where a key goes; the DOM adapter (../useRegionKeys.ts) reads the list from the page and moves the focus.

/**
 * The region F6 (step 1) or Shift+F6 (step -1) moves to: the next or previous one in `stops`, wrapping at either end. From focus that sits
 * in none of them it enters the first going forward and the last going back. A region with nothing to focus is not in `stops`: it is skipped.
 */
export function cycle(stops: readonly string[], current: string | undefined, step: 1 | -1): string | undefined {
  if (stops.length === 0) {
    return undefined;
  }

  const at = current === undefined ? -1 : stops.indexOf(current);
  if (at === -1) {
    return step === 1 ? stops[0] : stops.at(-1);
  }

  return stops[(at + step + stops.length) % stops.length];
}

/** Where Escape sends the focus: the page, from any other region. From the page or from outside the shell Escape is not the shell's. */
export function escapeTarget(current: string | undefined, page: string): string | undefined {
  return current === undefined || current === page ? undefined : page;
}
