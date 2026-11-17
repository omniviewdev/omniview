// The fit planner: columns with their widths in, one width per column out. Pure arithmetic, no DOM, no React.
//
// The rules are the design mock's (research chapter 13, T3 to T7; `fitSolve` and `fitPin` in the mock's core.js). A table fits its container.
// A fixed column keeps its natural width and never moves. The flexible columns (text, and the identity column that names the row) share
// what is left: extra width goes to them in proportion to their natural widths; a deficit comes from the text columns first, in proportion
// to what each can give, then from the identity column, and each stops at a floor. There are two floors: the readable floor (the leading
// offset of the text, a measure of text, the trailing inset) holds whenever the columns fit with it; when only the compact floor fits the
// table still fits, with names clipped further; when neither fits the table scrolls sideways, with the readable floors and the identity at
// its full floor. When it scrolls, or even when it does not, the leading utility columns and the identity stay put (they are pinned).
//
// What the mock does with the DOM (it measures every cell of every row in a probe) the kit does with numbers: the natural width of a
// flexible column comes from a sample of the rows (`sample.ts`, `fitColumns.ts`), and the planner only sees the result (ruling R9).

/** `fixed` never moves; `flex` is a text column; `id` is the identity column: the one that names the row, clipped last. */
export type FitKind = 'fixed' | 'flex' | 'id';

/** One column as the planner sees it, in px. All widths are cell widths: the cell's own padding is inside them. */
export type FitInput = {
  readonly id: string;
  readonly kind: FitKind;
  /** What the column takes when nothing presses it. For a fixed column, the declared width. */
  readonly natural: number;
  /** The compact floor, a cell width: the narrowest the column goes while the table still fits. Fixed columns: their width. */
  readonly min: number;
  /** The readable floor: the leading offset of the text, a measure of text and the trailing inset. Never above `natural`. */
  readonly read: number;
  /** The identity column's floor when the table scrolls: the full leading offset, text floor and trailing inset, even when its names are shorter. */
  readonly full: number;
  /** A utility column (selection): it leads the table and is pinned with the identity. */
  readonly utility?: boolean | undefined;
};

export type FitPlan = {
  /** One whole-pixel width per column, in order. */
  readonly widths: readonly number[];
  /** The sum of the widths. */
  readonly total: number;
  /** The columns do not fit even at their compact floors: the table is wider than the container and scrolls sideways. */
  readonly scroll: boolean;
  /** Which floor the flexible columns were held to. */
  readonly floor: 'read' | 'min';
  /** Per column: whether it sticks to the start edge of the scroll region. */
  readonly pinned: readonly boolean[];
  /** Per column: the distance from the start edge at which a pinned column sticks; 0 for the others. */
  readonly offsets: readonly number[];
};

export type FitOptions = {
  /** Give extra width to the flexible columns. Default true: the table fills its container. */
  readonly stretch?: boolean | undefined;
};

/** What a pinned group must leave for the rest of the table, in px (the mock's matrix floor). */
const PIN_RESERVE = 96;
/** The share of the container a pinned group may take together with its leading columns. */
const PIN_SHARE = 0.5;
/** The identity column pins only when it is within the first five columns. */
const PIN_REACH = 4;

type FlexColumn = { readonly index: number; readonly input: FitInput };

export function planFit(columns: readonly FitInput[], available: number, options: FitOptions = {}): FitPlan {
  const stretch = options.stretch ?? true;
  if (columns.length === 0) {
    return { widths: [], total: 0, scroll: false, floor: 'read', pinned: [], offsets: [] };
  }

  const flex: FlexColumn[] = [];
  let fixedTotal = 0;
  columns.forEach((input, index) => {
    if (input.kind === 'fixed') {
      fixedTotal += input.natural;
    } else {
      flex.push({ index, input });
    }
  });
  const sumOf = (pick: (input: FitInput) => number) => flex.reduce((total, column) => total + pick(column.input), 0);
  const minOf = (input: FitInput) => Math.min(input.natural, input.min);
  const readOf = (input: FitInput) => Math.min(input.natural, input.read);
  const naturalTotal = fixedTotal + sumOf((input) => input.natural);

  // Nothing to fit into yet (the container has not been measured, or is hidden): the columns as they want to be.
  if (!(available > 0)) {
    const widths = columns.map((input) => input.natural);
    return { widths, total: naturalTotal, scroll: false, floor: 'read', pinned: columns.map(() => false), offsets: columns.map(() => 0) };
  }

  const scroll = fixedTotal + sumOf(minOf) > available;
  const floor = fixedTotal + sumOf(readOf) <= available || scroll ? 'read' : 'min';
  const floorOf = (input: FitInput) => (floor === 'read' ? readOf(input) : minOf(input));
  const real = columns.map((input) => input.natural);

  if (available >= naturalTotal) {
    const flexNatural = sumOf((input) => input.natural);
    if (stretch && flexNatural > 0) {
      for (const { index, input } of flex) {
        real[index] = input.natural + ((available - naturalTotal) * input.natural) / flexNatural;
      }
    }
  } else {
    let need = naturalTotal - available;
    // The text columns give up the deficit first, then the identity column.
    for (const group of [flex.filter((column) => column.input.kind === 'flex'), flex.filter((column) => column.input.kind === 'id')]) {
      const room = group.reduce((total, { input }) => total + input.natural - floorOf(input), 0);
      const taken = Math.min(need, room);
      if (taken > 0) {
        for (const { index, input } of group) {
          real[index] = input.natural - ((input.natural - floorOf(input)) * taken) / room;
        }
      }

      need -= taken;
    }
  }

  const widths = wholePixels(real, flex, scroll ? undefined : Math.round(real.reduce((total, width) => total + width, 0)));
  if (scroll) {
    // A table that scrolls always gives its identity the full floor, so the identity shows its text in every row.
    for (const { index, input } of flex) {
      if (input.kind === 'id') {
        widths[index] = Math.max(widths[index] ?? 0, input.read, input.full);
      }
    }
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  const pins = pinPlan(columns, widths, available);
  return { widths, total, scroll, floor, pinned: pins.pinned, offsets: pins.offsets };
}

/** Whole pixels. With a `target` the widths add up to it: the columns with the largest fractions take the spare pixels. */
function wholePixels(real: readonly number[], flex: readonly FlexColumn[], target: number | undefined): number[] {
  const widths = real.map((width) => Math.floor(width));
  if (target === undefined) {
    return real.map((width) => Math.round(width));
  }

  let spare = target - widths.reduce((total, width) => total + width, 0);
  const byFraction = flex
    .map(({ index }) => ({ index, fraction: (real[index] ?? 0) - (widths[index] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (spare <= 0) {
      break;
    }

    widths[index] = (widths[index] ?? 0) + 1;
    spare -= 1;
  }

  return widths;
}

/**
 * Which columns stick to the start edge of the scroll region (13 T7): everything up to the identity column when that takes at most half of
 * the container, else the utility columns and the identity alone while they leave `PIN_RESERVE` px for the rest, else nothing.
 */
function pinPlan(columns: readonly FitInput[], widths: readonly number[], available: number): { pinned: boolean[]; offsets: number[] } {
  const pinned = columns.map(() => false);
  const offsets = columns.map(() => 0);
  const identity = columns.findIndex((column) => column.kind === 'id');
  if (identity < 0 || identity > PIN_REACH) {
    return { pinned, offsets };
  }

  const widthOf = (index: number) => widths[index] ?? 0;
  const leading = Array.from({ length: identity + 1 }, (_, index) => index);
  const utility = leading.filter((index) => index === identity || columns[index]?.utility === true);
  const sumOf = (indexes: readonly number[]) => indexes.reduce((total, index) => total + widthOf(index), 0);
  let group: readonly number[] = [];
  if (sumOf(leading) <= available * PIN_SHARE) {
    group = leading;
  } else if (sumOf(utility) <= available - PIN_RESERVE) {
    group = utility;
  }

  let left = 0;
  for (const index of group) {
    pinned[index] = true;
    offsets[index] = left;
    left += widthOf(index);
  }

  return { pinned, offsets };
}
