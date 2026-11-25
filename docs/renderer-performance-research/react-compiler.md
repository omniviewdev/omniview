# React Compiler: verify coverage, then reduce work

Research date: 2026-11-10. These are source findings and isolated compiler observations, not new application speedups. Start with the [sprint catalog](../roadmap/2026-11-10-renderer-performance-sprint.md).

## Findings that change the plan

| Finding | Evidence | Action |
|---|---|---|
| Compiler is already enabled | Host, runtime, shared UI and Kubernetes build configuration | Do not propose enabling it as a fix |
| Table v9 differs from v8 | Official v9 guide and installed 9.3.1 adapter | Do not copy v8 useReactTable opt-outs |
| Stable nested table objects can still cache stale reads | Official guide; pinned compiler snippet output | Subscribe inside the actual reader or pass the required selected values |
| Broad table context broadcasts all state | DataTableContext selector returns the complete state | Profile consumers, then split boundaries without dropping invalidation |
| Four raw useVirtualizer hosts produce skip diagnostics in the scratch compile | LogViewer, FilterSelect, ChatMessageList, EventsTable | Verify real producer output before repairing hot paths |
| Inline cell renderers can be non-candidates, not reported skips | Compiler infer rules and isolated snippet output | Include silent non-candidates in coverage audits |
| Suppressions can protect correctness while preventing compilation | useColumnSizeVars and existing table invalidation contracts | Never remove suppressions just to increase coverage |
| Time-derived render values can become stale | Pinned compiler snippet output; sidebar relative-time reads | Use explicit subscribed time, following ageClock/useAge |

## What was actually recorded

The research ran Babel/compiler 1.0.0 in a scratch directory against read-only source inputs from the previous candidate workspace. It did not run the actual Vite producer builds. The [sanitized receipt](../../bench/app/renderer-research-compiler-2026-11-10.json) preserves per-file compiler events, diagnostics and method limitations.

| Source root | Files inspected | CompileSuccess functions | Distinct function locations with errors |
|---|---:|---:|---:|
| Host UI | 383 | 294 | 28 |
| Host packages | 174 | 75 | 10 |
| Host benchmark | 23 | 3 | 0 |
| Shared base-ui | 408 | 577 | 20 |
| Shared ai-ui | 58 | 62 | 4 |
| Shared editors | 39 | 6 | 6 |
| Kubernetes UI | 757 | 835 | 58 |

Functions, not files, are counted. A file can contain several functions. Non-candidates are excluded from success/error totals. A CompileSuccess event does not establish applied memoization or runtime benefit. Diagnostic events are deduplicated by source file and function start line. These are not application coverage percentages.

Previously built base-ui, ai-ui and Kubernetes artifacts contained compiler cache allocations. Reported counts were 544/57/796 function bodies and 12,761/1,293/19,292 slots respectively. Those artifacts have separate timestamps and may lag source. Eleven plugin chunks did not parse in the artifact counter. Similar scratch counts are useful reconciliation evidence, not proof that the host's real build behaves identically. The host's ordinary dist paths had no output in that audit; its separately archived application benchmark bundle does exist.

## Version-specific semantics

The baseline uses React 19.3.1, compiler 1.0.0, Table 9.3.1 and react-virtual 3.14.23 with virtual-core 3.19.8. Keep versions pinned during an experiment.

### Table v9: subscribe where the value is read

The installed useTable adapter returns a React-facing shallow wrapper when its options or selected state change. Core table, row, cell, column and header identities can remain stable while method results change. The compiler does not infer these mutable dependencies.

A nested component that receives only row and reads row.getIsSelected() can cache against row identity. Wrapping that component in a subscriber that ignores the selected value does not necessarily repair the cached read.

Safer shapes:

- Pass primitive selected/expanded/layout inputs to the component that renders them.
- Put Subscribe inside the component containing the live method read.
- Include external data/options changes when state alone does not invalidate the reader.
- Narrow selectors only after listing every slice needed by that reader.

Do not add an independent subscription to every cell by default. Do not cache arbitrary cell output by stable table identity. Never retain obsolete TanStack Rows: reuse immutable derived keys or projections, then resolve current Rows.

Existing cellState, options, layout and selected/expanded inputs are load-bearing. Preserve selection, expansion, resize, ordering, column definitions, patch preservation and source/incarnation transitions.

### Virtualization: mutable controller is not a snapshot

Raw useVirtualizer returns a stable mutable instance. Compiler 1.0.0 recognizes that hook as incompatible and skips callers in the scratch run. Existing artifacts confirmed uncompiled ChatMessageList and EventsTable; the two host callers still need real-pipeline confirmation.

The repository's useVirtualizerSnapshot publishes immutable virtual items/size through useSyncExternalStore. It compiled in the scratch run. That is a better existing pattern than adding blanket directives.

The installed useWindowVirtualizer is not flagged by 1.0.0 and produced stale-prone snippet output, but the repository has no callers. This is an upstream/version audit item, not an existing application bug.

Opt-in directDomUpdates is not a compiler cure: callers still produce the hook diagnostic. Its default translate3d mode also promotes rows. Fixed-height rows already have constant positions per index; measure actual benefit before changing DOM ownership.

## Coverage is a four-step question

1. **Configured:** correct include/exclude, producer package, plugin order, runtime sharing and version.
2. **Attempted:** named component/hook candidates, skips and reasons, plus silent non-candidates.
3. **Emitted:** inspect the function in its actual producer artifact, not only a logger count.
4. **Active:** identify which compiled artifact the measured app loaded and whether the hot path benefited.

Default infer mode does not attempt every JSX-returning callback. Inline cell arrows and some anonymous/HOC shapes require separate inspection. Do not rename or force compilation merely to improve a percentage.

A local logger can record CompileSuccess, CompileError, CompileSkip and PipelineError. Do not ship diagnostic logging, add CI gates, change panicThreshold globally or introduce compiler version churn. eslint-plugin-react-hooks 7.1.1 embeds a different compiler snapshot; lint output is not build coverage.

UI TOOLING.md and a showcase specification still describe use no memo boundaries removed during the v9 migration. Correct that guidance in P2-01 rather than reintroducing obsolete opt-outs.

## Silent correctness hazards to protect

| Hazard observed in isolated 1.0.0 output | Required safeguard |
|---|---|
| Imported relative-time helper caches only by timestamp | Subscribe to an explicit clock boundary |
| new Date()/Math.random() can cache per mount | Keep render pure; use explicit state/events for changing values |
| A derived rounded Date.now() expression can omit time from its cache inputs | Verify displayed behavior; do not assume rereading time invalidates downstream caches |
| Some react-hooks disable-next-line/block suppressions skip the enclosing function | Read the suppression's reason before repairing dependencies |
| Same-line suppression behavior differs from next-line forms | Inspect emitted output; do not game comment syntax to force compilation |
| Stable row/cell methods can return changed state | Pass/subscribe to required state and data/options inputs |
| A non-candidate emits no diagnostic | Audit inline renderer call sites explicitly |
| Experimental JSX outlining emitted invalid hyphenated-prop code in the lab | Do not enable experimental compiler flags |

These snippet observations identify plausible risks. They are not evidence that every matching application site is broken. Add a permanent regression test only for a real consumer-visible stale case not already covered.

## Compiler also has a cost

Pinned React source copies memo-cache arrays on update renders under the inspected feature flags. Caches add allocation, comparisons and retained slots. The research's per-file compiler-on/off minify experiment estimated 22–54% more minified source bytes and 31–64% more gzip bytes across inspected roots. Those are **not tree-shaken bundle deltas**, startup regressions or a reason to disable the compiler.

Base UI's external experiment also reported library byte growth. Its components, build and workload differ from ours. Measure our real bundles and startup/first-use behavior before considering narrow scope changes.

Manual memoization remains valid where it protects an explicit equality or lifecycle contract. Blanket memo removal is not part of this sprint.

## Concurrency cannot hide mandatory scroll work

useSyncExternalStore updates use synchronous scheduling. A transition around an external-store update does not make it non-blocking. React can yield between fibers for concurrent work, not halfway through one expensive component. The inspected scheduler's roughly 5 ms yielding interval is already a large part of an 8.3 ms refresh interval.

Keep viewport publication timely. Yield only independent pure work with explicit cancellation and atomic publication. Do not defer new viewport rows or suspend them on fresh store values.

## Experiments and kill criteria

| Order | Experiment | Keep only when |
|---|---|---|
| E0 | Local real-pipeline logger plus emitted-artifact reconciliation | Every hot function has an explained status, including non-candidates |
| E1 | Attribute render, commit, layout effects and browser phases | Captures show which work actually overlaps bad frames |
| E2 | Verify stale-reader/time/ownership behavior under compiled modules | Existing or new behavioral checks preserve current values |
| E3 | Repair one measured hot skip or raw virtualizer caller | Emitted change and meaningful frame/interaction gain; no protected regression |
| E4 | Narrow context/owner/leaf subscriptions | Actual interaction/frame gain, not merely fewer renders |
| E5 | Evaluate only genuinely new notification hypotheses | Prior rejected batch/window variants are not repeated unchanged |
| E6 | Conditional compiler scope/bytes experiment | Real bundle and startup/first-use gains outweigh runtime costs |
| E7 | Calibrate production versus profiling-build overhead | Attribution and acceptance cohorts remain separate |

Profiler actualDuration covers render work, not complete commit, effects or browser presentation. Use normal production React for acceptance. Profiling build and React Performance Tracks are attribution tools; their overhead is not yet quantified here.

## Evidence boundaries

No source proves every stable Table v9 method safe under every composition. Interrupted-render option mutation, full native WebKit behavior, actual host producer coverage, real bundle deltas and profiling overhead remain open. No new runtime speedup or zero-regression certification is claimed.

## Source ledger


| # | Source | Mechanism it supports | Label | Strength | Version / applicability |
|---|---|---|---|---|---|
| 1 | [React Compiler installation](https://react.dev/learn/react-compiler/installation) | Vite/Babel setup, ordering, verification (badge, output) | DOC | High | Docs describe plugin-react 6 and 5.x |
| 2 | [Configuration](https://react.dev/reference/react-compiler/configuration), [compilationMode](https://react.dev/reference/react-compiler/compilationMode), [target](https://react.dev/reference/react-compiler/target), [panicThreshold](https://react.dev/reference/react-compiler/panicThreshold), [logger](https://react.dev/reference/react-compiler/logger), [gating](https://react.dev/reference/react-compiler/gating), [directives](https://react.dev/reference/react-compiler/directives) | Option semantics | DOC | High for semantics; docs trail source | Cross-checked against 1.0.0 bundle |
| 3 | [Incremental adoption](https://react.dev/learn/react-compiler/incremental-adoption), [Debugging](https://react.dev/learn/react-compiler/debugging), [Compiling libraries](https://react.dev/reference/react-compiler/compiling-libraries), [v1.0 blog](https://react.dev/blog/2025/10/07/react-compiler-1) | Adoption, memoization-for-correctness, memo guidance, upgrade pinning, Meta results | DOC | High (benefit numbers are vendor-reported) | 1.0 |
| 4 | [eslint-plugin-react-hooks lints](https://react.dev/reference/eslint-plugin-react-hooks): [incompatible-library](https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library), [preserve-manual-memoization](https://react.dev/reference/eslint-plugin-react-hooks/lints/preserve-manual-memoization), [refs](https://react.dev/reference/eslint-plugin-react-hooks/lints/refs), [immutability](https://react.dev/reference/eslint-plugin-react-hooks/lints/immutability), [set-state-in-effect](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect), [unsupported-syntax](https://react.dev/reference/eslint-plugin-react-hooks/lints/unsupported-syntax) | Rules of React diagnostics; v8 `useReactTable` example | DOC | High | The TanStack example is v8-era |
| 5 | Compiler source on `main` (`Program.ts`, `Options.ts`, `CompilerError.ts`, `Environment.ts`, `DefaultModuleTypeProvider.ts`, `InferMutationAliasingEffects.ts`) and the published [`babel-plugin-react-compiler@1.0.0`](https://unpkg.com/babel-plugin-react-compiler@1.0.0/dist/index.js) bundle | Candidate rules, suppression handling, severities, known-incompatible list, defaults | SRC | High; use the 1.0.0 bundle for our behavior | `main` is newer than 1.0.0 |
| 6 | [Scratch lab receipt](../../bench/app/renderer-research-compiler-2026-11-10.json) with 1.0.0 | Output shapes, bailouts and source coverage | LAB | Pinned compiler; scratch pipeline only | Similar artifact counts do not prove production coverage |
| 7 | React `v19.3.1` source: [`ReactFiberHooks.js`](https://github.com/react/react/blob/v19.3.1/packages/react-reconciler/src/ReactFiberHooks.js), [`ReactFiberWorkLoop.js`](https://github.com/react/react/blob/v19.3.1/packages/react-reconciler/src/ReactFiberWorkLoop.js), [`ReactFeatureFlags.js`](https://github.com/react/react/blob/v19.3.1/packages/shared/ReactFeatureFlags.js), [scheduler flags](https://github.com/react/react/blob/v19.3.1/packages/scheduler/src/SchedulerFeatureFlags.js) | `useMemoCache`, sync lanes, yielding, profiler flags | SRC | High | Exactly our React |
| 8 | [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore), [useTransition](https://react.dev/reference/react/useTransition), [useDeferredValue](https://react.dev/reference/react/useDeferredValue), [memo](https://react.dev/reference/react/memo), [flushSync](https://react.dev/reference/react-dom/flushSync), [useContext](https://react.dev/reference/react/useContext), [useMemo](https://react.dev/reference/react/useMemo), [Rules of React](https://react.dev/reference/rules), [purity](https://react.dev/reference/rules/components-and-hooks-must-be-pure) | Concurrency limits, memo, context, purity | DOC | High | Some pages (useTransition) predate 19.3 parallel transitions |
| 9 | [Profiler](https://react.dev/reference/react/Profiler), [Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks), [React 19.2 blog](https://react.dev/blog/2025/10/01/react-19-2), [CHANGELOG 19.3.0](https://github.com/react/react/blob/main/CHANGELOG.md) | Profiling builds, tracks, Activity, 19.3 changes | DOC | High | 19.2 and 19.3 |
| 10 | [DevTools overview](https://github.com/react/react/blob/main/packages/react-devtools/OVERVIEW.md), [Profiler intro blog](https://legacy.reactjs.org/blog/2018/09/10/introducing-the-react-profiler.html), [Kent C. Dodds](https://kentcdodds.com/blog/profile-a-react-app-for-performance) | Profiling design and build pitfalls | DOC, CASE | Medium (dated) | Concept holds; numbers anecdotal |
| 11 | [TanStack Table React Compiler guide](https://tanstack.com/table/latest/docs/framework/react/guide/react-compiler), [state guide](https://tanstack.com/table/latest/docs/framework/react/guide/table-state), [virtualization guide](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization) | v9 compatibility, hazards, subscriptions, benchmark | DOC | High (benchmark = external vendor) | v9.3.x |
| 12 | Installed `@tanstack/react-table@9.3.1` (`useTable.js`, `Subscribe.js`, bundled `skills/`), `@tanstack/table-core@9.3.1` (`constructTable.js`, `renderPhaseReactivity.js`, `utils.js`), `@tanstack/react-store@0.11.2` (`useSelector.js`, which is `useSyncExternalStoreWithSelector`) | Adapter semantics, subscription lane | SRC | High | Exactly our install |
| 13 | [Table #6601](https://github.com/TanStack/table/issues/6601), [PR #6631](https://github.com/TanStack/table/pull/6631) | v9 staleness found and fixed in 9.3.1 | CASE | Medium | 9.2.x to 9.3.1 |
| 14 | [Virtual React adapter docs](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual), [API](https://tanstack.com/virtual/latest/docs/api/virtualizer), installed `@tanstack/react-virtual@3.14.23` and `virtual-core@3.19.8` source | `flushSync`, `directDomUpdates`, notification model | DOC, SRC | High | 3.14.23 |
| 15 | [Virtual #736](https://github.com/TanStack/virtual/issues/736), [#1119](https://github.com/TanStack/virtual/issues/1119), [PR #851](https://github.com/TanStack/virtual/pull/851), [reui #134](https://github.com/keenthemes/reui/issues/134) | Stale virtual items, maintainer position, field repro | CASE | Medium | 3.5 to 3.14 |
| 16 | [Sanity discussion #33](https://github.com/reactwg/react-compiler/discussions/33), [Wakelet #52](https://github.com/reactwg/react-compiler/discussions/52), [Makarevich 2024](https://www.developerway.com/posts/how-react-compiler-performs-on-real-code) | Field results, mount concerns, bundle comment, real-app limits | CASE | Medium (self-reported, different apps, beta-era for 2024 posts) | Not our workload |
| 17 | [Base UI #809](https://github.com/mui/base-ui/issues/809) and [PR #3076](https://github.com/mui/base-ui/pull/3076) | Bundle cost of compiling a leaf-heavy library | CASE | Medium | Oct 2025 |
| 18 | [TanStack Query render optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations), [React-Redux hooks](https://react-redux.js.org/api/hooks) | Selector/structural-sharing stability | DOC | High | Query 5, Redux 9 |
| 19 | [RFC #119 context selectors](https://github.com/reactjs/rfcs/pull/119), [use-context-selector](https://github.com/dai-shi/use-context-selector) | No built-in context selectors | CASE | Medium | Open since 2019 |
| 20 | [Vite env and mode](https://vite.dev/guide/env-and-mode), [plugin-react README](https://github.com/vitejs/vite-plugin-react) and 5.2.0 README | `NODE_ENV` vs mode; babel option; include/exclude; compiler options in 6.x | DOC | High | Vite 7, plugin-react 5.2 |
| 21 | [Vercel react-best-practices](https://vercel.com/blog/introducing-react-best-practices), [issue #87](https://github.com/vercel-labs/agent-skills/issues/87), claudskills skill | AI-skill appraisal | CASE | Low | Discovery checklist, not performance proof |
| 22 | Repo files: `omniview/vite.config.ts`, `package.json`, `eslint.config.cjs`, `ui/eslint.config.mjs`, `ui/docs/TOOLING.md`, data-table sources, `selectColumn.tsx`, `SelectCell.tsx`, `ageClock.ts`, `useVirtualizerSnapshot.ts`, git history | Configured versus observed facts | REPO | High | Workspace snapshot |
| 23 | Built artifacts in `ui/packages/*/dist`, `kubernetes/ui/dist/assets` | Emitted coverage | ARTIFACT | High; mtimes 2026-11-09 and 2026-11-10 | May lag source |

