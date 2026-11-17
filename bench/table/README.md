# Table bench

Measures the kit's `DataTable` in WebKit and Chromium on the real Pod rows of `corpus/`, against the table the product ships today. It is the harness of row 1a.3b (`docs/ui-next/status/1a.3b.md`); the rule that reads its numbers is written in `docs/ui-next/status/1a.3.md` and the numbers are in `docs/ui-next/baseline/2026-11-16-table.md`. It lives outside `packages/kit` and `ui-next`: the kit does not know what a Pod is, and the bench takes rows through one generic shape.

| Path | What |
|---|---|
| `corpus/` | The real-row code: `podRowsFromList` (a `kubectl get pods -A -o json` list to rows), `updates.mjs` (the seeded sparse live-update workload), `longTail.mjs` (a seeded long-tailed set of the same shape), their tests. `corpus/README.md` explains the three real sizes and what a copy of a real shape is not. |
| `prepare.mjs` | Makes `.cache/corpus/rows-25|1025|5025.json` from the kind corpus (`TABLE_CORPUS_DIR`, else `$TMPDIR/ui1a3-table`, else `/tmp/ui1a3-table`) and `rows-tail-5025.json`; records the sha-256 of every source file in `corpus.json`. |
| `page/` | The page a trial loads. `main.tsx` mounts one variant chosen by `?variant=`; `harness.ts` is `window.__bench`: the frame recorder, the live-update driver and the probes; `variants/` hold S (the kit's `DataTable`), R (the library table of `@omniviewdev/base-ui`) and C (a windowed scroller of plain divs); `columns.tsx` the narrow column set in plain and real cells; `fit.ts` the planner's own bench. |
| `vite.config.ts` | Builds the page (React Compiler as the product's sources get it; `OV_BENCH_REACT=profiling` swaps in `react-dom/profiling` for the count runs). The kit comes from its built `dist`. |
| `lib.mjs` | Build, serve (cross-origin isolated, so both engines give sub-millisecond timestamps), open a fresh page, paced wheel input, CDP metrics. |
| `run.mjs` | The timing matrix: interleaved paired trials of the configs of one engine and workload. |
| `analyze.mjs`, `figures.mjs`, `sweep.mjs`, `report.mjs` | Apply the committed decision rule to the trials and print every figure with its spread; the overscan and step sweep; fill a baseline file's tables from the analysis. |
| `a11y.mjs` | The accessibility veto: aria snapshot, the Chromium tree, Tab stops, axe-core (`AXE=<axe.min.js>`). |
| `counts.mjs` | The exact counts in a real engine (elements, listeners, commits, root writes). |
| `w3.mjs` | Mount time, the bulk re-mount of a 60-row window (B1) and the sort. |
| `fit.mjs` | B5: plan time and the sampled widths against a full-DOM oracle. |
| `matrix.sh`, `pack.mjs` | The commands of the timing matrix; pack the results into `docs/ui-next/baseline/raw/1a3b/`. |

## Run

```sh
pnpm --filter @omniviewdev/kit run build        # the page imports the BUILT kit
node bench/table/prepare.mjs                    # rows from the kind corpus (needs /tmp/ui1a3-table or TABLE_CORPUS_DIR)
node bench/table/run.mjs --engine webkit --workload w1 --configs s,r,c --rounds 15 --tag webkit-w1
node bench/table/analyze.mjs <prefix>           # after sh bench/table/matrix.sh <prefix>
```

Playwright's browsers must be installed (`pnpm exec playwright install webkit chromium`). A run takes about 10 minutes per engine, workload and CPU rate (15 rounds of the configs). Do not run anything else on the machine while it does: the runner reads the 1-minute load average before and after every trial, repeats a trial above 12 (`--max-load`) and records how often.

## Variants and workloads

| | |
|---|---|
| S | the kit's `DataTable` |
| A | the layout the old table ships, rebuilt on the same components (absolute rows, flex rows, explicit ARIA roles). It was removed by the cleanup commit after the measurement (the rule deletes the loser); it exists on commit `f4b92809` and the page built there is what `matrix.sh` measured (`1570a872`) |
| R | the old table, mounted as the host mounts it (`ui/components/tables/Resources/ResourceTableContainer.tsx`): fixed 30 px rows, one line, the identity's namespace a column of its own |
| C | the control: the same windowing over plain divs |
| W0 | wheel input at 1,200 px/s, 60 events a second from Node, for 5 s after a 3 s warm-up of the same scroll |
| W1 | W0 with the seeded sparse updates at the row level: 5 events a second, 2 rows each, every tenth touch a delete and recreate |

A frame is a requestAnimationFrame callback; intervals are the deltas of its timestamps; frame work is from the start of the callback to the next message-channel macrotask (callbacks, style, layout and the main-thread part of paint). Percentiles are nearest-rank. The scroll window is the frames between the first and the last frame whose scroll position moved.

## What it does not measure

Native WKWebView (step 1a.11), Windows and Linux engines, memory (G-T5), the compositor's own cadence (WebKit exposes none; Chromium needs a trace), a device pixel ratio other than 1, real fonts (the page uses the system font), hardware rendering (both engines run headless under software rendering).
