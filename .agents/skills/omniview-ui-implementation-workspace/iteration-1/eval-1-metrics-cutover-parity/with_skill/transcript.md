# Prompt

Review this Omniview metrics cutover for completion. The approved reference used an inset segmented chart switcher, cluster/namespace/pod chips, Current and History rows, collapsed Diagnostics, compact table bars, and generous chart/footer spacing. New implementation imports base-ui throughout, opts into a chart dropdown, adds a reorder arrow, passes result.dimensions as labels, queries only range for dual-shape metrics, uses MetricValue size=sm in tables, and rebuilds the reference story with Stack. Tests mock all visual primitives and pass; screenshots were captured and opened. May we mark it complete? Give your audit verdict, causes, owning packages, and required checks. Do not edit files.

# Response

**No—this cutover is not ready to mark complete.** It contains explicit composition and information regressions, and the supplied test/screenshot evidence does not establish visual acceptance. Treat this as preservation work; no redesign approval was supplied.

This is a review of the supplied facts only. I have not inspected source, executed checks, or independently viewed captures. No files were edited.

## Audit verdicts

| Audit area | Verdict | Basis |
|---|---|---|
| **Library compliance** | **Unverified** | `base-ui` imports establish provenance, not correct supported composition. Exact installed APIs, wrappers, tokens, overrides, and surrounding CSS still need review. |
| **Composition parity** | **Failed** | The dropdown replaces the approved inset segmented switcher, and the reorder arrow is an unsolicited action. Rebuilding the reference story with `Stack` does not demonstrate preservation in the actual consumer. |
| **Information / interaction preservation** | **Failed** | Passing dimensions as labels does not preserve structured cluster/namespace/pod identity. Range-only queries omit the supported Current observation for dual-shape metrics. Diagnostics and other affected interaction states remain unverified. |
| **Visual acceptance** | **Unverified** | Capturing and opening screenshots is insufficient without an independent, matched baseline/current comparison. Mocked visual primitives cannot establish actual rendering, table density, spacing, or control behavior. |

**Completion is blocked** by the failed verdicts and required unverified checks.

## Findings, causes, and owners

Exact package names and source locations must be established from the checkout; the ownership below identifies the responsible layer.

| Finding | Cause and classification | Owning layer | Required disposition |
|---|---|---|---|
| Dropdown replaces inset segmented switcher | **UX regression / composition misuse:** migration treated as permission to change the approved variant. | Metrics owning view/consumer | Restore the approved inset segmented composition, or obtain explicit approval for this specific redesign. |
| Reorder arrow added | **UX regression:** unsolicited header action. | Metrics owning view/consumer | Remove it unless its addition and behavior receive explicit approval. |
| `result.dimensions` used as labels | **Information regression:** series dimensions substituted for resource identity. | Metrics consumer and metadata/data-contract owner | Preserve structured cluster/namespace/pod identity separately from dimensions. Do not parse opaque identity strings or invent labels. Trace where identity is lost. |
| Range-only query for dual-shape metrics | **Information regression:** incomplete supported observation retrieval. | Metrics query/data integration owner; shared batching owner if applicable | Retrieve supported Current and History observations and preserve their provenance. Do not manufacture History for native-only Current metrics. |
| `MetricValue size="sm"` in tables | **Density and encoding unverified; potential misuse or library gap:** a small size prop does not prove compact table typography or preserve bars. | Table consumer first; owning UI package if its supported API is insufficient | Verify that compact bars remain, with appropriate density and honest bounds. If absent or unsuitable, restore a supported table treatment or resolve a shared capability gap—not a local CSS substitute. Unknown capacity must remain unknown. |
| Reference reconstructed with `Stack` | **Composition contract risk:** layout primitives alone do not establish approved spacing or shared composition. | Consumer for supported composition use; owning UI package for missing reusable composition | Verify actual chart/footer geometry. If the spacing contract exists only in story scaffolding, promote the needed shared capability rather than copying story CSS or applying local overrides. |
| Collapsed Diagnostics | **Preservation unverified:** no supplied evidence establishes its retained content or default state. | Metrics owning view/consumer | Confirm Diagnostics remains available, collapsed by default, with preserved content and accessible expand/collapse behavior. |

The cross-cutting failure is **equating library adoption and functional success with consumer fidelity**. Mocking every visual primitive removes evidence about the very geometry, density, and interaction contracts this migration must preserve.

## Required checks before completion

1. **Establish the review inputs**
   - Identify the checkout, changed files, exact installed UI versions, and every affected consumer.
   - Preserve the original approved captures; do not rebaseline away regressions.
   - Record the parity contract: inset segmented switcher, identity chips, supported Current/History rows, collapsed Diagnostics, compact table bars, and generous chart/footer spacing.

2. **Complete source and API review**
   - Check installed component documentation and supported props/slots.
   - Trace identity and dimensions independently through the data and view layers.
   - Verify dual-shape observation handling, zero versus unknown values, and provenance.
   - Inspect surrounding callers and CSS, not just imports or the reconstructed story.

3. **Verify the actual integrated consumer**
   - Use real components and CSS with matched fixture, provider, resource, time range, theme, density, viewport, and pane width.
   - Compare actual baseline/current pixels for switcher geometry, chips, rows, Diagnostics, table bars and typography, and chart/footer gutters.
   - Exercise switcher selection, Diagnostics, focus and keyboard behavior, and any retained overlays.
   - Check loading, empty, error, permission, refresh, long-label, unit, and narrow-layout states. Use the established notification/error-history path.

4. **Resolve shared gaps without unauthorized substitutes**
   - If table density, bars, or chart/footer composition cannot be expressed through installed supported APIs, record a library gap: owning package/component, APIs evaluated, affected consumers, baseline/reproduction evidence, and acceptance criteria.
   - Fix the shared capability or obtain a narrowly scoped exception with owner, tracking reference, and removal condition. A ticket alone does not authorize a workaround.

5. **Obtain independent acceptance**
   - Request `omniview-ui-auditor` review against the current snapshot, changes, parity contract, preserved baseline, and integrated evidence.
   - Require separate passing verdicts for all four audit areas. Use the installed gate’s snapshot/submission workflow when available; only the independent auditor submits approval.
   - Relevant changes invalidate old approval. If no runtime gate is loaded, enforcement is advisory—not automatic—and missing runtime evidence remains unverified.

**Disposition: return for fixes and integrated independent verification, not completion.**