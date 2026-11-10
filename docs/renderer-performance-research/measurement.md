# Measurement and acceptance: optimize locally before adding architecture

Research date: 2026-11-10. This is a research and experiment contract, not a new performance result. The implementation order is **pre-worker improvements first**. Workers remain a gated option; Grafana and external profile submission remain last.

## What the previous sprint actually established

The [committed renderer evidence](../../bench/app/renderer-sprint-metal-evidence-2026-11-10.json) contains 188 captured trial summaries and explicit limitations. Recordings used production React, 5,000 synthetic Pods, an Apple M5 Max with 128 GB, and headed Chromium with Metal. They are not real-cluster IPC, M1, or native WKWebView certification.

| Recorded case | Before | Retained candidate | Interpretation |
|---|---:|---:|---|
| No resource updates, normal CPU, p95 frame interval | 35.15 ms | 25.95 ms | 26.2% lower; still above the existing 20 ms target |
| No resource updates, normal CPU, p99 frame interval | 48.75 ms | 34.50 ms | 29.2% lower; still above 33.4 ms |
| No resource updates, 2× CPU slowdown, p95 | 141.00 ms | 115.70 ms | Still much too slow |
| Live resource updates, normal CPU, candidate p95 | Not a matched-work comparison | 33.75 ms | Baseline captured longer windows and more update events |
| Live resource updates, 2× CPU slowdown, candidate p95 | Not a matched-work comparison | 196.00 ms | Remaining large stalls are an open problem |

“No resource updates” does not mean “no work.” Scrolling still changes metric demand. The fixture can return unchanged values with fresh observation timestamps. The same behavior must remain on both sides; suppressing metadata to make a recording faster is not an optimization.

An archived local native trace also warrants investigating browser work, not only React renders:

| Event family | Recorded inclusive duration | Count |
|---|---:|---:|
| Layerize | 1,585.850 ms | 710 |
| Paint | 1,099.601 ms | 10,028 |
| HitTest | 903.012 ms | 1,006 |
| UpdateLayoutTree | 789.832 ms | 219 |
| PrePaint | 567.910 ms | 1,733 |
| Layout | 337.491 ms | 219 |

These are diagnostic event sums from one archived trace, **not additive shares of elapsed time**. Nested paint and rendering events overlap. Raw file: `metal-native-none.trace.json`; SHA-256 `fce29354bd8bc816b95aec404d12f269c9228a95031290b01b2328d3808039fd`. The trace remains in the previous sprint's local evidence archive. Re-record against the merged baseline before attributing a new change to these costs.

The previous recordings already rejected larger retained windows, two/eight-row batches, per-row compositor promotion, shallow scalar-cell memoization, normal-flow spacer rows, non-inheriting row-offset CSS registration, and DOM shell recycling. Do not repeat them unchanged. A new experiment needs a different causal hypothesis and its own paired control.

## Measure the symptom, not just a convenient proxy

| Signal | Useful for | What it does not prove |
|---|---|---|
| Main-thread `requestAnimationFrame` intervals | Main-thread update cadence and scheduling stalls | Every compositor frame was presented, or every visible row was painted |
| DOM row coverage | Virtual range and geometry correctness | Absence of compositor checkerboarding or stale pixels |
| Screenshots at selected stops | Visual correctness at those stops | Continuous smoothness between stops |
| React profiling build | Render/commit attribution and component costs | Production timing without profiler overhead |
| Normal production build | Candidate acceptance timings | Which component caused the cost without an attribution trace |
| INP / Event Timing | Click, keyboard and menu responsiveness | Continuous wheel/trackpad scroll quality |
| Long Tasks / Long Animation Frames | Severe blocking and attribution | A 20–40 ms frame is acceptable, especially on a 120 Hz display |
| Browser frame/presentation traces | Dropped/partial/stale presentations and input latency | Another engine or another device behaves identically |
| Post-GC JS heap | Retained JavaScript memory after comparable work | Native DOM, graphics allocations, GPU memory, or process RSS |

Chrome's [smoothness analysis](https://web.dev/articles/smoothness) explicitly distinguishes main-thread rAF updates, compositor updates, partial frames and checkerboarding. Use its frame-viewer and tracing guidance, including `PipelineReporter` and `EventLatency` where the installed engine exposes them. Record unsupported signals as unavailable, never zero.

[INP](https://web.dev/articles/inp#whats_in_an_interaction) excludes scrolling and hovering. A good INP score cannot certify our original scrolling complaint. [Long-frame APIs](https://developer.chrome.com/docs/web-platform/long-animation-frames) use a 50 ms notion of a long frame/task; that threshold is too coarse to certify smooth high-refresh scrolling. Also feature-detect these APIs in WKWebView rather than assuming Chromium support carries over.

Keep the current 20 ms p95, 33.4 ms p99 and 100 ms worst-stall targets as existing minimum gates. They are not a promise of perfect 120 Hz pacing: one 120 Hz refresh interval is about 8.3 ms. Record actual display cadence, DPR, viewport, power state, engine version, renderer, compositing and rasterization modes. Do not force a synthetic rAF rate and call it a hardware refresh test.

## Two workloads, not one ambiguous comparison

### Fixed work

Replay the same initial corpus, input path, resource mutations, metric value changes and metadata changes. Give each planned and applied event an identity and record completion/backlog. Wait for the same declared work to settle. Compare elapsed time, interaction latency, work counts, memory and final correctness.

A fixed-work comparison is appropriate for claims such as “processing the same 50 resource events costs less.” It must not compare a baseline that processed 100 events with a candidate that processed 50.

### Fixed duration

Apply the same declared event rate for the same input duration. Report requested, delivered and applied work separately, plus backlog, settle duration, input lag and presentation. If a slow renderer captures a longer tail, show that explicitly rather than reporting its total script time as though both capture windows matched.

This is appropriate for overload behavior and sustained scrolling. Do not silently switch between fixed-work and fixed-duration conclusions. Preserve full-corpus filtering/sorting; a smaller visible subset is not an equivalent query.

## Local experiment protocol

1. Freeze both source/build cohorts and preserve their manifests. Record host, UI, plugin and runtime inputs, minifier, compiler settings and sampler settings. Never edit the frozen baseline.
2. Build and finish type/lint/functional checks before timing. Run timings serially: no concurrent builds, tests, other browser workloads or background benchmark agents.
3. Use a normal production React build for acceptance. Use a separate profiling build for attribution. Do not mix them in percentage tables.
4. Match capture scope, coverage frequency, mutation observation, browser presentation mode and hardware renderer. The existing harness now refuses mismatched sampler modes and harness bytes.
5. Use repeated balanced before/after blocks, with recorded ordering and warmup. An initial two-sample-per-side screen can reject a bad idea; it cannot certify a gain or zero regressions. Confirm promising results with independent repeated blocks and inspect order effects.
6. Keep cold startup, warm startup, first table ready, steady scroll and live-update interactions separate. A lazy boundary can improve startup while worsening the first click; measure both.
7. Analyze independent trials/blocks, not thousands of correlated frames as though each frame were an independent experiment. Report medians, ranges and uncertainty. Investigate drift, GC, JIT and thermal effects instead of selecting the best run.
8. Record recorder overhead separately. The previous small control estimated about 54 ms of extra main-thread task work per second for full capture versus recorder off. That does not explain away the remaining browser work; recorder-off runs cannot measure frame intervals.
9. Save raw JSON, source/build hashes, trace/profiles and selected visual receipts. Remove throwaway scripts after their results are preserved. Keep permanent tests focused on consumer behavior, boundaries and lifecycle invariants.
10. Stop or reject on a repeatable regression in a protected scenario. Uncertainty is a reason to repeat or withhold a claim, not a pass. Finite recordings cannot prove the universal absence of regressions.

The [USENIX ATC 2023 ordering study](https://www.usenix.org/system/files/atc23-duplyakin.pdf) is a useful warning: test order can change measured distributions and even conclusions. This does not require adopting its orchestration framework, rebooting the workstation between every table trial, or adding CI. It does require documenting ordering and checking that a favorable result survives another balanced order.

## Protected scenario matrix

| Dimension | Required coverage |
|---|---|
| Metric state | Healthy; provider unavailable; metric columns hidden |
| Updates | No resource updates with metric retargeting; sparse resource updates; changed sort keys; metadata-only changes |
| Query | Unfiltered; full-corpus global/column filters; ascending/descending sort; ties; pagination if enabled |
| Navigation | Nominal wheel/trackpad pace; reversals; large jumps; top/middle/end; horizontal scrolling; RTL pinning |
| Pointer | Explicitly parked over rows, outside the table, and unset in a fresh context when supported; record setup |
| Controls | Keyboard focus, native buttons, checkbox selection, row menu, metric inspection, clipboard success/failure |
| Ownership | Connection/source switch; delete/recreate; late result; close; hidden view; reopen |
| Memory | Repeated equal scroll cycles, comparable idle/GC, retained JS and native/graphics signals where available |
| Hardware/engine | M5 unthrottled baseline; documented CPU stress; headed hardware rendering; local WKWebView when supported launch prerequisites are available |

Unavailable metrics must not pulse forever. Hidden metrics must create no observations. Observation/target-slot counts are not upstream network-request counts. Preserve provider-specific negative-cache behavior and do not replace a partial target failure with a blanket connection-wide ban.

For ownership transitions, an old computation may never revive a deleted resource, attach an action to another incarnation, reuse an obsolete TanStack Row, or overwrite a newer filter/source result. Hiding work by dropping sample timestamps, errors, units or bounds is forbidden.

## CPU slowdown is not an M1 emulator

Chrome documents that its [CPU slowdown suspends the tab's main thread](https://developer.chrome.com/blog/devtools-grounded-real-world). GPU work, memory bandwidth, thermal behavior and platform architecture do not become those of the user's machine. Its [device emulation guide](https://developer.chrome.com/docs/devtools/device-mode#limitations) calls emulation an approximation, not actual target hardware.

Record 2×/4× settings as main-thread stress, not “M1 equivalent.” If evaluating workers later, record worker timings and total work as well: moving work to a thread outside the main-thread slowdown can exaggerate an apparent win under that stress mode. Unthrottled end-to-end comparisons remain necessary. No external user profile is required to start this sprint.

Measure actual WKWebView page-update cadence separately from display refresh. Upstream near-60-Hz source preferences do not establish the installed app's cadence and do not relax acceptance gates. Use the existing local UI-inspection setting; no framework fork or private API is part of this sprint.

## Worker decision gate: later, not the first implementation

The user explicitly prefers exhausting simpler improvements first. The official [worker row-model guide](https://tanstack.com/table/latest/docs/guide/worker-row-models) is relevant research, not permission to replace the current renderer immediately.

Consider a worker prototype only after all of the following are true:

- A current profile identifies expensive pure processing that remains after the relevant compiler, subscription, incremental computation, DOM and module-loading opportunities have been tested.
- The bottleneck is not predominantly a paint/hit-test/layout problem that moving a sort cannot fix.
- We measure the crossover at our real 5,000-row workload and expensive-filter variants, rather than assuming a worker helps because a demo handles 100,000 rows.
- Input serialization, message copies, result rehydration, worker startup, queueing and memory costs fit inside the measured end-to-end benefit.
- The design keeps full-corpus query semantics, immediate delete/source-incarnation fences, current-row action ownership and visible pending/error behavior.
- The worker has explicit scope ownership, teardown, stale-result rejection and tested failure behavior. Silent frozen or unfiltered data is not an acceptable fallback.
- The worker loads under the actual Vite/SystemJS/Wails origin and CSP contract, without adding CI or deployment complexity.

A verified competitor use of workers would inform the design, not automatically prove that it is right for our data and interaction workload. Search scope and uncertainty must be stated when discussing Freelens.

## Reporting and privacy

Every implementation PR should use readable before/after tables with absolute values, percentage changes, trial counts, protocol, source/build fingerprints, known costs and rejected alternatives. Do not multiply independent median improvements to invent a combined speedup. Do not claim matched total-work gains when work counts or capture windows differ.

Keep this sprint local and synthetic. Do not upload the user's work-machine profiles or cluster data. Grafana/continuous profiling is a later work package, after local diagnosis and a separate decision about collection scope, credentials, retention and work-policy compliance. No CI, release-workflow or remote diagnostic infrastructure is required by this research plan.

## Use AI performance skills as a checklist, not an optimization oracle

This research consulted the repository's [profiling skill](../../.agents/skills/omniview-performance-profiling/SKILL.md), [Vercel's React performance skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md), and Chrome's [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/performance) and [heavy-script guide](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/identify-heavy-scripts). Their recommendations require adaptation:

- Next.js/RSC/server-cache, hydration, CDN and remote-image advice is not automatically relevant to a client-rendered Wails desktop application.
- The Chrome agent guide's “under 50 ms: synchronous” heuristic is not a smooth-scroll budget. A 40 ms task can miss several 120 Hz frames.
- Its “over 250 ms: worker” heuristic does not supersede this sprint's pre-worker-first decision gate.
- Vercel's barrel-import cost examples concern specific package/runtime arrangements. Measure our emitted Vite/SystemJS graph; do not claim their percentages or rewrite every ESM import.
- The heavy-script sample accumulates every script entry and repeatedly filters the full list. Do not copy an unbounded collector into a long-running IDE. Prefer bounded local attribution receipts.
- Advice to send analytics does not authorize uploading profiles or cluster data. Keep diagnostics local in this sprint.
- Blanket containment, layer promotion or content-visibility changes do not become safe because a guide recommends them. Prior experiments already demonstrated frame regressions; sticky cells, focus, measurement and accessibility still need protection.
- The local skill's environment and ownership checks remain important. A listening Vite port or successful build is not proof that the intended native app or cluster was measured.
