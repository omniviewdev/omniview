---
---

Add persistent Appearance choices for comfortable/compact density, independent UI text size, and system/normal/reduced motion. Default to comfortable density and system motion, restore profile-scoped preferences before first paint, and improve command palette search and result hierarchy. Editors and terminals retain their own font settings. See docs/visual-sizing-trial.md for mocks, browser evidence, and review workspace details.

Offer plain 80%, 90%, 100%, 110%, and 125% labels. Add View menu Zoom In, Zoom Out, and Reset Zoom actions with Cmd/Ctrl+Plus, Minus, and 0 accelerators. Route native actions only to the focused window and persist through the same Appearance setting. No bottom status-bar sizing controls. Code editor and terminal font settings remain separate.

Normalize inspector heading actions to the existing compact card-action tier and quiet ghost styling. Scale inspector labels, metadata, and Settings sidebar typography through shared tokens; make Settings navigation follow the selected density. Group log controls with consistent action geometry, readable icons, soft selected states, and narrow-width wrapping.

Add optional `DrawerComponentAction.splitMenu` with a named list of choices, rendered as a joined SplitButton beside the existing primary action. The dropdown always requires a menu selection, even with one choice. Kubernetes Debug now uses this control; its primary action still starts a single target directly or offers multiple targets. Resource row menus retain the separate Debug options entry.

Give the Settings sidebar caption a 56px minimum height with 16px vertical padding. Replace generic native option editors with Base UI Select, retaining opaque single- and multi-select values and ordinary validated draft commits. Align numeric/text fields and Select with the existing medium control tier (36px comfortable / 30px compact), without enlarging toolbar dropdowns. Joined inspector actions use ghost styling like neighboring toolbar actions, with a shared hover surface and subtle divider rather than a persistent box.
