# Log bench

Measures the kit's `LogView` in WebKit and Chromium against the budgets of `docs/ui-next/status/P1b-2.md` ("Decision rule and budgets", written before any measurement), with a plain-DOM control. The numbers are in `docs/ui-next/baseline/2026-11-19-log.md`. It lives outside `packages/kit` and `ui-next`: the kit knows no source of lines, and the bench feeds it a seeded synthetic one (`packages/kit/src/components/LogView/syntheticFeed.ts`).

| Path | What |
|---|---|
| `page/` | The page a trial loads. `main.tsx` mounts one variant chosen by `?variant=`; `harness.ts` is `window.__bench`: the frame recorder, the source driver, the search driver and the probes; `variants/Kit.tsx` is the kit's `LogView` as `ui-next` mounts it (the built package, its stylesheet, a `ThemeProvider`) and `variants/mountKit.tsx` renders it (the one module of the page that imports React, with the optional Profiler), `variants/Control.ts` a scroller of plain `div` rows over the kit's own window maths (`windowOf`), no React. |
| `vite.config.ts` | Builds the page (the React Compiler as the product's sources get it; `OV_BENCH_REACT=profiling` swaps in `react-dom/profiling` for the commit cross-check; `OV_BENCH_OVERSCAN` patches the one overscan literal into the page's copy of the built kit, so the part measured is still the artefact `ui-next` ships and no knob exists in the product). |
| `lib.mjs` | Build, serve (cross-origin isolated, so both engines give sub-millisecond timestamps), open a fresh page with the commit counter (React's own DevTools hook) installed, paced wheel input (`bench/app/wheel-driver.mjs`), CDP metrics and the heap. |
| `run.mjs` | The timing matrix: interleaved paired trials of the configs of one engine and one workload (`follow`, `scroll`). |
| `search.mjs` | Time to search 100,000 lines for a literal, a regex, no match and a typed literal, and the frames the search holds. |
| `memory.mjs` | The heap at the cap and after another 1,000,000 lines (Chromium: the only engine that lets a page's heap be read from outside). |
| `counts.mjs` | The exact counts in a real engine: rows mounted, elements a row, listeners, writes at the document root, the hook's commits against a Profiler's. |
| `analyze.mjs` | Applies the budgets to the trials exactly as they were committed (the statistic that judges each is written in its header), prints every figure with its spread, writes the compact summary. |
| `matrix.sh` | The commands of the baseline file. |

## Run

```sh
pnpm --filter @omniviewdev/kit run build          # the page imports the BUILT kit
sh bench/log/matrix.sh m1                         # both engines, 10 rounds each, about 90 minutes
node bench/log/analyze.mjs m1 --json docs/ui-next/baseline/raw/2026-11-19-log.json
```

One piece at a time: `node bench/log/run.mjs --engine webkit --workload follow --configs kit:10000,control:10000 --rounds 10 --tag x-webkit-follow`, `node bench/log/search.mjs --engine chromium`, `node bench/log/memory.mjs`, `node bench/log/counts.mjs --engine webkit`. Playwright's browsers must be installed (`pnpm exec playwright install webkit chromium`). Do not run anything else on the machine while the matrix runs: the runner reads the 1-minute load average before and after every trial, runs a trial once more when it was above 12 (`--max-load`) at either end, and records how often. `results/` and the `.dist*` builds are git-ignored.

## Workloads

| | |
|---|---|
| follow | The 100,000-line buffer is filled (the cap), then the seeded source runs at 1,000, 10,000 or 50,000 lines a second while the list follows the end: 3 s warm-up, 10 s measured. Read: rAF intervals (one `requestAnimationFrame` loop for the whole life of the page, every variant pays for it alike), frame work (the callback to the next message-channel task: callbacks, style, layout and the main-thread part of paint), React commits (a count per frame), rows mounted, the backlog the source holds for the reader, whether the last row is the newest line. |
| scroll | The full buffer, no source, 30 pages down by paced wheel input (60 events a second, 1,200 px/s, sent from Node), then 30 one-page jumps 250 ms apart (the old viewer's own workload, `bench/render/log-viewer.bench.tsx`). `kit/30` is the kit with an overscan of 30 rows (the old viewer's) against 10. |
| search | A trial per round: the page's own count of what each query must find (the view's rule, over the same seeded lines), then the time from the input event to the commit that puts that count in the find lane. |
| memory | Heap with nothing held, with 100,000 lines held, and after 1,000,000 more went through at 50,000 lines a second; two forced collections before each reading. |

A frame is a `requestAnimationFrame` callback; intervals are the deltas of its timestamps; percentiles are nearest-rank (a frame that happened, never interpolated). Every trial is a fresh browser context and page.

## What it does not measure

Native WKWebView, Windows and Linux engines, a device pixel ratio other than 1, real fonts (the page uses the theme's), hardware rendering (both engines run headless under software rendering), a wrapped list (not built), the panel's host around the view (P1b-3). WebKit's page heap cannot be read from outside, so memory is Chromium's.
