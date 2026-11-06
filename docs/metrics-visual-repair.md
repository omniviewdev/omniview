# Metrics visual repair

[Original V01–V11 audit](metrics-visual-consistency-audit.md) remains unchanged. Its seven screenshots are frozen at `1c44975c`.

| Approved panel | Actual IDE after repair |
| --- | --- |
| <img width="392" alt="Approved metric panel" src="https://raw.githubusercontent.com/omniviewdev/omniview/1c44975c14403470fac48f2dcd48e5ded2cba9a2/evidence/metrics-visual-audit-20261106/03-approved-panel.png" /> | <img width="392" alt="Actual repaired IDE panel" src="https://raw.githubusercontent.com/omniviewdev/omniview/8472485e8d27efc3001a9cdd08214fe416ffbe2d/evidence/metrics-visual-repair-20261106/after-metric-card.png" /> |

## Findings → fixes

| ID | Fix | Owning layer / component |
| --- | --- | --- |
| V01 | Restore inline utilization bars with real owner-supplied bounds. | Kubernetes tables → base-ui `MetricCell` |
| V02 | Fixed 24×4px tracks and 12px neutral values; horizontal/vertical stories; unknown bounds stay hatched. Tiny tracks omit full-size capacity ticks. | base-ui `MetricCell`, `CapacityBar`, `MetricValue size="xs"` |
| V03 | Reuse Area / Line / Bars / Value segmented controls, in approved order. | Kubernetes composition → `MetricDisplayPicker` |
| V04 | Remove unexplained reorder arrow. | Kubernetes composition |
| V05 | Show admitted cluster/namespace/Pod identity chips, separate from series dimensions. | Runtime readonly references + resource-owning views |
| V06 | Resolve friendly connection/datasource names through shared metadata caches; hide advanced attribution under Diagnostics. | Runtime presentation hooks + `MetricDetails` |
| V07 | Collect one current batch and one history batch; prefer current values and show both sample rows without invented expiry. | Kubernetes composition + existing host coordinator |
| V08 | Move value/plot rhythm into `MetricPanel.value`; preserve axis/footer gutter and single-line byte units. Expanded details no longer stretch neighboring cards. | base-ui panel/plot styling + owning grid layout |
| V09 | Apply Button gap and icon-size tokens to Menu/Popover triggers across sizes. | base-ui core primitives |
| V10 | Use actual provider icons and concise source names. Grafana now advertises its own icon metadata. Inherited selection shows the resolved source without changing saved routing. | Provider metadata + generic runtime/picker + `MetricDetails.sourceIcon` |
| V11 | Replace browser temporal inputs with shared calendar/time fields in a roomy popup. Validate complete drafts, preserve untouched precision, support keyboard entry, and keep empty optional fields neutral. | base-ui `TimeRangeControl`, `DateTimePicker`, `DateField` |
| V12 | Remove leftover consumer chip/button/popup chrome and density overrides. Reuse existing Chip, Button, and Popover APIs; keep only layout and data-marker CSS. | Kubernetes composition → existing base-ui primitives |

## See it

- [Actual IDE](http://127.0.0.1:34836/)
- [MetricPanel story](http://127.0.0.1:23680/?path=/story/metrics-components-metricpanel--details-expanded&globals=theme:void)
- [MetricCell stories](http://127.0.0.1:23680/?path=/story/metrics-components-metriccell--horizontal&globals=theme:void)
- [Date/time story](http://127.0.0.1:23680/?path=/story/metrics-components-timerangecontrol--open-calendar-and-time&globals=theme:void)
- [Narrow byte-axis story](http://127.0.0.1:23680/?path=/story/metrics-components-timeserieschart--bytes-narrow&globals=theme:void)

[Actual table](../evidence/metrics-visual-repair-20261106/after-pod-table.png) · [Native Nodes](../evidence/metrics-visual-repair-20261106/after-native-nodes.png) · [316-Pod native cluster](../evidence/metrics-visual-repair-20261106/after-native-pods.png) · [Date/time popup](../evidence/metrics-visual-repair-20261106/after-time-range.png) · [Calendar/time columns](../evidence/metrics-visual-repair-20261106/after-calendar-time.png)

[Shared-control metric picker](../evidence/metrics-visual-repair-20261106/after-metric-picker.png)

## Verification

| Surface | Passed tests |
| --- | ---: |
| base-ui | 1,833 |
| Runtime | 464 |
| Host frontend | 1,518 |
| Kubernetes frontend | 1,741 |

Native TypeScript source/test checks, production bundles, runtime shim checks, and Grafana Go provider tests passed. Base-ui lint/formatting is clean. Existing unrelated host/plugin warnings remain; existing host/plugin suites each skip three tests.

Actual refresh retained all three chart nodes across 20 sampled frames. An uncached six-hour → one-hour change retained them across 270 frames. Chart count stayed three; height stayed 162px; vertical position stayed fixed. Pod switching and reload retained display/range/layout/details choices. Native verification used four Ready Nodes and a 316-Pod cluster with 30 mounted rows / 60 metric cells. Green container indicators remain visible.

[Machine-readable checks and limits](../evidence/metrics-visual-repair-20261106/verification.json). Unknown source timestamps remain unknown. Native current values do not become synthetic history. Earlier upstream request-count evidence is not a new throughput claim for this visual repair.

## Prevent drift

- Add missing shared capability in base-ui before composing it in host/plugin views. Consumer layout is allowed; local chrome/theme substitutes are not.
- Scoped lint guards reject native control substitutes in repaired metric consumers and browser temporal inputs in shared metrics components. They are not a repository-wide legacy-UI migration.
- Keep per-component stories and actual IDE screenshots. Mocked orchestration checks do not establish visual fidelity.
- Inspect all CSS consumed by a changed view, including unchanged files. Shared primitives are not enough if consumer classes override them.
- Compare against the frozen reference before requesting review. Record component, owner, code revision, and exercised behavior—not only a passing build.

Code: base-ui `c9f94e6`, host `087a17fc`, Kubernetes `e13d8d6`. SDK remains `fe479313e4aa0be678e995d11e449af1f5baa26f`.

**Shipping hold:** user audit approval, then normal base-ui patch and compatible SDK/host-runtime publication before updating the Kubernetes minimum/lockfile. No merges, releases, or CI workflow changes.
