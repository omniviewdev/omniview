# Metrics visual consistency audit

**Status: findings recorded; fixes paused for review.** No component or application code was changed during this audit.

The previous delivery verified data, interactions, and standalone components. It did not establish fidelity between the actual IDE and the approved composition. Calling that delivery visually complete was wrong.

## Baseline

| Repository | Audited revision |
| --- | --- |
| Host/runtime | `d79fe71f2274a8cb758a87c018b74ebc6b5c2219` |
| Kubernetes | `993336c6e2231bc4ae240eb647f89b1bec39439b` |
| UI worktree / approved components | `ff51436114d4e00fa2f59f1900d675d74836b11e` |

The metrics source has no diff between UI commits `ff51436` and `201c595`. Most regression came from integration choices, not a replacement of the approved library components.

User-supplied before images are preserved under [metrics-visual-audit-20261106](../evidence/metrics-visual-audit-20261106/). These remain the comparison baseline; future evidence must not replace them.

## Findings

| ID | Finding and cause | Correct owner / required change |
| --- | --- | --- |
| V01 | **Table bars were removed.** `TableMetrics.tsx:103–105` renders only `MetricValue`; no bound or bar reaches the cell. This value-only composition entered in Kubernetes commit `9b07a29`. | **Kubernetes + base-ui.** Supply genuine per-row bounds through typed table configuration. Compose a shared table-friendly metric cell; preserve one batched observation. |
| V02 | **“Small” values are still card statistics.** `Scalars.module.css:103–104` uses a card-stat font token. Unit text remains 13px. Existing compact capacity is a 24px-high layout with a 12px track, not the old dense table treatment. | **Base-ui capability gap.** Add table density/sizing and bar/value layout. No vertical scalar capacity API currently exists; temporal `sample-bars` is not that primitive. |
| V03 | **The approved switcher already exists but was bypassed.** `ResourceMetricPanels.tsx:158` explicitly selects `presentation="menu"`; `MetricDisplayPicker` defaults to the inset-backed segmented control. | **Kubernetes composition.** Use the existing segmented API. No replacement component is needed. |
| V04 | **The up arrow is an unsolicited reorder action.** `ResourceMetricPanels.tsx:151–157` moves a metric earlier and persists the order. It is not expand, drill-down, or refresh. | **Kubernetes composition.** Remove it from the approved card header. If ordering needs a visible affordance later, design it separately. |
| V05 | **Identity chips were fed the wrong data category.** Details receive only `result.dimensions`. Grafana joins by `IdentityLabels`, but returns only declared series `Dimensions`; the Kubernetes recipes do not declare cluster/namespace/pod as dimensions. | **Runtime/owner composition.** Expose and compose genuine structured identity separately from series dimensions. Existing `MetricDetails.labels` already renders the approved chips. Do not parse opaque identity strings or invent labels. |
| V06 | **Friendly source attribution was discarded.** Details display datasource kind, such as `prometheus`, instead of the connection/datasource presentation. The selector also reduces options to text and appends plugin IDs. | **Runtime/shared presentation + owner composition.** Resolve plugin presentation metadata and retain distinct owner, provider connection, and datasource identities. Use icons through existing shared slots where sufficient. |
| V07 | **Dual-shape metrics lose their current row.** `ResourceMetricPanels.tsx:61–75,125–126` excludes range-capable metrics from current reads and selects only one observation. Details therefore cannot show both real Current and History rows. | **Kubernetes orchestration.** Observe supported current and range shapes in shared batches; chart only the range series. Native-only sources stay current-only. Unknown historical expiry must remain unknown, not a fabricated deadline. |
| V08 | **Spacing is partly story scaffolding, not a shared contract.** The approved story supplies a `PanelValue` spacer. The IDE uses a generic `Stack`. Shared panel body has no bottom gutter; chart timestamp row has no vertical padding. | **Base-ui.** Own value/plot and axis/footer spacing in the shared composition API or component layout. Do not copy the story CSS into the plugin. |
| V09 | **Icon gaps are genuinely inconsistent in core primitives.** Menu triggers and Popover trigger/close classes use inline-flex without a content gap or consistent direct-SVG sizing. Button has the canonical gap/icon tokens. Details source row independently has a 6px gap, explaining why it looks correct. | **Base-ui core styling.** Align shared trigger sizing and spacing with Button tokens. Preserve custom rendered Button chrome ownership; do not patch metric buttons individually. |
| V10 | **Source selection drops visual provider identity.** `MetricSourcePicker.tsx:24–31,41–64` constructs text-only options and trigger content. Source plugin IDs survive, and plugin inventory exposes icon metadata. | **Shared presentation + Kubernetes data composition.** Render provider icons, concise connection/datasource labels, and accessible fallback text. No Kubernetes/Grafana branches inside generic controls or wire-level icon field are required. |
| V11 | **The temporal control chooses the wrong abstraction and density.** `TimeRangeControl.tsx:39–40,93–109` uses a 240px small popover and `Input.Control type="datetime-local"`. Input forwards that type to BaseInput; it does not delegate to the themed date/time picker. Browser-native popup behavior therefore leaks through. | **Base-ui.** Compose the existing DateTimePicker/DateField/TimeColumns into a usable range interaction. Verify explicit date and time selection, popup sizing, labels, keyboard operation, and nested focus behavior. A new calendar implementation is not justified. |

### Related temporal caveats

These are audit observations, not authorization for extra behavior changes:

- `TimeRangeControl.dateInput()` truncates milliseconds; DateTimePicker editing also resets milliseconds. Define the intended precision before changing it.
- DateTimePicker hardcodes field/calendar accessible names. Distinguishable Start/End labeling may need a small general API extension.
- Relative presets currently commit immediately. That is an interaction choice, not an established defect; do not silently change it while repairing the popup.

## What belongs in the UI package

| Need | Existing capability | Missing or incorrect shared contract |
| --- | --- | --- |
| Dense table metric | MetricValue, compact CapacityBar | Table typography, track density, value placement; vertical scalar orientation if required |
| Approved display switcher | Segmented MetricDisplayPicker | No new component; integration selected the wrong variant |
| Identity chips | MetricDetails labels | Genuine identity metadata plumbing, not new chip markup |
| Consistent icon controls | Button decorators and tokens | Menu/Popover trigger gap and icon-size parity |
| Visual source selection | Select composition and icon-capable content | Verify existing slots first; add shared presentation only if insufficient |
| Date and time range | DateTimePicker, DateField, TimeColumns | Usable range composition, sizing, and potentially distinct accessible labels |
| Card rhythm | MetricPanel and chart primitives | Story-only spacing must become shared component behavior |

Capacity semantics must stay honest. Kubernetes already has Pod bound helpers covering requests, limits, init containers, and overhead. Node capacity exists too, but CPU units require conversion. Never use an arbitrary constant or observed row maximum as utilization capacity.

## Why verification missed this

1. Standalone stories used the desired composition; the IDE assembled a different one.
2. `ResourceMetricPanels.test.tsx` mocks the picker, temporal control, details, capacity, and charts. Those checks cannot detect these visual differences.
3. One test explicitly expects disjoint current/history metric sets, preserving the shortcut instead of the approved paired-sample behavior.
4. Table stories did not cover real row density, narrow columns, or unknown bounds.
5. No acceptance gate compared the integrated IDE against the approved reference before posting “verified” screenshots.

## Proposed prevention rules

- Shared visuals, density, tokens, temporal interactions, and icon layout belong in base-ui. Host/plugins compose them and supply domain data.
- A common need missing from base-ui must be recorded and implemented there before a local substitute is accepted.
- Disallow raw interactive controls and browser-native temporal pickers in application/plugin views. Designated component implementations may use semantic HTML internally; this is not a blanket ban on layout markup.
- Do not override shared component chrome or theme tokens locally. Use documented props/slots; report missing capability instead.
- Keep orchestration tests, but add real-component integration stories and actual IDE visual comparison for visual acceptance.
- Preserve zero, missing data, unknown bounds, native-only capabilities, and real source timestamps throughout the visual repair.

## Before/after ledger

**Every finding is currently open.** Each fix must append its commit, owning package, component story, actual IDE screenshot, and behavioral check here or in a linked follow-up. Mark a finding resolved only after comparison with the preserved baseline. Do not replace the original images or claim that passing data tests proves visual consistency.

### Source locations

- Kubernetes: `ui/src/components/kubernetes/table/shared/TableMetrics.tsx`; `ui/src/components/shared/ResourceMetricPanels.tsx`; `MetricSourcePicker.tsx`; `sidebar/Pod/podMetricBound.ts`.
- UI: `src/metrics/MetricPanel.tsx`, `MetricDisplayPicker.tsx`, `MetricDetails.tsx`, `TimeRangeControl.tsx`, `Scalars.module.css`, `TimePlots.module.css`, `ComponentStories.module.css`; shared Button/Menu/Popover and DateTimePicker implementations.
- Host/runtime: `packages/omniviewdev-runtime/src/hooks/metric/useMetricObservation.ts`; `internal/builtinplugins/grafana/query.go:138–171`.
