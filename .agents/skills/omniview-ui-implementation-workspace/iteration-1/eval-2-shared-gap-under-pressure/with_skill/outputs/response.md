I would **not apply those substitutions or declare the migration complete**. This is preservation work unless the user explicitly approves a redesign. The requested shortcuts leave shared styling, temporal interaction, and table-composition issues unresolved.

### Decisions and ownership

| Request | Decision | Owning package/view |
|---|---|---|
| Add local `gap: 6px` around `Menu.Trigger` and `Popover.Trigger` | Do not add application CSS overrides. Fix the shared trigger styling so icon sizing and spacing align with the approved Button treatment. Do not assume `6px` is the correct shared value without the installed API, tokens, and baseline. | **base-ui** owns shared trigger chrome. The settings view owns choosing and composing the supported controls. |
| Use `Input.Control type="datetime-local"` in a 240px popup | Reject this substitution. A base-ui wrapper still forwards browser-native temporal interaction; its provenance does not make it the themed picker. Use the installed, supported **DateTimePicker/date-time primitives**. Popup sizing must accommodate the approved interaction and responsive bounds, rather than defaulting to 240px. | **base-ui** owns themed temporal interaction and reusable popup behavior. The settings view owns field meaning, values, validation, and labels. |
| Replace the CPU bar with bare numbers | Remove the false one-core capacity assumption, but do not silently remove the approved visual encoding. Inspect supported compact table treatments. Preserve the visual using honest semantics, or obtain explicit approval for a value-only redesign. Unknown capacity must remain unknown; do not substitute another arbitrary bound or observed maximum. | The **owning table view/data layer** determines valid units and capacity semantics. The **shared UI package owning the table metric primitive** owns reusable compact rendering. |

A temporal sample bar is not a replacement for a scalar capacity bar. Likewise, a component advertised as “small” is not sufficient evidence that it fits the actual table density.

### Record issues before accepting any workaround

First resolve the actual checkout, installed package versions, supported exports/props, affected consumers, and approved baseline. Then record:

- **Trigger styling defect:** base-ui `Menu.Trigger` and `Popover.Trigger`; approved icon/text spacing and sizing; affected compositions; reproduction and baseline evidence; required shared fix and consumer verification.
- **Temporal capability gap, only if the installed picker is insufficient:** APIs inspected, the specific missing behavior, affected consumers, and acceptance criteria for date **and** time entry, accessible labels, popup sizing, keyboard navigation, and nested focus. Do not invent a gap merely to justify bypassing an existing picker.
- **Compact metric capability gap, if confirmed:** owning shared package/component, existing APIs evaluated and why they fail, required table density and honest unknown-bound behavior, affected consumers, and approved visual reference.

Each record needs an owner, requested capability or fix, evidence, acceptance criteria, and a tracking reference when available. Persist an actionable local record if external tracking is unavailable; do not publish external issues without authorization. **A ticket does not authorize a workaround.** Any exception requires explicit approval, narrow scope, an owner, tracking reference, and a removal condition.

### Acceptance

Before calling this finished:

1. Establish a parity contract covering appearance, information, density, interactions, and responsive behavior. Preserve original baseline images and record any explicitly approved deviations.
2. Verify the real settings form and CPU table with actual components and CSS under matched data, theme, density, viewport, and pane width.
3. Check trigger spacing and icons; picker date/time entry, labels, focus, keyboard and popup behavior; and table units, zero versus unknown values, long labels, and compact rendering. Exercise applicable loading, empty, error, permission, refresh, and narrow-layout states.
4. Obtain an independent `omniview-ui-auditor` review bound to the current snapshot, with separate verdicts for **library compliance**, **composition parity**, **information/interaction preservation**, and **visual acceptance**. Any failed or unverified required verdict blocks completion.

No source inspection, runtime checks, captures, or audit submission have been performed here. Completion is therefore **not established**. If runtime verification is unavailable, finish reachable source checks and explicitly report visual acceptance as unverified. Without a loaded runtime gate, enforcement is advisory—not automatic.