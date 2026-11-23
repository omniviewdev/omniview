# Unified action menus: design and acceptance plan

## Starting point

The kit already ships a table-specific `RowMenu`. Its WebKit and Chromium probe established the important baseline: no closed popup, no row render on open, and no listener growth with trigger count. `TooltipHost` independently delegates tooltip events at document scope. It does not own action menus, focus, or keyboard navigation. Preserve both optimizations; do not repurpose a tooltip as an interactive surface.

## Design decisions

- **One interaction model, two invocations.** A dropdown anchors to a control; a context menu anchors to a pointer or the keyboard-invoked target. Both use the same item model, placement constraints, theme roles, selection and dismissal rules. A submenu is another level, not another controller per item.
- **Keep domain actions at the caller.** The owner provides labels, current command availability, checked state and handlers. The kit never switches on resource kind, plugin ID or action name. Shortcut text documents an existing binding; it does not install one.
- **Pay for the active menu.** A row carries a stable key, not a popup, observer, state hook or command tree. Resolve items on activation. Closing or recycling a trigger must never dispatch an action to the row that replaced it. Register owners per surface, not per row.
- **Use one visual grammar.** The four references differ in content, not widget type: a compact More menu, grouped launch targets with metadata and submenus, a text-only tab context menu, and row actions with icon, emphasis, disabled and destructive states. Use kit surface, border, type, spacing, focus and semantic color tokens. No screenshot-specific colors or resource-specific variants.
- **Keep selection widgets separate.** A native `Select` edits a field. A command palette searches a collection. Neither becomes an action menu. A checkbox or radio command within an action menu still exposes its checked state.

## Acceptance criteria

1. Exercise menus from actual controls: click, secondary click, keyboard invocation, arrow navigation, typeahead, submenu traversal, activation, Escape and outside dismissal. Check focus on entry and return, including disconnected anchors and commands opening another surface.
2. Render live examples of each reference using the public kit API. Capture the opened menus from the browser, not from a static recreation. Include screenshots in the PR.
3. Measure a virtualized 20,000-record fixture. Record actual mounted triggers, idle/open/closed popup counts, listener behavior, resolver work, and timing distributions. Distinguish input-to-paint from synchronous dispatch cost. Do not infer timing from DOM counts.
4. Preserve the existing row-menu browser regression coverage, including WebKit top-layer behavior. Regenerate the public API reports and verify affected kit and host consumers.
5. Obtain independent Astra 6.2 review of implementation and evidence before reporting completion.
