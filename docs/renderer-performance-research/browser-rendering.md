# Browser rendering, virtualization and competitor research

Research date: 2026-11-10. Read with the [catalog](../roadmap/2026-11-10-renderer-performance-sprint.md) and [measurement contract](measurement.md). Source mechanisms below are hypotheses for local attribution, not diagnoses proven by a profile. No browser experiment or new application benchmark ran during this research.

## Why React-only fixes can miss the problem

The archived native trace contains substantial Layerize, Paint, HitTest, style and layout activity. Its inclusive event sums overlap; do not add them or subtract them from task time to invent exclusive shares. The archived trace used Chromium 156. Engine-source research read Chromium/WebKit main on 2026-11-10, not the exact shipped branches.

| Possible cost | Source mechanism | What remains unmeasured |
|---|---|---|
| Layerization | Blink groups paint chunks through property trees and overlap tests; structural/property/bounds changes can require a full update | Actual chunk count, full-update count, dominant caller and scaling in this page |
| Clips and wrappers | Clipped cell/span descendants can add property nodes and paint-chunk boundaries | Which nodes survive optimization and how much time removing them saves |
| Sticky cells | Sticky constraints and compositing depend on overflow, insets and ancestor geometry | Actual horizontal overflow, layer reasons and constraints cost |
| Hover and hit testing | Blink can synthesize mouse moves after layout when mouse position is known | How much HitTest comes from hover versus wheel targeting or instrumentation |
| Row transforms | Per-row property changes can invalidate compositing inputs | Whether a different structure improves actual frames, not merely counters |
| Full shell | Layerization can examine structure outside the entering rows | Table-only versus shell contribution |

The source algorithm documents O(pqd) work, including overlap trials and property-tree depth. That is not proof that our page reaches its worst case. DOM element count, paint chunks, RenderLayers and compositor layers are different quantities. Count what the runtime exposes; do not substitute one for another.

## Native pipeline details worth testing

### Layerize, transforms and clips

Blink merges chunks when possible. Changing chunk count or relevant identity, bounds and property information can require a full PaintArtifactCompositor update. Direct transform fast paths have restrictive conditions; the inspected path requires active transform animation. A will-change hint does not promise that arbitrary React/JavaScript position writes bypass layerization.

This is consistent with the previous failed per-row promotion and recycling experiments. It does not establish their exact cause. Rejected experiments remain rejected; source theory cannot overrule recorded frame regressions.

Our fixed-height rows already skip per-row ResizeObserver measurement. They use absolute transforms; cells and inner content wrappers clip overflow. Pinned selection/menu cells use sticky positioning. Measure clip/sticky/element ablations independently before designing smaller production markup.

Do not remove row clipping, wrappers, shadows or sticky behavior and call the resulting visually broken diagnostic an optimization. A winning implementation must restore truncation, portals, theme, pinning, RTL, focus and accessibility.

### Hover: control the pointer in the benchmark

The inspected Blink mouse-state path starts unknown and updates through mouse events. Wheel events alone are not equivalent to a pointer parked over the table. Programmatic clicks or other harness actions can also establish a position elsewhere.

Run controlled cases: pointer over the scrolling rows; pointer outside the table; and a fresh context with no position established if supported. Record the setup. Separately disable hover CSS as a **diagnostic**, then attribute HitTest callers and style work.

A cover-element shield during scrolling is a later candidate only if this proves material. It must not intercept wheel input, clicks, drag/selection, tooltips, focus or screen-reader interaction. Do not toggle inherited pointer-events over thousands of descendants by reflex. Do not ship disabled hover as a shortcut.

### Sticky: measure before splitting panes

Two pinned cells per mounted row can mean many sticky descendants. Whether those cells receive separate compositor backing depends on engine conditions, including actual horizontal overflow. Inspect layer reasons and scrollWidth/clientWidth before claiming hundreds of GPU layers.

Sticky-off is a diagnostic ablation. A later lane/pane design must preserve row association, horizontal alignment, resizing, RTL, z-order, focus and deep vertical offsets. ARIA ownership is not a substitute for testing the actual accessibility tree.

### Scroller-level composition differs from row promotion

A TanStack issue reports sluggish many-column Chromium tables, with scroller-level will-change/containment helping some users. Inspected Blink source links composited scrolling to opacity, direct reasons, LCD text and DPR policies on some platforms. The issue does not isolate those variables.

This is a conditional Windows/WebView2 hypothesis, not evidence for adding more layers on the M5 Mac. First inspect whether the control already scrolls on the compositor. Mac flags do not certify Windows behavior; verify that any simulated policy actually changes the relevant runtime state. Preserve text rendering quality and GPU/native memory.

### Content visibility and anchoring

content-visibility can skip off-screen rendering, not React creation, subscriptions or network work. Visible rows cannot be skipped. Nearby overscan may remain inside the browser's relevance margin, making row-level use ineffective. Hidden independent panels are a different candidate.

Containment can introduce clipping, stacking contexts, containing blocks and measurement changes. Native scroll anchoring may be unnecessary for fixed-height virtual rows but must be checked during insertion/deletion and focused-row navigation. Feature-detect support in the actual system WebKit; current browser-compat tables are not proof of every installed macOS version.

## What Freelens actually shows

| Source inspected | Table rendering | Relevant differences |
|---|---|---|
| Freelens v1.10.3 / react-window 1.8.11 | Native scroller, absolute top-positioned rows | Scroller will-change; inner pointer-events disabled while scrolling; direction-biased overscan |
| Freelens v2.0.0 and main / react-window 2.3.0 | Native scroller, absolute translateY rows | No equivalent v1 will-change/pointer-events tricks; transform shape resembles ours |
| Resource table cells | Plain div-based cells with comparatively little wrapper structure | No pinned sticky cells in the inspected resource table path |
| Watch ingestion | Buffered events flushed with a 1,000 ms reaction delay | Different freshness/workload contract; do not copy a one-second delay |

The research searched extracted source trees at those tags and main for Worker/SharedWorker/worker_threads/worker-loader/Comlink/OffscreenCanvas and related patterns. It found Monaco/language-service workers, an xterm font-canvas patch and idle-callback use, but **no evidence of worker-backed resource-table processing**. Dependencies, runtime behavior and full history were not exhaustively inspected. This is bounded negative evidence, not proof that every Freelens build lacks table workers.

The user's compared Freelens version is unknown. No matched Omniview/Freelens benchmark ran. Simpler cells and batching are plausible leads, not an explanation proven by source shape.

## TanStack: three different examples/features

| Example or feature | What it actually does | Why it is not a drop-in fix |
|---|---|---|
| React realtime-trading | Worker generates/coalesces synthetic feed; filtering/sorting and DOM stay on main thread | Its 32 px rows, overscan 10, simple cells and freshness model differ |
| web-worker-row-models | Experimental shadow-table filter/group/sort results; paginated UI | Not a virtual scrolling example; pending/error and corpus fencing need more work |
| virtualized-rows-experimental | Imperative position writes and a scrolling memo comparator | Comparator can ignore live prop changes; newly mounted positioning and focus require proof |
| directDomUpdates in react-virtual 3.14.23 | Imperative offsets/container size; default translate3d promotion | Fixed rows already have stable index positions; promotion previously regressed our frames |
| Ordinary virtualization | Render visible window plus buffer | Does not avoid full-corpus row-model processing |

The trading example also demonstrates delegated handlers, CSS width variables, narrow subscriptions and stable IDs. These **pre-worker** ideas are useful separately from its feed worker.

Do not copy a comparator that freezes mounted rows while isScrolling. Resource values, selection, source incarnations and actions must remain current during scroll. The demos do not establish off-window DOM focus handoff or native accessibility correctness for our application.

## Other production approaches and their limits

- **VS Code ListView:** imperative pooled templates, top-positioned rows and a strictly contained/translated inner container under a custom scrollbar. Different scroll ownership, renderer and accessibility contract. Our slower React DOM-shell recycling result is not refuted by its existence.
- **monday.com:** cell-type ablation and hover experiments; wrapper pointer-events toggles caused broad style work. Its low-fidelity scroll mode traded smoothness for delayed cells and drew user complaints. Our no-blank/no-stale requirement forbids adopting that tradeoff silently.
- **AG Grid:** both-axis virtualization and cell-renderer ablation; heavier renderer deferral can show skeletons. Use the attribution technique, not skeletons as success.
- **Canvas grids / Google Docs:** architecture evidence, not a migration recommendation. Custom rendering changes selection, editing, accessibility and browser integration.

## Ordered local experiments

| Order | Experiment | Falsifier / stop condition |
|---|---|---|
| A0 | Pointer controlled inside/outside/unset; hover CSS diagnostic | HitTest remains unchanged: investigate wheel/harness callers instead |
| A1 | Full versus fast layerization count; table-only versus full-shell; inert structure scaling | Cost does not scale: reject chunk-count explanation for this page |
| A2 | Runtime layer census, sizes, compositing reasons, horizontal overflow | No sticky promotion: do not claim sticky GPU-layer explosion |
| A3 | Sticky-off diagnostic | No meaningful native/frame signal: do not redesign panes |
| A4 | Clip-off diagnostic | No signal: do not risk truncation for clip theory |
| A5 | Smaller diagnostic cell DOM, same geometry/data | No signal: distinguish fixed overhead from per-element work |
| B1 | Conditional scroller composition/containment | Control already composited, no frame gain, clipping or memory regression |
| B2 | Conditional hover shield | No A0 signal or any input/focus/tooltip regression |
| B3 | Smaller production markup or pinning structure supported by A2–A5 | Native and frame gains fail confirmation or semantics regress |
| C0 | Actual WKWebView cadence, timelines and layers | Missing/unsupported signal stays unavailable, never zero |
| C1 | Compositor presentation metrics beside rAF | A favorable main-thread cadence alone does not certify pixels |

**Do not repeat top positioning unchanged.** Archived corrected top/offset ablations already exist. In metal-row-gpu-top-a.json the selector matched and computed transform was none, with p95 values 35.1/41.1 ms; the earlier paint controls reported 32.9/32.9 ms. These are small, separate diagnostic screens, not a new matched certification or a percentage comparison. A new inline-top/no-custom-property idea needs a distinct hypothesis and a fresh paired control; source examples alone do not justify rerunning a rejected family.

Do not repeat per-row containment/promotion, wider windows, batch changes, scalar memo, spacer rows, non-inheriting row offsets or DOM recycling unchanged. See the committed previous evidence and measurement note.

## WKWebView is a required separate runtime

Chromium Layerize implementation does not describe WebKit's layer traversal. WebKit uses its own overlap/backing and async scrolling trees. The inspected main source debounces some synthetic hover work; element-scroller callers were not fully traced. Do not assume a Chromium hover gain transfers.

WebKit main also contains a near-60-Hz page-update preference. That is a **cadence hypothesis**, not a measurement of our installed WKWebView. Record actual display and page-update cadence. Do not relax existing gates, assume a 16.7 ms budget, fork Wails, use private APIs or build an upstream PR just to change this preference.

The app already supports local native capture through **Settings → Developer Settings → UI inspection (WebKit)** on macOS 13.3+. Save and restart, then use Safari's Develop menu and the inspector's Record button. Follow [the existing instructions](../../README.md#native-ui-profiling-macos), including target ownership, privacy and timestamp limitations. Framework defaults alone do not describe Omniview's explicit inspection policy.

Use Web Inspector Layout & Rendering/CPU/Frames and Layers. Instruments can complement them, but validate WebContent attribution before relying on process-level hitch totals. Preserve the actual app/window/version/workload identity. No user work-machine capture or upload is required.

## Shipping gates

No blank, misplaced, frozen or wrong-incarnation rows. Preserve pinning, truncation, shadows, hover, keyboard, menus, selection, clipboard feedback and current-record actions. Verify accessibility semantics in the actual native view; do not blindly convert a table to an ARIA grid or bolt on ownership attributes without the required keyboard behavior.

Record actual presentation where supported, independent trial distributions, fixed work, native/graphics memory, hidden/reopen cleanup and CPU-stress limitations. Every protected scenario remains non-regressing. A change can improve one scenario while leaving another unchanged, but that does not complete the whole smoothness sprint.

Workers cannot execute DOM/layout/paint/hit-test work. Consider them only through the [later crossover gate](measurement.md#worker-decision-gate-later-not-the-first-implementation).

## Source catalog and applicability

Engine main links are rolling source research, not Chromium-156/WebKit-installed version proof. Inaccessible Chromium tracker pages were used only for titles/snippets, not as verified fixes. External case-study percentages are not our expected gains.


Primary engine sources: (1) [RenderingNG architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture); (2) [RenderingNG key data structures](https://developer.chrome.com/docs/chromium/renderingng-data-structures); (3) [Blink compositing README](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing/README.md); (4) [Blink paint README](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/paint/README.md); (5) `paint_artifact_compositor.cc`, `paint_property_tree_builder.cc`, `compositing_reason_finder.cc` under `third_party/blink/renderer/{platform/graphics/compositing,core/paint,core/paint/compositing}`; (6) `local_frame_view.cc`, `web_frame_widget_impl.cc`, `mouse_event_manager.cc`, `event_handler.cc`, `scrollable_area.cc`, `paint_layer_scrollable_area.cc`, `sticky_position_scrolling_constraints.cc`, `widget_base.cc`, `features.cc`, `switches.cc`; (7) [commit 3fbdbcc6 LimitLayerMergeDistance](https://chromium.googlesource.com/chromium/src/+/3fbdbcc6108fc85ce394288ad813036233ac9c79); (8) [How cc works](https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md); (9) [debug-janks](https://chromium.googlesource.com/chromium/src/+/main/docs/speed/debug-janks.md) and [Anatomy of Jank](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool/anatomy-of-jank/); (10) [display_lock README](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/display_lock/README.md); (11) [CSS Containment 2](https://drafts.csswg.org/css-contain-2/) and [CSS Scroll Anchoring](https://drafts.csswg.org/css-scroll-anchoring/); (12) [WebKit RenderLayerCompositor.cpp, EventHandler.cpp, LocalFrameView.cpp](https://github.com/WebKit/WebKit/tree/main/Source/WebCore) and the [macOS scrolling talk](https://trac.webkit.org/wiki/WhatsChangingwithscrollingonmacOS); (13) WebKit [changeset 273067](https://trac.webkit.org/changeset/273067/webkit), [animation-frame-rate explainer](https://github.com/WebKit/explainers/tree/main/animation-frame-rate), [Wails issue 6056](https://github.com/wailsapp/wails/issues/6056) and [PR 6060](https://github.com/wailsapp/wails/pull/6060); (14) [Web Inspector Layers](https://webkit.org/web-inspector/layers-tab/) and [Timelines](https://webkit.org/web-inspector/timelines-tab/), [Safari Developer Help](https://support.apple.com/guide/safari-developer/improve-rendering-performance-dev5d2cded95/mac), [WebKit inspectable blog](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/), [Apple hitches](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app); (15) [MDN browser-compat-data](https://github.com/mdn/browser-compat-data).

Case studies and library sources: (16) [TanStack Table virtualization guide](https://tanstack.com/table/latest/docs/framework/react/guide/virtualization), `realtime-trading`, `virtualized-rows-experimental`, `web-worker-row-models` and the worker guide; (17) `@tanstack/react-virtual@3.14.23` and `@tanstack/virtual-core@3.19.8` source on unpkg, and TanStack Virtual issues [860](https://github.com/TanStack/virtual/issues/860) and [1062](https://github.com/TanStack/virtual/issues/1062); (18) Freelens [issue 2278](https://github.com/freelensapp/freelens/issues/2278), [PR 2283](https://github.com/freelensapp/freelens/pull/2283) and source at `v1.10.3`, `v2.0.0`, `main`; (19) react-window [1.8.11](https://unpkg.com/react-window@1.8.11/src/createListComponent.js) and [2.3.0](https://unpkg.com/react-window@2.3.0/dist/react-window.js); (20) VS Code [`listView.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/list/listView.ts), `rowCache.ts`, `list.css`; (21) [monday.com board scroll case study](https://engineering.monday.com/how-we-improved-monday-com-boards-scroll-performance-a-case-study-on-boosting-fps-by-50/); (22) [Glide Data Grid FAQ](https://docs.grid.glideapps.com/faq); (23) [DJ Petersen, When Virtualization Lies](https://www.thedjpetersen.com/llm-thoughts/when-virtualization-lies/); (24) [Adrian Roselli, CSS display properties versus HTML semantics](https://adrianroselli.com/2020/10/a11yto-conf-css-display-properties-versus-html-semantics.html); (25) [Google Workspace Updates, Docs canvas rendering](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html) and [WebAIM](https://webaim.org/blog/seismic-change-to-docs); (26) Chromium tracker items cited by title only: 40929618, 407730433, 568369134, 41301778, 40533727, 527144302. WebKit source read for the 60 Hz finding: `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` and `Source/WebCore/platform/graphics/AnimationFrameRate.cpp`.

