I would not mark the migration complete on those changes alone. I would separate application layout, shared-component defects, and missing capabilities, and record the gaps now.

### 1. Trigger spacing: fix the owner, not just the symptom

Menu.Trigger and Popover.Trigger crowd icons against text, while Button looks right. That is a shared-component consistency issue to raise with **base-ui**.

- Record a base-ui request covering both triggers and the expected icon/text spacing.
- If delivery cannot wait, use a narrowly scoped Omniview wrapper with `gap: 6px` as a **temporary workaround**, linked to that request.
- Do not treat Button looking right as proof that its implementation can be copied unchanged.

**Acceptance:** verify the spacing in the actual settings form for both trigger types, including icon-plus-text content, focus, and disabled states. The workaround must not change trigger behavior or introduce spacing in unrelated controls.

### 2. Date/time: distinguish a supplied input from a picker replacement

Your statement establishes that `Input.Control` supports `type="datetime-local"` in base-ui. It does **not** establish that it replaces every capability required from `DateTimePicker`.

Omniview owns the decision to place that control in a **240px popup**. Base-ui owns any missing reusable input or picker capabilities.

Before accepting the substitution:
- Define the required date/time behavior: value representation, validation, empty values, keyboard interaction, and any timezone expectations.
- Record any required capability the input does not provide. If nothing is missing, document why the simpler control is sufficient rather than filing a speculative library request.

**Acceptance:** verify that the control fits and remains usable in the 240px popup, that opening, dismissal, and focus behavior work, and that editing, saving, and reopening preserve the intended value. Native-control support alone is not acceptance of the full interaction.

### 3. CPU usage: remove the invalid assumption without hiding the regression

The hardcoded one-core bound is a known problem. Replacing the bar with bare numbers removes that bound, but also removes the visualization; it is not automatically an equivalent migration.

- Establish the CPU metric’s units and intended interpretation before choosing a scale.
- If the bar remains required, use a justified bound rather than another guessed constant.
- If numbers-only is an intentional product change, explicitly approve that change and retain clear units and meaning.
- Record any missing shared visualization capability now, if that is what blocks the correct implementation.

**Acceptance:** verify representative values, including values beyond the old one-core bound, against the agreed metric semantics. A numbers-only fallback can be accepted as a scoped change, but not silently counted as full visualization parity.

### Completion decision

**Log library requests and capability gaps now, not later.** Each record should identify the owning package, required behavior, current workaround or fallback, and acceptance criteria.

Omniview owns form composition, popup sizing, and application data presentation. Base-ui owns defects or missing capabilities in its reusable controls. The migration is complete only when the agreed behavior is verified and any deviations are explicitly accepted—not merely because the old components have been removed.