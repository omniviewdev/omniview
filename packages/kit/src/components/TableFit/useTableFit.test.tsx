// The hook that measures the columns of a table (ruling R9). A column's width is the widest text of a sample of its rows, and it only
// ever grows while the person scrolls, so that a column does not shrink and grow as rows come into view. That memory belongs to ONE
// measurer: a measurer that arrives later (the canvas, once the table has a font to read; a new canvas when the fonts have loaded or the
// text size changed) measures other widths, and the widths of the one before it are not widths of the text.
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableFit, type FitColumn } from './useTableFit';

type Row = { readonly name: string; readonly note: string };

/** What the table measures with before it has laid out: seven pixels a character (`useTableFit`). */
const ESTIMATE = 7;
let widthOf: (text: string) => number = (text) => text.length * 5;
let fontsSeen: string[] = [];
let canvases = 0;

/**
 * What a browser's FontFaceSet does that the table listens to. A face that layout asks for after the first paint starts a load: the set
 * sends `loading` and its `ready` is a new promise that resolves when the faces are in. WebKit never sends `loadingdone` for such a load
 * (only Chromium does); `ready` is what every engine resolves.
 */
function fakeFonts() {
  const target = new EventTarget();
  let finished: () => void = () => undefined;
  const set = Object.assign(target, {
    status: 'loaded',
    ready: Promise.resolve(),
    start() {
      set.status = 'loading';
      // The kit's TypeScript lib (ES2023) has no `Promise.withResolvers`: the resolver is kept by hand.
      set.ready = new Promise<void>((resolve) => {
        finished = resolve;
      });
      target.dispatchEvent(new Event('loading'));
    },
    finish() {
      set.status = 'loaded';
      finished();
    },
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: set });
  return set;
}

beforeEach(() => {
  fontsSeen = [];
  canvases = 0;
  widthOf = (text) => text.length * 5;
  // jsdom has no canvas: this one measures what `widthOf` says. Like a real one it keeps the face it resolved when its font was set: a
  // face that arrives afterwards is seen by a canvas that sets its font again, which is a new canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
    canvases += 1;
    let font = '';
    let resolved = widthOf;
    return {
      get font() {
        return font;
      },
      set font(value: string) {
        font = value;
        resolved = widthOf;
        fontsSeen.push(value);
      },
      measureText: (text: string) => ({ width: resolved(text) }),
    } as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fonts');
});

const columns: ReadonlyArray<FitColumn<Row>> = [
  { id: 'name', kind: 'id', header: 'Name', sortable: false, text: (row) => row.name },
  { id: 'note', kind: 'flex', header: 'Note', sortable: false, text: (row) => row.note },
];

const rows = (name: number, note: number): readonly Row[] => [{ name: 'n'.repeat(name), note: 'x'.repeat(note) }];

type Probe = { widths: readonly number[] };

type TableProps = {
  readonly data: readonly Row[];
  readonly window?: { first: number; last: number };
  readonly epoch: number;
  readonly out: Probe;
};

function Table({ data, window, epoch, out }: TableProps) {
  const scope = useRef<HTMLDivElement>(null);
  // `available` 0: the columns as they want to be, which is the sample's measure and nothing the planner adds to it.
  const plan = useTableFit({ columns, rows: data, window, available: 0, scope, epoch });
  out.widths = plan.widths;
  return <div ref={scope} />;
}

/** The first column is the table's first, so its leading inset is the 12 px edge; the last has the 12 px edge at its end. */
const first = (text: number) => text + 12 + 10;
const last = (text: number) => text + 10 + 12;

describe('the widths of the columns', () => {
  it('are those of the text in the canvas, not of the estimate that stood for it before the first layout (7 px a character)', () => {
    const out: Probe = { widths: [] };
    render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    expect(out.widths).toEqual([first(40 * 5), last(30 * 5)]);
    expect(first(40 * ESTIMATE)).toBeGreaterThan(out.widths[0] ?? 0);
  });

  it('can get narrower when the text does: a measurer that arrives for a smaller text size replaces the widths of the larger one', () => {
    const out: Probe = { widths: [] };
    const view = render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    expect(out.widths[0]).toBe(first(40 * 5));
    widthOf = (text) => text.length * 3;
    view.rerender(<Table data={rows(40, 30)} epoch={25} out={out} />);
    expect(out.widths).toEqual([first(40 * 3), last(30 * 3)]);
  });

  it('are measured again when the faces have loaded, in an engine that sends `loading` and never `loadingdone` (WebKit): the first measure was of the fallback', async () => {
    const fonts = fakeFonts();
    const out: Probe = { widths: [] };
    render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    expect(out.widths[0]).toBe(first(40 * 5));
    // The page asks for its face after the first paint, and the text is narrower in it.
    widthOf = (text) => text.length * 4;
    act(() => {
      fonts.start();
    });
    expect(out.widths[0]).toBe(first(40 * 5));
    await act(async () => {
      fonts.finish();
      await Promise.resolve();
    });
    expect(out.widths).toEqual([first(40 * 4), last(30 * 4)]);
  });

  it('are measured again when the faces were already loading when the table mounted', async () => {
    const fonts = fakeFonts();
    fonts.start();
    const out: Probe = { widths: [] };
    render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    expect(out.widths[0]).toBe(first(40 * 5));
    widthOf = (text) => text.length * 3;
    await act(async () => {
      fonts.finish();
      await Promise.resolve();
    });
    expect(out.widths[0]).toBe(first(40 * 3));
  });

  it('does not measure again for faces that were loaded before the table asked: nothing is made twice', () => {
    fakeFonts();
    const out: Probe = { widths: [] };
    render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    expect(canvases).toBe(1);
  });

  it('stops listening when it is gone: a load that ends after the table left measures nothing', async () => {
    const fonts = fakeFonts();
    const out: Probe = { widths: [] };
    const view = render(<Table data={rows(40, 30)} epoch={24} out={out} />);
    act(() => {
      fonts.start();
    });
    const before = canvases;
    view.unmount();
    await act(async () => {
      fonts.finish();
      await Promise.resolve();
    });
    expect(canvases).toBe(before);
  });

  it('only grow while the same measurer is in use: a window of shorter text does not take back what a window of longer text asked', () => {
    // A wide character is 12 px, every other 4: thirty wide ones are 360 px, and fifty narrow ones 200, so the 40 rows of narrow
    // text are the longest by length and the one wide row is in the sample only while it is in view.
    widthOf = (text) => [...text].reduce((sum, character) => sum + (character === 'W' ? 12 : 4), 0);
    const data = Array.from({ length: 1000 }, (_, index) => ({ name: 'a', note: index === 500 ? 'W'.repeat(30) : index % 25 === 0 ? 'i'.repeat(50) : 'ok' }));
    const out: Probe = { widths: [] };
    const view = render(<Table data={data} window={{ first: 490, last: 510 }} epoch={24} out={out} />);
    expect(out.widths[1]).toBe(last(360));
    view.rerender(<Table data={data} window={{ first: 100, last: 120 }} epoch={24} out={out} />);
    expect(out.widths[1]).toBe(last(360));
  });

  it('count the longest value of a column, in whatever row it is: a window at the top of 5,000 rows does not miss a path in the middle', () => {
    const out: Probe = { widths: [] };
    const many = Array.from({ length: 5000 }, (_, index) => ({ name: `job-${index % 9}`, note: index === 2600 ? 'p'.repeat(80) : 'ok' }));
    render(<Table data={many} window={{ first: 0, last: 30 }} epoch={24} out={out} />);
    expect(out.widths[1]).toBe(last(80 * 5));
  });

  it('read the font of the scope: the canvas is asked in the face the table is drawn in', () => {
    const out: Probe = { widths: [] };
    render(<Table data={rows(4, 4)} epoch={24} out={out} />);
    expect(fontsSeen.length).toBeGreaterThan(0);
    expect(fontsSeen.every((font) => /\d+(\.\d+)?px/.test(font))).toBe(true);
  });
});
