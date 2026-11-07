# Prompt

Review this Omniview metrics cutover for completion. The approved reference used an inset segmented chart switcher, cluster/namespace/pod chips, Current and History rows, collapsed Diagnostics, compact table bars, and generous chart/footer spacing. New implementation imports base-ui throughout, opts into a chart dropdown, adds a reorder arrow, passes result.dimensions as labels, queries only range for dual-shape metrics, uses MetricValue size=sm in tables, and rebuilds the reference story with Stack. Tests mock all visual primitives and pass; screenshots were captured and opened. May we mark it complete? Give your audit verdict, causes, owning packages, and required checks. Do not edit files.

# Response

## Verdict: **Do not mark complete**

The supplied evidence shows implementation progress, not completion against the approved reference. There is a confirmed interaction change, a data-coverage concern, and several visual requirements that mocked tests cannot establish. Capturing and opening screenshots does not, by itself, demonstrate reference parity.

### Findings and ownership

Exact repository package names were not supplied; ownership below identifies the responsible package or layer without inventing paths.

| Area | Audit finding / cause | Owning package or layer | Required closure |
|---|---|---|---|
| Chart switcher | The approved **inset segmented switcher** became a **dropdown**. This is a reference deviation, not merely an implementation detail. | Metrics chart composition; shared chart controls if they provide the dropdown | Restore the approved control or obtain explicit design approval for the change. Verify inset treatment, selection states, keyboard operation, and chart switching. |
| Reorder arrow | The implementation adds a control not identified in the approved reference. Its purpose and approval are unestablished. | Metrics view/control composition | Remove it or document approval and intended behavior. If retained, verify its action, accessible name, focus behavior, and layout impact. |
| Current and History data | Querying **only range** for dual-shape metrics does not establish that both approved rows receive the correct data. | Metrics query/data adapter and Current/History rendering | Establish the data contract for each shape. Verify that Current and History both render correctly, including their timestamps and loading, empty, and error states. If range data intentionally supplies Current, verify and document that derivation rather than assuming equivalence. |
| Series labels | Passing `result.dimensions` directly as labels assumes those dimensions satisfy the chart’s label contract. The supplied facts do not establish that. | Metrics-to-chart adapter; chart label API | Verify expected types, readable display names, ordering, and series-to-label alignment with representative results. Add contract tests using real-shaped data. |
| Table bars | `MetricValue size="sm"` does not by itself prove the approved **compact table bars** are preserved. | Package exporting `MetricValue`; metrics table composition | Render the real component in table cells and verify bar presence, dimensions, alignment, row density, and overflow against the reference. |
| Reference layout | Rebuilding the reference story with `Stack` can change layout; using `Stack` is not itself a defect. Parity remains unestablished for chips, Current/History rows, collapsed Diagnostics, and generous chart/footer spacing. | Reference story; layout primitives; metrics view composition | Compare the rebuilt story and production view with the approved reference. Explicitly check cluster/namespace/pod chips, row structure, initial Diagnostics collapse, and chart/footer spacing. |
| Primitive integration | Importing `base-ui` throughout is not inherently wrong on the supplied facts, but broad replacement expands the integration surface. | `base-ui` and consuming metrics packages | Verify real primitive composition, styling, states, and accessibility. Do not treat mocked primitive tests as evidence that those integrations work. |

### Evidence required before completion

1. **Resolve reference deviations:** restore the segmented switcher and address the reorder arrow, or record explicit approval for both changes.
2. **Prove data correctness:** cover both metric shapes, Current/History semantics, and dimension-to-label mapping.
3. **Add unmocked integration coverage:** exercise actual visual primitives and their composition. Keep mocked tests for isolated logic, but do not use their passing status as visual or integration sign-off.
4. **Perform an explicit reference comparison:** document results for every approved feature, including compact bars and spacing. The supplied screenshot activity has not established those results.
5. **Check interactions and accessibility:** chart selection, any retained reorder action, Diagnostics expansion/collapse, keyboard navigation, focus, and accessible control names.
6. **Verify the production view as well as the story:** a rebuilt story is useful evidence only if it faithfully represents the implementation being shipped.

**Completion gate:** approved reference fidelity—or explicitly approved deviations—plus demonstrated data correctness and real-component integration. The current evidence does not meet that gate.