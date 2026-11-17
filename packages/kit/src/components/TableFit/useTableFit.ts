import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { fitInputs, type FitColumnDeclaration } from './fitColumns';
import { planFit, type FitPlan } from './planFit';
import { createTextMeasurer, measureSample, mergeSamples, sampleIndexes, type ColumnSample, type FitFont, type SampledColumn, type TextMeasurer } from './sample';

/** A column as the table hands it to the fit: what it declares and how to read its text. */
export type FitColumn<TRow> = FitColumnDeclaration & Omit<SampledColumn<TRow>, 'id'>;

export type TableFitOptions<TRow> = {
  readonly columns: ReadonlyArray<FitColumn<TRow>>;
  readonly rows: readonly TRow[];
  /** The rows mounted now. They join the sample, so a column is measured on what the person sees. */
  readonly window: { readonly first: number; readonly last: number } | undefined;
  /** The width the columns share, in px; 0 until the container has been measured. */
  readonly available: number;
  /** The element whose font the text is measured in. */
  readonly scope: RefObject<Element | null>;
  /** Changes when something that changes text widths from outside did (a text size, a row height); it makes the measurer read the font again. */
  readonly epoch: number;
};

// Before the first layout there is no font to measure with, and a test without a canvas has none at all: seven pixels a character.
const estimate: TextMeasurer = (text) => text.length * 7;

/** The font of each face, as a canvas wants it, read from what the scope element is drawn in. */
function fontsOf(scope: Element): Record<FitFont, string> {
  const style = getComputedStyle(scope);
  const size = Number.parseFloat(style.fontSize) || 13;
  const family = style.fontFamily || 'sans-serif';
  return {
    text: `${style.fontWeight} ${size}px ${family}`,
    // The second line of a cell is 12 px beside a 13 px text: the same ratio at any text size.
    small: `${style.fontWeight} ${(size * 12) / 13}px ${family}`,
    mono: `${style.fontWeight} ${size}px monospace`,
  };
}

function canvasContext(scope: Element) {
  const canvas = scope.ownerDocument.createElement('canvas');
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function sameSamples(a: ReadonlyMap<string, ColumnSample> | undefined, b: ReadonlyMap<string, ColumnSample>): boolean {
  if (a?.size !== b.size) {
    return false;
  }

  for (const [id, sample] of b) {
    const before = a.get(id);
    if (before?.textWidth !== sample.textWidth || before.tailWidth !== sample.tailWidth) {
      return false;
    }
  }

  return true;
}

// The widest sample each list of columns has had: a width only grows while the user scrolls (a column does not shrink and grow again as rows
// come into view). It is keyed by the list of columns, so a new list measures again from nothing, and the merge only ever takes a maximum,
// so reading it twice in a render (strict mode, a render that is thrown away) gives the same answer.
const widest = new WeakMap<readonly unknown[], ReadonlyMap<string, ColumnSample>>();

function grow(columns: readonly unknown[], fresh: ReadonlyMap<string, ColumnSample>): ReadonlyMap<string, ColumnSample> {
  const before = widest.get(columns);
  const next = mergeSamples(before, fresh);
  if (sameSamples(before, next) && before !== undefined) {
    return before;
  }

  widest.set(columns, next);
  return next;
}

/**
 * The column widths of a table (R9): declared widths for the fixed columns, a SAMPLED measurement for the flexible ones, one plan for the
 * container's width. The sample is measured when the rows, the window or the columns change and a width only grows from one
 * measurement to the next. The plan is arithmetic over those numbers and runs for every change of container width.
 */
export function useTableFit<TRow>({ columns, rows, window, available, scope, epoch }: TableFitOptions<TRow>): FitPlan {
  const [measure, setMeasure] = useState<TextMeasurer>(() => estimate);

  useLayoutEffect(() => {
    const element = scope.current;
    const context = element === null ? null : canvasContext(element);
    if (element === null || context === null) {
      return undefined;
    }

    const read = () => {
      setMeasure(() => createTextMeasurer(fontsOf(element), context));
    };

    read();
    // Fonts arrive after the first paint: a face that was not loaded measured as its fallback.
    const fonts = element.ownerDocument.fonts as FontFaceSet | undefined;
    fonts?.addEventListener('loadingdone', read);
    return () => {
      fonts?.removeEventListener('loadingdone', read);
    };
  }, [scope, epoch]);

  const first = window?.first;
  const last = window?.last;
  const samples = useMemo(() => {
    const visible = first === undefined || last === undefined ? undefined : { first, last };
    return grow(columns, measureSample(rows, sampleIndexes(rows.length, visible), columns, measure));
  }, [rows, columns, first, last, measure]);
  const inputs = useMemo(() => fitInputs(columns, samples, measure), [columns, samples, measure]);
  return useMemo(() => planFit(inputs, available), [inputs, available]);
}
