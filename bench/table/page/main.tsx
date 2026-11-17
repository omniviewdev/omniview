// The bench page. One variant per page load (`?variant=s|a|r|c`), chosen by the runner:
//   variant   s  the kit's DataTable, spacer layout        a  the kit's DataTable, absolute layout
//             r  the old table (@omniviewdev/base-ui)      c  the control: a windowed scroller of plain divs
//   rows      the row file: 25, 1025, 5025 (the kind corpus) or tail-5025 (the long-tailed synthetic set)
//   cells     plain (default) or real: the narrow Pods row's cells
//   overscan, step   the window constants of the sweep (default 8 and 4)
//   count     1 counts the cells' render calls
// The page exposes `window.__bench` (harness.ts); nothing runs until the runner calls it.
import { Profiler, useEffect, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Harness, type Row } from './harness';
import type { VariantModule, VariantProps } from './variant';

const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') ?? 's';
const rowsName = params.get('rows') ?? '5025';
const options: Omit<VariantProps, 'rows' | 'layout'> = {
  cells: params.get('cells') === 'real' ? 'real' : 'plain',
  count: params.get('count') === '1',
  overscan: Number(params.get('overscan') ?? 8),
  rangeStep: Number(params.get('step') ?? 4),
};

const harness = new Harness();
window.__bench = harness;

async function load(): Promise<VariantModule> {
  if (variant === 'r') {
    return import('./variants/Reference');
  }

  if (variant === 'c') {
    return import('./variants/Control');
  }

  return import('./variants/Kit');
}

const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration) => {
  harness.profile.commits += 1;
  harness.profile[phase] += 1;
  harness.profile.actualMs += actualDuration;
  harness.profile.baseMs += baseDuration;
};

async function start() {
  const response = await fetch(`/corpus/rows-${rowsName}.json`);
  const rows = (await response.json()) as Row[];
  const module = await load();
  const Variant = module.default;
  const layout = variant === 'a' ? 'absolute' : 'spacer';

  function App() {
    const [current, setCurrent] = useState<readonly Row[]>(rows);
    useEffect(() => {
      harness.attach(module.probe, rows, setCurrent);
    }, []);
    return <Variant rows={current} layout={layout} {...options} />;
  }

  const started = performance.now();
  const root = document.getElementById('root');
  if (root === null) {
    throw new Error('no root');
  }

  createRoot(root).render(
    import.meta.env.BENCH_REACT_BUILD === 'profiling'
      ? (
        <Profiler id="bench" onRender={onRender}>
          <App />
        </Profiler>
      )
      : <App />,
  );
  await harness.settleFirstRow(started);
}

start().catch((error: unknown) => {
  document.title = 'bench failed';
  harness.fail(String(error instanceof Error ? error.stack ?? error.message : error));
});
