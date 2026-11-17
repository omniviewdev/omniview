// B5 of the plan (docs/ui-next/slices/1a-pods-list.md 3.3) in a real engine: the fit planner's time for 5,000 rows by 12 columns, and the
// SAMPLED widths against a full-DOM oracle on the real Pod rows and on a long-tailed set.
//
//   plan time   `measureSample` + `fitInputs` + `planFit` for 5,025 rows and 12 columns, with a fresh measurer each time (every string
//               measured by the canvas once, the cost of the first plan) and with a warm one (the cost of a data change after that)
//   oracle      every cell of every row put in a hidden block in the page's own font and measured by the engine's layout: the widest text
//               and the widest kept end of each column. Compared with the sample's (canvas `measureText`, first 100, last 100 and the rows
//               in view) and with the canvas over ALL rows (the canvas's own error), in px, per column
//   plan        the planner's output from the sampled inputs against its output from the oracle's inputs, per column, at two container widths
//   growth      the sample as a scroll sweeps the whole table in windows of 40 rows (grow-only merge): how many times the planned widths change
//
// It imports the planner and the sampler from the kit's SOURCE (they are not exported from its entry); nothing here is the table's DOM.
import { fitInputs } from '../../../packages/kit/src/components/TableFit/fitColumns';
import { planFit } from '../../../packages/kit/src/components/TableFit/planFit';
import {
  createTextMeasurer, longestIndexes, measureSample, mergeSamples, sampleIndexes,
  type ColumnSample, type FitFont, type SampledColumn,
} from '../../../packages/kit/src/components/TableFit/sample';
import type { FitColumn } from '../../../packages/kit/src/components/TableFit/useTableFit';
import type { Row } from './harness';

declare global {
  interface Window {
    __fit: { run: (name: string) => Promise<unknown> };
  }
}

const FAMILY = "'Int UI Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONTS: Record<FitFont, string> = { text: `400 13px ${FAMILY}`, small: `400 12px ${FAMILY}`, mono: '400 13px monospace' };
const STEM = (row: Row) => row.name.slice(0, row.name.length - row.nameTail);
const stamp = (row: Row) => (row.createdAt === undefined ? '' : new Date(row.createdAt).toISOString().slice(0, 19).replace('T', ' '));

/** The wide column set: a select column, an identity with its namespace under it, four fixed formats and six text columns. */
const COLUMNS: Array<FitColumn<Row>> = [
  { id: 'select', kind: 'fixed', header: '', sortable: false, width: 46, utility: true, text: () => '' },
  { id: 'name', kind: 'id', header: 'Name', sortable: true, lead: 36, text: (row) => [{ text: row.name }, { text: row.namespace, font: 'small' }], tail: (row) => row.nameTail },
  { id: 'ready', kind: 'fixed', header: 'Ready', sortable: true, width: 59, text: (row) => (row.ready === undefined ? '' : `${row.ready.ready}/${row.ready.total}`) },
  { id: 'status', kind: 'fixed', header: 'Status', sortable: true, width: 157, text: (row) => row.status?.word ?? '' },
  { id: 'restarts', kind: 'fixed', header: 'Restarts', sortable: true, width: 72, text: (row) => (row.restarts === undefined ? '' : String(row.restarts)) },
  { id: 'age', kind: 'fixed', header: 'Age', sortable: true, width: 59, text: () => '' },
  { id: 'node', kind: 'flex', header: 'Node', sortable: true, text: (row) => row.node ?? '' },
  { id: 'ip', kind: 'flex', header: 'IP', sortable: true, text: (row) => row.ip ?? '' },
  { id: 'controller', kind: 'flex', header: 'Controller', sortable: true, text: (row) => STEM(row) },
  { id: 'namespace', kind: 'flex', header: 'Namespace', sortable: true, text: (row) => row.namespace },
  { id: 'created', kind: 'flex', header: 'Created', sortable: true, text: (row) => stamp(row) },
  { id: 'selector', kind: 'flex', header: 'Selector', sortable: false, text: (row) => `app.kubernetes.io/name=${STEM(row)}` },
];

const sampled: Array<SampledColumn<Row>> = COLUMNS;

function makeMeasurer() {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) {
    throw new Error('no canvas');
  }

  return createTextMeasurer(FONTS, context);
}

const now = () => performance.now();
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0, min: sorted[0] ?? 0 };
};

/**
 * The plan from the sampled rows, as the table makes it: the rows that hold each flexible column's longest strings (a pass over the rows, found
 * with a data change and kept while a window moves: pass `longest` to reuse it), the first and last rows and the window, measured; the inputs;
 * the plan. Returns the times of its steps in ms.
 */
function plan(rows: readonly Row[], columns: Array<FitColumn<Row>>, measure: ReturnType<typeof makeMeasurer>, window: { first: number; last: number }, available: number, longest?: Map<string, number[]>) {
  const flexible = columns.filter((column) => column.kind !== 'fixed');
  const t0 = now();
  const found = longest ?? longestIndexes(rows, flexible);
  const tl = now();
  const samples = measureSample(rows, sampleIndexes(rows.length, window), flexible, measure, found);
  const t1 = now();
  const inputs = fitInputs(columns, samples, measure);
  const t2 = now();
  const result = planFit(inputs, available);
  const t3 = now();
  return { samples, inputs, result, longest: found, longestMs: tl - t0, sampleMs: t1 - tl, inputsMs: t2 - t1, planMs: t3 - t2, totalMs: t3 - t0 };
}

/** The engine's own measure of every cell: the widest text and kept end per column, after the same rounding up the canvas measurer does. */
function oracle(rows: readonly Row[]): Map<string, ColumnSample> {
  const result = new Map<string, ColumnSample>();
  for (const column of COLUMNS) {
    if (column.kind === 'fixed') {
      continue;
    }

    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:-100000px;top:0;visibility:hidden;white-space:nowrap;font:${FONTS.text}`;
    const spans: Array<{ element: HTMLElement; tail: boolean }> = [];
    for (const row of rows) {
      const content = column.text(row);
      const runs = typeof content === 'string' ? [{ text: content, font: undefined }] : content;
      const kept = column.tail?.(row) ?? 0;
      for (const [position, run] of runs.entries()) {
        if (run.text === '') {
          continue;
        }

        const element = document.createElement('span');
        element.textContent = run.text;
        element.style.font = FONTS[run.font ?? 'text'];
        host.append(element);
        spans.push({ element, tail: false });
        if (position === 0 && kept > 0) {
          const end = document.createElement('span');
          end.textContent = run.text.slice(-kept);
          end.style.font = FONTS[run.font ?? 'text'];
          host.append(end);
          spans.push({ element: end, tail: true });
        }
      }
    }

    document.body.append(host);
    let textWidth = 0;
    let tailWidth = 0;
    // Read after all are in: one layout, then plain reads.
    for (const { element, tail } of spans) {
      const width = Math.ceil(element.getBoundingClientRect().width);
      if (tail) {
        tailWidth = Math.max(tailWidth, width);
      } else {
        textWidth = Math.max(textWidth, width);
      }
    }

    host.remove();
    result.set(column.id, { textWidth, tailWidth });
  }

  return result;
}

/** How wide the fixed formats' widest cell is against the declared width: a value wider than its column is cut. */
function fixedMargins(rows: readonly Row[]) {
  const measure = makeMeasurer();
  const out: Record<string, { declared: number; widest: number; cells: number }> = {};
  const extras: Record<string, number> = { status: 16 + 4 };
  for (const column of COLUMNS) {
    if (column.kind !== 'fixed' || column.width === undefined || column.id === 'select' || column.id === 'age') {
      continue;
    }

    let widest = 0;
    let cut = 0;
    for (const row of rows) {
      const text = column.text(row);
      const width = measure(typeof text === 'string' ? text : '', 'text') + 20 + (extras[column.id] ?? 0);
      widest = Math.max(widest, width);
      if (width > column.width) {
        cut += 1;
      }
    }

    out[column.id] = { declared: column.width, widest, cells: cut };
  }

  return out;
}

async function load(name: string): Promise<Row[]> {
  const response = await fetch(`/corpus/rows-${name}.json`);
  return (await response.json()) as Row[];
}

async function run(name: string) {
  const rows = await load(name);
  const widthsAt = [1117, 707];

  // --- plan time ---
  const cold: number[] = [];
  const coldSample: number[] = [];
  const coldLongest: number[] = [];
  const warm: number[] = [];
  for (let rep = 0; rep < 30; rep += 1) {
    const result = plan(rows, COLUMNS, makeMeasurer(), { first: 0, last: 40 }, widthsAt[0] ?? 1117);
    cold.push(result.totalMs);
    coldSample.push(result.sampleMs);
    coldLongest.push(result.longestMs);
  }

  const warmMeasurer = makeMeasurer();
  const warmFirst = plan(rows, COLUMNS, warmMeasurer, { first: 0, last: 40 }, 1117);
  for (let rep = 0; rep < 30; rep += 1) {
    warm.push(plan(rows, COLUMNS, warmMeasurer, { first: 100 + rep * 90, last: 140 + rep * 90 }, 1117, warmFirst.longest).totalMs);
  }

  // A data change with a warm measurer: the pass over the rows again, and the sample.
  const dataChange: number[] = [];
  for (let rep = 0; rep < 30; rep += 1) {
    dataChange.push(plan(rows, COLUMNS, warmMeasurer, { first: 100 + rep * 90, last: 140 + rep * 90 }, 1117).totalMs);
  }

  // --- the sample against the oracle ---
  const measure = makeMeasurer();
  const truth = oracle(rows);
  const everyIndex = Array.from({ length: rows.length }, (_, index) => index);
  const canvasAll = measureSample(rows, everyIndex, sampled, measure);
  const columns = COLUMNS.filter((column) => column.kind !== 'fixed').map((column) => {
    const fromSample = plan(rows, COLUMNS, measure, { first: 0, last: 40 }, 1117).samples.get(column.id);
    const real = truth.get(column.id);
    const all = canvasAll.get(column.id);
    return {
      id: column.id,
      oracleText: real?.textWidth ?? 0,
      sampleText: fromSample?.textWidth ?? 0,
      canvasAllText: all?.textWidth ?? 0,
      textDiff: (fromSample?.textWidth ?? 0) - (real?.textWidth ?? 0),
      canvasDiff: (all?.textWidth ?? 0) - (real?.textWidth ?? 0),
      oracleTail: real?.tailWidth ?? 0,
      sampleTail: fromSample?.tailWidth ?? 0,
      tailDiff: (fromSample?.tailWidth ?? 0) - (real?.tailWidth ?? 0),
    };
  });

  // --- the plan from the sample against the plan from the oracle ---
  const plans = widthsAt.map((available) => {
    const sampledPlan = plan(rows, COLUMNS, measure, { first: 0, last: 40 }, available);
    const oracleInputs = fitInputs(COLUMNS, truth, measure);
    const oraclePlan = planFit(oracleInputs, available);
    return {
      available,
      sampledWidths: sampledPlan.result.widths,
      oracleWidths: oraclePlan.widths,
      diff: sampledPlan.result.widths.map((width, index) => width - (oraclePlan.widths[index] ?? 0)),
      naturalDiff: sampledPlan.inputs.map((input, index) => input.natural - (oracleInputs[index]?.natural ?? 0)),
      scroll: [sampledPlan.result.scroll, oraclePlan.scroll],
    };
  });

  // --- growth while scrolling: the sample merged window by window through the whole table ---
  let merged: Map<string, ColumnSample> | undefined;
  const first = plan(rows, COLUMNS, measure, { first: 0, last: 40 }, 1117);
  merged = first.samples;
  let previous = first.result.widths.join(',');
  let changes = 0;
  const changedAt: number[] = [];
  for (let start = 0; start < rows.length; start += 40) {
    const window = measureSample(rows, sampleIndexes(rows.length, { first: start, last: start + 40 }), COLUMNS.filter((column) => column.kind !== 'fixed'), measure, first.longest);
    merged = mergeSamples(merged, window);
    const widths = planFit(fitInputs(COLUMNS, merged, measure), 1117).widths.join(',');
    if (widths !== previous) {
      changes += 1;
      changedAt.push(start);
      previous = widths;
    }
  }

  return {
    dataset: name,
    rows: rows.length,
    columns: COLUMNS.length,
    planMs: { cold: summary(cold), coldSample: summary(coldSample), coldLongest: summary(coldLongest), warm: summary(warm), dataChange: summary(dataChange) },
    sampleVsOracle: columns,
    plans,
    growth: { changes, changedAt, windows: Math.ceil(rows.length / 40) },
    fixed: fixedMargins(rows),
    fontCheck: { text: document.fonts.check(FONTS.text), family: FAMILY },
    userAgent: navigator.userAgent,
  };
}

window.__fit = { run };
