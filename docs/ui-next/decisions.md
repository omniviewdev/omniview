# Decisions

Binding for all UI-next work. R1–R20 are the strategy rulings of 2026-11-16; batch A and the channel answers are the owner's. Change one only through the lead.

## The two rules that prevent getting stuck

`main` always ships exactly one complete product. The new UI is built on `main` but reaches users only through a separate feature channel with its own state directory, until one flip. At every moment there are three legal moves: continue, flip, abandon. Abandon is rehearsed once, early (row N13).

The binding constraint is review and decision throughput of two people, not agent output. Conversion is cheap; integration, visual conformance and human review are the cost.

## Rulings

| # | Topic | Ruling |
|---|---|---|
| R1 | Vehicle | The new UI is a `ui-next` feature channel built from `main`: isolated state root, own plugin streams, npm dist-tag. Not a new window kind, not a two-bundle plugin archive. Fallback if the channel system proves unsuitable: a build-flagged second entry. |
| R2 | Freeze | The old shell takes fixes only once the calibration gate (R12) passes. Before it, the old shell develops normally. No feature is built twice. |
| R3 | Library | New package `@omniviewdev/kit` inside this monorepo from day one. The old `ui` repository is frozen, not imported, archived at the flip. The theme engine, CSS Modules approach and reusable sources are carried over file by file with provenance noted. |
| R4 | Names | Never reuse `@omniviewdev/ui`, `base-ui`, `ai-ui`, `editors`: an old plugin bundle must fail loudly. Deprecate `@omniviewdev/ui@0.3.0` and `providers` on npm now. |
| R5 | Primitive base | Base UI for overlays and interactive composites; native elements for per-row atoms, with shared popups through a handle (the host table already does this). No up-front spike: measure at most 3 days on the real table inside the first slice, write the decision rule first, accessibility is a veto, owned code wins ties. |
| R6 | Styling and tokens | CSS Modules, a fixed cascade-layer order, one token re-valuation: no second scale, no alias window. A key is renamed when its meaning changes. No custom-property writes at the root. Text size and density stay (the mock keeps them). |
| R7 | Component API | Closed props (no `className`, no `style`), typed layout props, and one escape hatch: plugin CSS Modules in a dedicated plugin layer. |
| R8 | Build order | Through real screens, consumer first. No component before the screen that needs it. |
| R9 | Table | The mock's "fit every column to content" cannot be computed at scale (291 ms for 60k strings in WebKit against 8 ms). Columns fit from declared widths plus a sampled measurement. This amends the spec. |
| R10 | Trust | Plugins remain trusted code in the host realm. Do now (about 6 days): remove the two consent calls from the bound surface, stop returning the MCP token to JavaScript, make the two fatal state loads recoverable. Build the plugin-free consent window once, on the new library, with the approvals slice. The written claim is limited to: plugin JavaScript cannot forge an approval through the API. A hostile plugin with a terminal and file write is NOT contained; that needs isolation and is a later decision. |
| R11 | Plugin contract | A curated surface with public and unstable tiers and an API report; icon barrels leave it. A build-time manifest describes the skeleton only (pages and slots, enough for lazy loading); per-connection and per-resource contributions stay code. The compatibility gate reads facts from the artifact and refuses on proof of mismatch, never on an unknown version. |
| R12 | Sizing | No total estimate. Build a thin first slice, then a calibration gate sizes the rest from measured throughput. Central guess for the full first slice: 12 weeks (range 10–20); to the flip at minimum scope about 30–35 weeks. Bounds, not forecasts. |
| R13 | Errors | Keep the existing error type; carry per-occurrence facts in standard status details (no wire bump: strictness applies to message bodies); one TypeScript parser and one describer. The Phase-0 fixes ride with slices and do not gate the first screen. Startup retries that exist because the backend may not be ready stay. |
| R14 | Preparation | Runs beside the first slice: delete the 168 files verified dead with no edit to live code; turn minify on; take an honest baseline with the existing `bench/app --minify on`; add lint ratchets. The old shell gets no other investment. |
| R15 | Spec | The mock becomes a checkable specification: one errata pass with one owner, then per-component cards (anatomy, states, keyboard, tokens) plus rendered goldens, vendored into the host and cited by content hash. The tag alone is a snapshot, not a freeze. |
| R16 | Review | Required checks and a merge queue for everything; a human approval only on hand-written contract paths; independent agent pre-review; agents commit under their own identity. This replaces a rule bypassed on 88% of merges today (owner amendment: batch A4). |
| R17 | Architecture pass | Not a separate phase. The layering is better than first reported (14 of 661 files in cycles). The controller/view split and the host-event gateway are done per slice, in the new tree. Lint guardrails (no cycles, layer rules, dead-code ratchet) apply from day one to the new tree. |
| R18 | Latest versions | The new tree starts on the latest of everything (Vite 8, plugin-react 6 with the compiler rewired, React Compiler pinned). The old shell is not upgraded. |
| R19 | Plugins | Kubernetes moves in slices on the channel. Proxmox and Flux are ported by their owner, who should release what is already on their `main` now (the marketplace serves builds the current host rejects). AWS and Containers are rebuilt after the flip. Flux, Proxmox and Containers are designed in the mock before their slices. |
| R20 | After the flip | What stops the next rewrite: the curated plugin API with an API report, tokens as a contract, the spec cards and goldens as regression gates, performance budgets in CI, and the compatibility gate. No second stack is ever admitted to `main`. |

## Owner decisions, batch A (2026-11-16, all yes)

| # | Decision |
|---|---|
| A1 | New library `@omniviewdev/kit` in this monorepo; the old `ui` repo frozen and not imported; the new UI delivered through a feature channel from `main` until one flip. |
| A2 | Ask the channel author whether the feature-channel system is meant and stable enough to carry this (the owner answered; see the channel answers below). Flux and Proxmox ports, and the releases of Flux 0.5.0 and Proxmox 0.4.0: the owner's team does them. |
| A3 | Feature freeze on the OLD shell (fixes only) from the calibration gate (about week 7) until the flip. |
| A4 | Review regime: required checks and a merge queue for all changes; human approval only on hand-written contract paths; agent pre-review. Amends the "never bypass" rule. |
| A5 | Licence Apache-2.0 for the plugin-facing library; confirm together with the SDK licence. |
| A6 | Safety fixes now (about 6 days): consent calls out of what plugin code can reach; MCP token not returned to JavaScript; the two fatal state-file loads recoverable. |
| A7 | Scope: Kubernetes, Flux and Proxmox migrate before the flip; AWS and Containers are rebuilt after it; the marketplace web UI is out. |
| A8 | Minimum macOS version 15.0. |
| A9 | Licensing follows Grafana's model (2026-11-16, after batch A; settles the "confirm with the SDK licence" part of A5): the IDE stays AGPL-3.0-only, and everything a plugin links against is Apache-2.0 (`packages/kit`, `packages/omniviewdev-runtime`, `packages/omniviewdev-vite-plugin`), listed in a root `LICENSING.md`. The plugin SDK relicense (AGPL-3.0 to Apache-2.0, separate repo) is for the owner and the second contributor, not an agent task. Done before the first npm publish of the kit (tracker row N16). |
| A10 | Slice 1a acquisition (2026-11-16, owner): a BOUNDED first set. The first rows paint first; the count and the sort order are provisional until loading completes, and while it loads the footer uses the mock's count-unknown wording (`N Pods loaded`). The mechanism (partial snapshots from the runtime's collection hook, or a first explicit page beside the collection) is chosen and measured in the data-layer PR (plan `slices/1a-pods-list.md`, E10). |
| A11 | Slice 1a metrics (2026-11-16, owner): CPU and Memory show CURRENT values only. Trends (sparklines) are a later slice: they need a metrics history source, retention and sampling (plan section 6; tracker row N18). |
| A12 | The design may be public (2026-11-16, owner): screenshots of the mock may live in this repository, so the four reference screenshots of slice 1a stay in `docs/ui-next/slices/1a-pods-list/`. |

## Owner answers on the channel (2026-11-16)

1. Channels are for long efforts tracking `main` with real release linking.
2. The owner registers `feature-ui-next` himself.
3. A mirror branch `feature/ui-next` and the channel tooling as designed (`mirror-ui-next.yaml`, `channels.md`).
4. Version: take the derived one as is (`X.Y.(Z+1)-feature-ui-next.<run>.<attempt>`).
5. Plugin channel sync: investigate its reliability and document it for agents (`channels.md` §4).
6. The state root lives as long as needed.
7. WebKit storage isolation is not a concern now.
8. The channel-to-frontend mapping stays hard-coded in `feature-channel.yaml`.
9. Keep the single optional `ui` input on the shared build workflow `desktop-build.yml`.

Also: no release channel is needed to build the new UI on `main` (`OMNIVIEW_UI=next`); the channel is needed only when a packaged build must be installed beside stable. N5: Reveal removed, clipboard only.

## Pending (owner; recommended answer in brackets)

- **Before the calibration gate (about week 7).** B1 closed component props with typed layout props and plugin CSS Modules as the one escape hatch [yes]. B2 table columns fit from declared widths plus a sampled measurement [yes]. B3 a retry creates a new attempt linked to the first, shown as the same row [yes]. B4 one errata pass over the 40 spec disagreements, 11 rulings from the owner [yes]. B5 the 17 surfaces the mock drops or never designed (Settings window, panel window, tab groups, Home cards, Updates page, file explorer, …): delete or design [review the defaults]. B6 a sanitised plugin diagnostic may be shown behind "Details" [yes, with redaction]. B7 activity history: keep 500 records or adopt the mock's 7-day rule [keep 500].
- **Before the flip.** C1 flip date and droppable scope [set at the gate]. C2 editor engine: trimmed Monaco now, CodeMirror 6 decided by a spike before the editor API is declared stable [yes]. C3 Resource Intelligence UI (5,498 lines, no consumer): keep or delete [delete unless its query bar ships within two releases]. C4 the 18 unused library families that need a call [decide with C3 and B5]. C5 third-party plugin UI isolation [defer; revisit before any third-party plugin is admitted].
- **Can wait.** Whether the IDE hosts agent runs and chat itself or only approvals and audit [approvals and audit]; AI component design in the mock; a dedicated Mac for nightly WebKit runs; Module Federation [not now]; a slim types-only plugin contract [after the flip]; the release-train schedule (the 0.36.0 hold, the SDK cohort, plugin releases).
