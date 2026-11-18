# JavaScript: load less, derive less, schedule only independent work

Research date: 2026-11-10. Source research and experiment proposals, not new runtime speedups. [Sprint catalog](../roadmap/2026-11-10-renderer-performance-sprint.md). Workers remain later; Grafana remains last. No CI, release or dependency changes are required.

## Most useful leads

| Lead | Repository evidence | First proof required |
|---|---|---|
| Defer Monaco | Host entry imports its bootstrap; bootstrap configures workers, loader and YAML | Emitted/loaded module graph, startup trace and first editor open |
| Split drawer tools | Static imports reach terminal, WebGL, logs and debug tools | Initial evaluation and hidden-panel activity |
| Split host/plugin routes | Static page/resource/sidebar imports | Route chunk graph and first navigation |
| Avoid whole icon namespaces | Lu/Si namespace imports plus computed lookup | Retained exports and actual loaded/evaluated bytes |
| Reuse pure accessor/formatting work | JSONPath parsing and repeated log timestamp options | CPU attribution under real fixture values |
| Reduce repeated corpus derivation | New arrays rebuild core Rows; facets scan corpus | Sparse-update CPU profile with fixed applied work |
| Narrow subscriptions | Whole table-state context and per-cell observers | Interaction/frame attribution without stale readers |
| Pause hidden work | Hidden drawers and retained tabs remain mounted | Idle CPU, observers, timers, requests and reopen behavior |

These are hypotheses about benefit. Import topology and source call counts do not establish elapsed cost.

## Static bundle evidence, not a new benchmark

The archived accepted-candidate HTML references assets/index-CBSQkkHf.js, measured at **23,053,929 uncompressed bytes**. SHA-256: 5399c1dfe3a5a2fe5dd2a76365d90c2b72068fd3d35064aec8a7c9da02d5082b.

This is a frozen prior application artifact, not a fresh build of the new research workspace. It is not compressed transfer size, parsed bytes or executed bytes. Emitted Monaco worker assets are not proof they load at startup. Do not use unrelated stale checkout dist sizes to estimate current savings.

Host configuration sets build.minify:false. A declared minifier experiment is legitimate, but must preserve that variable in manifests and comparison rules. Do not bypass cohort guards or silently change production/CI configuration.

## Delivery: make lazy boundaries real

### Monaco initialization is a contract

Moving bootstrap behind import() must still install MonacoEnvironment, configure the loader and register YAML support before the first host or plugin editor uses them. Otherwise the default loader may attempt a CDN fetch, offline startup can fail, workers can break or a second Monaco instance can appear.

Resolve actual shared-module exports before plugin consumers need them. A synchronous SystemJS namespace cannot silently become an asynchronous property getter. Preserve worker URL/CSP/origin behavior and schema lifecycle. Measure first editor open as well as table-only startup.

### Terminal, routes and sidebars

DrawerTabPanels statically reaches Terminal, LogViewer and debug panels; Terminal imports xterm and addons. A hidden panel can remain in the eager graph and keep effects alive. Lazy loading and hidden lifecycle are separate experiments.

Host pageRoutes already has router boundaries that can support lazy modules. Kubernetes entry registers many resource routes/sidebar modules statically. Deferring modules must preserve registration, navigation, errors, deep links and cancellation.

Plugin CSS is currently combined/injected into its entry. Splitting JavaScript alone may leave all CSS eager. A CSS split must avoid first-use flashes and retain explicit side-effect declarations.

### Icon namespaces and shared packages

Named ESM icon imports can tree-shake; namespace computed lookups retain broad sets. Host-only changes can merely move the same namespaces into plugin loading. Preserve opaque plugin icon names and first-use rendering before replacing the resolver.

Prefer a bounded/static known-icon registry where the owning API supports it. Do not cache arbitrary React elements by a guessed props signature: refs, handlers, context, locale, theme and accessibility inputs make that unsafe. A pure immutable SVG descriptor cache is a different, narrower experiment, only if allocation is measured.

Shared base-ui prebundles table/virtual/dnd internals while the host exposes related dependencies. That establishes potentially separate graphs, not a measured duplicate-instance bug or byte gain. Verify current emitted modules and runtime identity before changing externals. Keep both plugin shared-package maps synchronized. React and compiler-runtime identity are non-negotiable.

### Bundler myths to avoid

- A dynamic import does not defer a module also imported eagerly elsewhere.
- manualChunks can move dependencies into an initial shared chunk or change side-effect order.
- Smaller entry bytes do not prove lower total evaluation or faster first use.
- Barrels are often a dev/server import cost; production ESM can flatten them. Do not rewrite all imports from Next.js cold-start numbers.
- Do not set global moduleSideEffects:false or remove CSS side-effect declarations.
- Vite 8 issue reports do not describe our pinned Vite 7/Rollup behavior automatically.

Capture entry static closure, dynamic imports, modulepreload, loaded resources and evaluation. Count source families without asserting every emitted asset executes.

## Pure computation before workers

### Current Rows, reusable projections

Table 9.3.1 core memoization depends on data-array identity. A new array constructs current Rows and fresh accessor caches, even when most immutable originals are unchanged. Profile construction, accessors, filtering and sorting separately.

**Never retain obsolete TanStack Rows.** Reuse bounded/weakly held immutable derived keys or projections, with complete definition/locale/source invalidation, and resolve the model's current Rows. Do not patch Row internals or reuse previous Row objects to reduce construction counters.

The merged immutable sort-key path explicitly skips an unchanged sort after verifying its inputs. Its comparison reduction is not merely an accident of V8 TimSort. The separate seed-order/native-sort fallback can benefit differently across V8 and JavaScriptCore. Keep those mechanisms separate and verify order/ties/fallback behavior in native runtime measurements.

Existing deterministic receipts are algorithm diagnostics, not frame benchmarks. Preserve native fallback and all unsupported/custom sort semantics.

### Facets, search and accessors

Maintain filter/facet options from admitted deltas only if deletes, counts, dynamic definitions and off-screen records stay correct. A refined text query can reuse previous results only when the predicate is provably monotone; arbitrary fuzzy/CEL/regex queries are not.

Installed jsonpath@1.3.0 value() normalizes/stringifies then queries; inspected paths parse repeatedly. Its nodes() mutates a parsed path with shift(). Caching the mutable parser AST can corrupt later calls.

A compiled accessor or safe immutable projection is a candidate at the column-definition boundary. Preserve complex/wildcard/missing/null behavior, including existing first-match semantics. Do not introduce resource-kind branches in generic table components. Verify outputs against the existing accessor behavior across actual definitions.

### Formatters

LogEntry repeatedly calls toLocaleTimeString with options; Kubernetes chart formatters already hoist Intl formatters. Measure log-window mount costs and use existing patterns.

Any formatter cache needs bounded keys and invalidation for locale, timezone and app settings. Do not change date strings, precision, accessibility text, DST or hour-cycle behavior. Relative-time labels already have ageClock; do not replace subscribed time with compiler-cached wall-clock reads.

### Metric identity and metadata

Reuse request/dimension projections only with source-definition and target-incarnation fences. Fresh timestamps, errors, units, references and bounds remain required data. Split subscriptions rather than suppress metadata.

The previous overscan increase raised target slots while opens stayed flat. Neither counter is an upstream network-request count. Do not equate fewer registrations with fewer provider requests without tracing the pipeline.

## Scheduling: do not defer the viewport

| Work | Safe direction | Forbidden shortcut |
|---|---|---|
| Scroll range / visible rows | Keep immutable snapshot publication prompt | Transition/defer mandatory rows until blank areas appear |
| Derived search/filter work | Separate cancellable computation and atomic publication | Split a source transaction into observable inconsistent states |
| Live event notifications | Coalesce at the owned source boundary if measured | Arbitrary global 50 ms debounce or delayed deletes/source resets |
| Query notifications | Preserve query/mutation semantics | Global notifyManager rAF scheduler |
| Hidden work | Explicit ownership/visibility lifecycle | Assume display:none stops timers or requests |
| Independent parsing/registration loops | Feature-detected yielding with cancellation/backlog bounds | Assume every engine supports scheduler.yield/requestIdleCallback |

useSyncExternalStore updates are synchronous. Transitions cannot make the current virtualizer's external-store path non-blocking. React's scheduler can yield between concurrent units, not inside a long synchronous component or native layout.

Current compatibility data inspected by the research does not show stable Safari support for scheduler.yield/idle callbacks. Feature-detect the actual engine and design a bounded fallback. A MessageChannel or timer fallback is not equivalent to prioritized yield/idle semantics. Do not add a scheduler dependency merely for this research.

Coalescing needs explicit freshness limits, immediate delete/epoch/incarnation handling, visibility behavior, scope cancellation and queue bounds. AG Grid's configurable 50 ms transaction window and Freelens' one-second watch buffer are precedents to study, not delays to copy.

The console bridge serializes arguments and crosses Wails. Source inspection identified numerous debug call sites, not a newly recorded runtime count. Count actual calls before changing logging. Never silently drop warnings/errors or diagnostics to make a benchmark faster.

Audit blocking wheel/touch handlers and forced geometry reads. A scroll listener's existence alone does not prove compositor blocking; distinguish cancelable input handlers from non-cancelable scroll notifications.

## Hidden-view lifecycle

Unmounting, display:none, CSS content visibility, PageVisibilityContext and React Activity have different state/effect contracts. First identify who owns the connection, stream, metric observation, query and retained view state.

Measure hidden CPU, notifications, requests and memory; close must release ownership, while hide may need to preserve state. Reopen latency and source correctness are protected. Do not retire a shared connection because one panel is hidden, or preserve every subscription because a tab's DOM is cached.

## Workers: researched, not selected

The installed Table 9.3.1 exports experimental-worker-plugin. No upgrade is required to investigate it later. Upstream source was inspected at c14e0221b1e656c7bb35e7b3d4cdf188719a3599.

| Source finding | Consequence for a future prototype |
|---|---|
| React trading worker produces/coalesces feed | It does not prove off-main-thread sort/rendering gains |
| Worker-row-model demo is paginated | It does not prove virtual scrolling or focus handling |
| New data-array identity posts the full raw corpus through structured clone | Small patches can still copy large inputs |
| Worker keeps a shadow table; main thread still builds/rehydrates current Rows | More memory and integration work remain |
| Flat results use transferable Uint32Array permutations | Cheap output does not make input free |
| Old permutation can remain while a new corpus is pending | Reorder/middle insertion/deletion can temporarily apply wrong membership/order |
| Request/data-version fences reject obsolete responses | Additional source/query/definition/incarnation fencing is still needed |
| Offloaded stages form a contiguous pipeline prefix | Do not bypass a main-thread filter with isolated worker sorting |
| Teardown is manual; failure can leave last results frozen | Explicit owner, termination and visible error/retry policy required |
| Functions/accessors must be portable; nested rows unsupported in inspected path | Plugin closures/DOM renderers cannot simply be cloned |

These source findings justify caution, not rejection of all workers. Parsing, normalization, search indexing or faceting may be better future targets than an already-fast sort. Evaluate strings, raw buffers, projections and patch ownership based on measured whole-pipeline copies; no single transport shape is universally required.

A future worker design needs:

- Relevant pre-worker options tested or ruled out with evidence.
- Measured pure-processing bottleneck and removal experiment that improves end-to-end behavior.
- Stable record identity plus source/corpus/query/definition generations; never map old indices into a new array.
- Bounded in-flight/trailing work, cancellation or obsolete-result discard, and immediate lifecycle fences.
- Actual Vite/SystemJS/Wails worker loading under production origin/CSP, offline support and clear ownership.
- Explicit failure behavior. Do not silently freeze, show unsorted data, or fall back to an unbounded main-thread stall.
- All-thread CPU, memory, startup, copies, queue delay, integration, first-use and teardown measurements.

CPU slowdown is not a whole-machine emulator. Record actual worker behavior rather than assuming thread throttling equivalence. Unthrottled comparisons remain required. DOM, controls, React commit, layout, paint and hit testing remain main-thread/browser work.

## Experiment order and acceptance

1. Freeze merged baseline and record executed module/CPU work under equal inputs.
2. Attribute one real eager family or pure-derivation bottleneck.
3. Change one boundary; preserve shared contracts and current records.
4. Compare startup, first use, no-update scroll and equal-work live updates.
5. Reject repeatable protected regressions even when bytes/counters improve.
6. Only after simpler relevant work, evaluate a worker crossover.

Use [the measurement contract](measurement.md). No speculative percentage gains, permanent render-count tests, CI expansion or remote data submission.

## Source ledger


Strength: P1 primary/spec/source read, P2 primary-author write-up with measurements, S secondary/vendor/single-author, R repository.

**Delivery, bundling, engine**

1. Vite performance guide (barrels, plugins) — https://vite.dev/guide/performance [P1]
2. Vite 7 features: CSS code splitting, preload directives, async chunk loading — https://v7.vite.dev/guide/features#build-optimizations [P1]
3. Vite build options (`modulePreload`, `cssCodeSplit`, `chunkSizeWarningLimit`; current site documents Vite 8) — https://vite.dev/config/build-options [P1]
4. Rollup configuration options (`manualChunks`, `experimentalMinChunkSize`, `hoistTransitiveImports`, `inlineDynamicImports`, `treeshake.*`) — https://rollupjs.org/configuration-options/ [P1]
5. Rollup troubleshooting (tree-shaking is conservative) — https://rollupjs.org/troubleshooting/ [P1]
6. Rollup changelog (dynamic import and namespace tree-shaking by release; installed 4.65.1) — https://github.com/rollup/rollup/blob/master/CHANGELOG.md [P1]
7. Vite issue #23153, Vite 8 `manualChunks` regression moving a lazy chunk to boot — https://github.com/vitejs/vite/issues/23153 [S, real-world report]
8. V8, The cost of JavaScript in 2019 — https://v8.dev/blog/cost-of-javascript-2019 [P2]
9. V8, Code caching for JavaScript developers — https://v8.dev/blog/code-caching-for-devs [P1]
10. V8, Explicit compile hints (Chrome 136) — https://v8.dev/blog/explicit-compile-hints [P1]
11. V8, Blazingly fast parsing part 2 (lazy parsing) — https://v8.dev/blog/preparser [P1]
12. V8, Getting things sorted in V8 (TimSort) — https://v8.dev/blog/array-sort [P1]
13. Marvin Hagemeister, The barrel file debacle — https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/ [P2]
14. Vercel, How we optimized package imports in Next.js — https://vercel.com/blog/how-we-optimized-package-imports-in-next-js [P2]
15. Vercel react-best-practices skill (discovery checklist only; many rules are Next/RSC-specific) — https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices [S]

**Scheduling, React, measurement**

16. web.dev, Optimize long tasks — https://web.dev/articles/optimize-long-tasks [P1]
17. Chrome for Developers, Use `scheduler.yield()` — https://developer.chrome.com/blog/use-scheduler-yield [P1]
18. MDN browser-compat-data (Scheduler, requestIdleCallback, LoAF, longtask, EventTiming, Worker modules) — https://github.com/mdn/browser-compat-data [P1]
19. Chrome, Long Animation Frames API (main-thread-only attribution, `blockingDuration`) — https://developer.chrome.com/docs/web-platform/long-animation-frames [P1]
20. Chromium `cc/input` README (compositor input without main thread) — https://chromium.googlesource.com/chromium/src/+/4f89dea35a4aceb38995ea3b362a663b2aa0c8c1/cc/input/README.md [P1]
21. Chrome DevTools, how CPU throttling works and what it does not simulate — https://developer.chrome.com/blog/devtools-grounded-real-world [P1]
22. React docs: `useSyncExternalStore`, `useTransition`, `useDeferredValue`, React 18 announcement — https://react.dev/reference/react/useSyncExternalStore , https://react.dev/reference/react/useTransition , https://react.dev/reference/react/useDeferredValue , https://react.dev/blog/2022/03/29/react-v18 [P1]
23. TanStack Query core 5.105.0 source (`notifyManager`, `replaceEqualDeep`, observer tracking) — installed in the sprint workspace [R]/[P1]
24. React `scheduler@0.28.0` production source (`frameInterval = 5`, `MessageChannel`) — installed [R]/[P1]
25. Apple, Tuning your code's performance for Apple silicon (QoS, P/E cores) — https://developer.apple.com/documentation/apple-silicon/tuning-your-code-s-performance-for-apple-silicon [P1]
26. Mytkowicz et al., ASPLOS 2009, "Producing wrong data without doing anything obviously wrong!" — https://dl.acm.org/doi/10.1145/1508244.1508275 ; Georges et al., OOPSLA 2007, "Statistically rigorous Java performance evaluation" — https://dl.acm.org/doi/10.1145/1297027.1297033 ; Kalibera & Jones, ISMM 2013, "Rigorous benchmarking in reasonable time" — https://dl.acm.org/doi/10.1145/2464157.2464160 [P1; bibliographic records confirmed by web search, papers themselves not read in full; used for method justification only]

**Tables, subscriptions, workers**

27. TanStack Table worker row models guide — https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/docs/guide/worker-row-models.md [P1]
28. TanStack Table `experimental-worker-plugin` source, installed 9.3.1 `dist/worker/*` and repo `packages/table-core/src/worker/*` — [R]/[P1]
29. TanStack Table examples: `web-worker-row-models`, `realtime-trading` (React and Angular) — https://github.com/TanStack/table/tree/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/examples [P1 for what they do, S for performance claims]
30. TanStack Table React Compiler guide with benchmark — https://tanstack.com/table/latest/docs/framework/react/guide/react-compiler (source: https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/docs/framework/react/guide/react-compiler.md) and https://github.com/KevinVandy/tanstack-table-benchmarks [P1 guide, P2 benchmark]
31. TanStack Table state guide — https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/docs/framework/react/guide/table-state.md [P1]
32. TanStack Table virtualization guide — https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/docs/framework/react/guide/virtualization.md [P1]
33. TanStack Virtual 3.14.23/virtual-core 3.19.8 sources (`useFlushSync`, `directDomUpdates`) — installed [R]/[P1]
34. Surma, Is postMessage slow? — https://surma.dev/things/is-postmessage-slow [P2, 2019]
35. AG Grid high-frequency updates (async transactions, 50 ms default) and row models — https://www.ag-grid.com/javascript-data-grid/data-update-high-frequency/ , https://www.ag-grid.com/javascript-data-grid/row-models [P1]
36. Neo.mjs, The main thread is the wrong place for a data grid — https://itnext.io/the-main-thread-is-the-wrong-place-for-a-data-grid-07a5949dd2b2 and https://github.com/neomjs/benchmarks [S, vendor-authored]

**Formatting and icons**

37. MDN, `String.prototype.localeCompare` and `Date.prototype.toLocaleDateString` guidance on `Intl.Collator`/`Intl.DateTimeFormat` reuse — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare [P1]
38. Qiita, toLocaleString vs reused `Intl.DateTimeFormat` on Node.js and WebKit — https://qiita.com/ennagara128/items/4e4b87a3dbac9490c8de [S]
39. Cloud Four, Which SVG technique performs best for way too many icons? — https://cloudfour.com/thinks/svg-icon-stress-test [P2/S]
40. `react-icons@5.7.0` and `jsonpath@1.3.0`, `lodash.get@4.4.2` installed sources — [R]

**Not verified in this research.** Any WKWebView behaviour (code caching for custom schemes, worker loading, hidden-window worker timers, `Intl` costs), Wails runtime inside workers, composition of the 23,053,929-byte frozen entry by module family, the Rollup 4.65.1 chunk graph of the candidate build, payload byte sizes, and the exact accessor strings used by all plugins. The three academic references (source 26) were confirmed to exist at the cited ACM records but were not read in full.

