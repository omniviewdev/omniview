# Metrics migration regression case

Evidence: [before-fix audit V01–V11](https://github.com/omniviewdev/omniview/blob/1c44975c14403470fac48f2dcd48e5ded2cba9a2/docs/metrics-visual-consistency-audit.md), [issue discussion](https://github.com/omniviewdev/omniview/issues/410#issuecomment-6689744251). Baseline images remain pinned in that commit. This document records the incident, not current resolution status.

The library metrics source did not change between approved and integrated revisions. Consumers reused primitives while changing the composition. Functional checks passed and screenshots were opened, but no matched integrated acceptance comparison caught the drift.

| Finding | General failure | Required audit behavior |
| --- | --- | --- |
| V01 | Table bar removed in favor of value-only output | Check complete consumer composition; preserve compact encoding with honest bounds. |
| V02 | Small/compact API did not satisfy actual table density; vertical scalar capability missing | Inspect real typography/track density. Distinguish scalar capacity from temporal bars. File shared capability gap rather than asserting existing API is sufficient. |
| V03 | Caller opted into menu despite existing approved segmented control | Preserve documented variant unless redesign explicitly approved. |
| V04 | Added reorder arrow without approved header design | Audit unsolicited actions as well as missing components. |
| V05 | Series dimensions substituted for structured resource identity | Trace metadata categories across owner/runtime/UI; do not invent labels or parse opaque identity strings. |
| V06 | Friendly source attribution reduced to datasource kind | Preserve owner, connection, and datasource presentation independently. |
| V07 | Dual-shape metrics queried only range, losing real Current row | Preserve supported observations in shared batches; native-only remains Current-only. |
| V08 | Required value/chart/footer spacing existed only in story scaffolding | Promote shared composition contract; do not copy story CSS into consumer. |
| V09 | Menu/Popover trigger gaps and SVG sizing diverged from Button | Fix shared core styling and verify real composed triggers. |
| V10 | Source selector retained text but discarded plugin icons | Use generic plugin metadata and existing presentation slots; no plugin-specific branches in generic controls. |
| V11 | Library Input forwarded native datetime-local inside an undersized popup | Reuse themed date/time primitives; verify date AND time, accessible Start/End labels, popup size, keyboard and nested focus. |

Original table bars used arbitrary capacity constants. Removing dishonest semantics was justified, but did not authorize silently removing the visual. A supported shared table treatment or explicitly approved design disposition was required.

Regression evaluation should seed these failures and include valid near-misses: structural HTML, domain ANSI colors, unknown capacity, native-only Current observations, content-appropriate wide fields, and user-approved menu variants. Do not overfit every screen to this particular metric card.
