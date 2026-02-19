# Design Principles

These are the non-negotiable values that guide every design decision in Omniview. When in doubt, refer back to these principles to resolve conflicts.

> **Related**: [Token Architecture](./02-token-architecture.md) | [Information Hierarchy](../patterns/information-hierarchy.md) | [Accessibility](../patterns/accessibility.md)

---

## 1. Content Over Chrome

The interface should disappear. Users come to Omniview to understand their infrastructure, not to admire the UI. Every pixel of chrome — borders, backgrounds, badges, icons — must justify its existence by helping the user parse information faster.

- Reduce visual noise ruthlessly
- Favor negative space over dividers
- Let data breathe; don't pack every row with badges

**Do**: Use spacing and subtle background shifts to separate zones.
**Don't**: Add decorative borders, colored backgrounds, or badge chips where text alone suffices.

---

## 2. Hierarchy Through Restraint

When everything is bold, nothing is. Establish clear visual hierarchy using a *minimal* set of tools: text brightness, font weight, and spacing. Avoid relying on color, size, or decoration to create hierarchy unless the simpler tools are insufficient.

Priority order for creating hierarchy:

1. **Brightness/opacity** — primary, secondary, tertiary text (`92%`, `64%`, `44%`)
2. **Weight** — semibold vs regular at the same size
3. **Size** — only when brightness + weight aren't enough
4. **Color** — reserved for semantic meaning: status, links, errors

**Do**: Differentiate a table header from body text by using semibold weight at the same font size.
**Don't**: Make the header larger, colored, and bold all at once.

> See [Information Hierarchy](../patterns/information-hierarchy.md) for the three-tier content rule.

---

## 3. Quiet Until Relevant

Status indicators, badges, and accent colors should be *quiet by default* and only demand attention when something is actionable or abnormal. A healthy system should look calm. An unhealthy system should make the problem obvious without the user searching for it.

- "Running" is the normal state and should be the **least** visually prominent status
- "Error" / "CrashLoopBackOff" should be the **most** prominent
- Warnings sit between: visible but not alarming

**Do**: Show "Running" as calm, desaturated green text. Show "CrashLoopBackOff" as red text with an icon.
**Don't**: Make every status a brightly colored badge chip.

> See [Status System](../patterns/status-system.md) for the full visual weight progression.

---

## 4. Scannable, Not Readable

IDE users scan; they don't read left-to-right. Design for F-pattern and column scanning:

- Left-align primary identifiers (names)
- Group related metadata spatially
- Use consistent column widths so eyes can scan vertically
- Avoid long text in table cells; truncate and tooltip

**Do**: Keep the Name column wide and left-aligned. Right-align numeric data (Age).
**Don't**: Allow long status strings like `PodReadyToStartContainers` to appear untruncated in a narrow column.

---

## 5. Native Feel

The app should feel like it belongs on the operating system, not like a website in a frame.

- Use system font stack for UI chrome
- Respect platform conventions (traffic lights, keyboard shortcuts)
- Panels should feel like spatial zones, not cards on a webpage
- Avoid drop shadows on panels; use subtle background shifts instead

**Do**: Use `-apple-system, BlinkMacSystemFont, "Segoe UI"` for UI text.
**Don't**: Use a custom web font that takes time to load and looks foreign on the OS.

> See [Typography](./04-typography.md) for font stack details. See [Elevation](./06-elevation.md) for the surface hierarchy.

---

## 6. Themeable by Design

Every visual decision must flow through design tokens. No hardcoded colors, sizes, or spacing in components. This enables:

- User-customizable themes
- Accessible high-contrast themes
- Color vision deficiency accommodations
- Community-created themes

**Do**: Reference `var(--ov-fg-default)` in component styles.
**Don't**: Write `color: #CBD5E1` directly in a component.

> See [Token Architecture](./02-token-architecture.md) for the three-tier token system. See [Theme Customization](../theming/customization.md) for the user-facing API.
