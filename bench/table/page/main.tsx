// The bench page. One variant per page load (`?variant=s|r|c`), chosen by the runner:
//   variant   s  the kit's DataTable        r  the old table (@omniviewdev/base-ui)        c  the control: a windowed scroller of plain divs
//   rows      the row file: 25, 1025, 5025 (the kind corpus) or tail-5025 (the long-tailed synthetic set)
//   cells     plain (default) or real: the narrow Pods row's cells
//   overscan, step   the control's window constants (default 8 and 4, the table's)
//   count     1 counts the cells' render calls and gives the table a selection it can change
//   height    the stage's height in px (default 795): B1 uses 1720 so that the window holds about 60 rows
// The page exposes `window.__bench` (harness.ts); nothing runs until the runner calls it. Layout A (absolute rows) was mounted as `?variant=a`
// by the kit's measurement knobs of commit f4b92809 only; docs/ui-next/baseline/2026-11-16-table.md has its numbers.
import { Profiler, useEffect, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Harness, type Row } from './harness';
import type { VariantModule, VariantProps } from './variant';

const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') ?? 's';
const rowsName = params.get('rows') ?? '5025';
const options: Omit<VariantProps, 'rows' | 'tick'> = {
  cells: params.get('cells') === 'real' ? 'real' : 'plain',
  count: params.get('count') === '1',
  overscan: Number(params.get('overscan') ?? 8),
  rangeStep: Number(params.get('step') ?? 4),
};

const harness = new Harness();
window.__bench = harness;
if (params.has('height')) {
  document.documentElement.style.setProperty('--stage-height', `${Number(params.get('height'))}px`);
}

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
  harness.profile.log.push([phase, Math.round(actualDuration * 100) / 100, Math.round(baseDuration * 100) / 100]);
};

async function start() {
  const response = await fetch(`/corpus/rows-${rowsName}.json`);
  const rows = (await response.json()) as Row[];
  const module = await load();
  const Variant = module.default;

  function App() {
    const [current, setCurrent] = useState<readonly Row[]>(rows);
    const [tick, setTick] = useState(0);
    useEffect(() => {
      harness.attach(module.probe, rows, setCurrent);
      harness.rerender = () => {
        setTick((value) => value + 1);
      };
    }, []);
    // `tick` is a prop the variants pass to the table as a data attribute: a render of the parent with nothing else changed is a real render of the table.
    return <Variant rows={current} tick={tick} {...options} />;
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
