// Where the stack stands (ch16 S79, P7; the mock's `place()` in shell-notify.js, whose rule is in its header and is kept whole): a toast never covers a control. Pure: the DOM adapter (./usePlacement.ts) measures
// the page and asks, this decides. Nothing here reads a document or holds a timer.
//
// The stack is HOME, at the bottom right above the status bar, 420 px wide. It CONFLICTS when any control is nearer than 4 px to it. A control is a visible, enabled thing the user can act on that really answers at its
// centre (the adapter asks the browser; one clipped by a scroll area does not count). The decision is made again after every change to the stack, a resize, a scroll and a change of layout, and the first of these that
// is free wins:
//   1. HOME, when no control is within 4 px of it;
//   2. where it already stands ("moved"), while no control is within 4 px of that;
//   3. the nearest spot to home, by distance, that is 8 px clear of every control, tried at 420, 360, 320, 280 and 240 px wide (a narrower stack wraps its text, so it is taller) on the right edge, the centre,
//      the left edge and beside every control;
//   4. YIELD: nothing fits. The stack is hidden and inert, and says so once.
// It returns home as soon as home is clear.

/** Nearer than `pad` to a control is a conflict; a moved stack keeps `gap` clear of every control, `top` from the top of the window and `edge` from its sides. */
export const PLACE = { pad: 4, gap: 8, top: 8, edge: 12 } as const;

/** The widths a stack is tried at, widest first. Home is the widest; a window narrower than home has its own home width, which is first. */
export const WIDTHS: readonly number[] = [420, 360, 320, 280, 240];

/** What a narrower stack costs: each toast wraps one more line (16 px) for every 120 px the stack is narrower than home. An estimate that the next decision replaces with the measure. */
const WRAP = { every: 120, line: 16 } as const;

/** Most spots tried at one width, nearest to home first. */
const CANDIDATES = 80;

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** One control of the page: its box, and whether the point at its centre really reaches it. The answer is asked lazily, and only for a control that is near enough to matter. */
export type Control = { readonly box: Box; readonly reached: () => boolean };

/** Where the stack stands: `default` is home, `moved` is a box of its own (physical pixels from the window's top left corner), `yield` is nowhere. */
export type Place = { readonly mode: 'default' } | { readonly mode: 'yield' } | { readonly mode: 'moved'; readonly x: number; readonly y: number; readonly w: number };

export const HOME: Place = { mode: 'default' };

export type Situation = {
  /** The controls of the page, the stack's own not among them. */
  readonly controls: readonly Control[];
  /** The width of the window. */
  readonly viewport: number;
  /** Home: the right edge and the bottom of its box, and the width it has there. */
  readonly home: { readonly right: number; readonly bottom: number; readonly width: number };
  /** How many toasts the stack holds. */
  readonly count: number;
  /** How tall the stack is now, wherever and however wide it stands. */
  readonly height: number;
  readonly current: Place;
};

export const samePlace = (a: Place, b: Place): boolean => a.mode === b.mode && (a.mode !== 'moved' || (b.mode === 'moved' && a.x === b.x && a.y === b.y && a.w === b.w));

const meets = (box: Box, other: Box, pad: number): boolean => box.left < other.right + pad && box.right > other.left - pad && box.top < other.bottom + pad && box.bottom > other.top - pad;

const clearOf = (controls: readonly Control[], box: Box): boolean => !controls.some((control) => meets(control.box, box, PLACE.pad) && control.reached());

/** The lowest gap in the column [left, left + w] that is `gap` clear of every control and `h` tall, not lower than `limit`: the top of the stack there, or `undefined`. */
function slide(controls: readonly Control[], left: number, w: number, h: number, limit: number): number | undefined {
  const right = left + w;
  const spans = controls
    .filter((control) => control.box.left < right + PLACE.gap && control.box.right > left - PLACE.gap && control.reached())
    .map((control): [number, number] => [control.box.top - PLACE.gap, control.box.bottom + PLACE.gap])
    .sort((a, z) => a[0] - z[0]);
  let best: number | undefined;
  let cursor: number = PLACE.top;
  for (const [from, to] of spans) {
    const end = Math.min(from, limit);
    if (end - cursor >= h) {
      best = end;
    }

    cursor = Math.max(cursor, to);
  }

  if (limit - cursor >= h) {
    best = limit;
  }

  return best === undefined ? undefined : best - h;
}

/** Where the stack stands, given the page. The same `current` object when it stays where it is. */
export function decide(situation: Situation): Place {
  const { controls, viewport, home, count, height, current } = situation;
  if (count === 0) {
    return HOME;
  }

  const lines = (w: number): number => (w < home.width ? Math.ceil((home.width - w) / WRAP.every) : 0);
  const natural = height - WRAP.line * count * lines(current.mode === 'moved' ? current.w : home.width);
  const homeX = (w: number): number => home.right - w;
  const box = (x: number, y: number, w: number, h: number): Box => ({ left: x, top: y, right: x + w, bottom: y + h });

  if (clearOf(controls, box(homeX(home.width), home.bottom - natural, home.width, natural))) {
    return HOME;
  }

  if (current.mode === 'moved' && clearOf(controls, box(current.x, current.y, current.w, height))) {
    return current;
  }

  for (const w of [home.width, ...WIDTHS.filter((width) => width < home.width)]) {
    const h = natural + WRAP.line * count * lines(w);
    const xs = new Set<number>([homeX(w), Math.round((viewport - w) / 2), PLACE.edge]);
    for (const control of controls) {
      if (control.reached()) {
        xs.add(Math.round(control.box.right + PLACE.gap));
        xs.add(Math.round(control.box.left - PLACE.gap - w));
      }
    }

    const near = [...xs]
      .filter((x) => x >= PLACE.edge && x + w <= viewport - PLACE.edge)
      .sort((a, z) => Math.abs(a - homeX(w)) - Math.abs(z - homeX(w)))
      .slice(0, CANDIDATES);
    let best: { readonly x: number; readonly y: number; readonly cost: number } | undefined;
    for (const x of near) {
      const y = slide(controls, x, w, h, home.bottom);
      if (y === undefined) {
        continue;
      }

      const cost = Math.abs(x - homeX(w)) + Math.abs(y - (home.bottom - h));
      if (best === undefined || cost < best.cost) {
        best = { x, y, cost };
      }
    }

    if (best !== undefined) {
      return { mode: 'moved', x: best.x, y: best.y, w };
    }
  }

  return { mode: 'yield' };
}
