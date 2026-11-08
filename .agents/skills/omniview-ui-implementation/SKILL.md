---
name: omniview-ui-implementation
description: Preserve Omniview UI/UX when building, fixing, migrating, or reviewing host/plugin views, forms, tables, charts, controls, CSS, themes, and component-library integrations. Use for every UI-affecting change, even an import-only library migration or data-layer cutover with visible consumers. Detect approved-composition drift, missing information, unsuitable density, native-control loopholes, and shared-library gaps before declaring completion.
---

# Implement UI without losing the approved experience

A library import proves provenance, not fidelity. A working query, green test, opened screenshot, or attractive story does not prove that the actual consumer preserves the approved UI.

## Before editing

1. Resolve the actual checkout, installed UI package versions, and affected consumers. Source stories from a newer checkout are not proof that an installed API exists.
2. Read component documentation, existing approved compositions, and the owning view. Extract a short **parity contract** covering appearance, interactions, information, density, and responsive behavior. Preserve the user's baseline images; never replace them to make a regression pass.
3. Classify work as preservation or explicitly approved redesign. A migration does not authorize a redesign. Record each intentional difference and its user approval. Do not infer permission from implementation convenience.
4. Check actual exported components and supported props/slots before inventing controls. Prefer existing components, then their composition, then an owner-reviewed shared capability. Keep domain decisions in the owning view; generic controls must not branch on plugin/resource IDs.

See [audit protocol](references/audit-protocol.md) for evidence and report requirements. Use [the metrics incident](references/metrics-regression-case.md) as a regression example, not a universal chart specification.

## During implementation

- Use base-ui, ai-ui, and editors where their capabilities fit. Keep shared control chrome, typography/density, icon sizing/gaps, theme tokens, card rhythm, and temporal interactions in the UI package. Do not patch missing shared behavior with local resets, CSS overrides, copied story CSS, or a parallel custom component.
- Inspect composition, not component names. A caller can select the wrong variant, omit metadata, introduce unsolicited actions, or recreate layout while importing only approved components. Story-only layout needed by multiple consumers signals a missing shared composition contract.
- No application-native interactive substitutes. An approved wrapper forwarding `type="datetime-local"` still exposes browser-native temporal interaction; it does not become the themed date/time picker. Reuse existing date/time primitives before proposing another calendar. Semantic main/section/form markup and legitimate domain renderers remain valid.
- Preserve information categories independently: resource identity, series dimensions, owner/provider/datasource presentation, Current/History provenance, freshness, and advanced diagnostics. Do not replace identity with dimensions, parse opaque identity strings, invent labels, fabricate samples, or invent expiry times. Query only supported shapes; native-only metrics may correctly have no History.
- Fit fields to expected content within responsive bounds. Short counts/ports should not occupy a whole screen. URLs and queries can fill a bounded column. Use existing grouping/grid primitives where appropriate; do not blanket-ban full width or structural HTML.
- Verify density in the real context. `size="sm"` can still be card-stat typography; a compact component may still be too tall for a dense table. Scalar capacity bars and temporal sample bars are different primitives. Unknown bounds remain unknown; never use arbitrary constants or observed maxima as capacity.
- Preserve async loading, empty, error, permission, refresh, focus, and keyboard behavior. Reuse the established notification/error-history path rather than creating another feedback system.

## When the library cannot satisfy a common need

Stop the substitution and record a **library gap** before accepting a workaround: owning package/component, requested capability, existing APIs inspected and why insufficient, affected consumers, reproduction/baseline evidence, and acceptance criteria. Fix the shared capability or obtain an explicit, narrowly scoped exception with owner, tracking reference, and removal condition. A ticket alone does not authorize a workaround. Do not expand scope beyond what the approved experience needs.

## Verify independently before completion

Exercise the actual consumer using the existing workspace and instance-verification workflow. Use real components and CSS, matched fixture/provider/resource/time range, theme, density, viewport, and pane width. Test relevant keyboard/pointer flows, overlays, error/empty states, long labels, units, and narrow layouts. Inspect actual pixels; DOM dumps and component stories cannot substitute for integrated screenshots or native rendering proof.

Request the independent `omniview-ui-auditor` agent with the current snapshot, parity contract, source changes, preserved baseline, and evidence. It must issue separate verdicts for **library compliance**, **composition parity**, **information/interaction preservation**, and **visual acceptance**. Any failed or unverified required verdict blocks completion. Finish reachable checks when runtime is unavailable, but do not claim a visual pass.

Use the installed audit gate's snapshot/submission tools when available; only the independent auditor submits approval. Any relevant source, CSS, dependency, policy, or agent change invalidates old approval, including shell/external/child writes. Never copy a prior receipt or self-attest. Without a loaded runtime gate, explicitly report that enforcement is advisory; never claim this skill auto-runs by itself.
