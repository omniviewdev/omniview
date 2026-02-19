# Interactive States

Interactive elements use an overlay approach for state changes. This works consistently regardless of the element's base background color.

> **Related**: [Color](../foundations/03-color.md) | [Motion](../foundations/09-motion.md) | [Buttons](../components/buttons.md)

---

## State Tokens

```css
/* Hover: add a white overlay */
--ov-state-hover:    rgba(255, 255, 255, 0.04);

/* Active/pressed: slightly stronger overlay */
--ov-state-active:   rgba(255, 255, 255, 0.07);

/* Selected: accent-tinted background */
--ov-state-selected: var(--ov-accent-subtle);  /* rgba(accent, 0.10) */

/* Focus: accent ring */
--ov-state-focus:    0 0 0 2px var(--ov-accent);
```

### Why Overlays?

Using semi-transparent overlays means:
- States work on any base background without per-surface state colors
- Hover on a sidebar item, table row, or dropdown option all look correct
- Combining states (selected + hover) just layers the overlays naturally

---

## State Layering

States can combine. When they do, the visual treatments stack:

| Combination | Visual |
|-------------|--------|
| Default | Base background |
| Hover | Base + hover overlay |
| Active | Base + active overlay |
| Selected | Base + accent-subtle background |
| Selected + Hover | Base + accent-muted background (slightly stronger) |
| Focused | Base + accent outline ring |
| Focused + Selected | Base + accent-subtle + accent ring |
| Disabled | Base at 40% opacity |

---

## Focus Indicators

Every interactive element must have a visible focus indicator for keyboard navigation.

### Default Focus Style

```css
/* For most interactive elements */
.interactive:focus-visible {
  outline: 2px solid var(--ov-accent);
  outline-offset: 2px;
}
```

### Input Focus Style

```css
/* For inputs, the border changes color */
.input:focus {
  border-color: var(--ov-accent);
  outline: none;  /* Border replaces outline */
}
```

### Focus Within Dark Surfaces

The blue accent ring (`--ov-accent: #58A6FF`) provides sufficient contrast (>3:1) against all surface levels in the dark theme. No special adjustments needed.

### Focus Visibility

Use `:focus-visible` (not `:focus`) to show focus rings only for keyboard navigation, not mouse clicks:

```css
/* Correct: only shows for keyboard users */
button:focus-visible {
  outline: 2px solid var(--ov-accent);
  outline-offset: 2px;
}

/* Avoid: shows on every click */
button:focus {
  outline: 2px solid var(--ov-accent);
}
```

---

## Disabled State

```css
.disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

Don't change colors for disabled state — just reduce opacity. This maintains the element's semantic color information while clearly indicating it's non-interactive.

**Do**:
```css
.button:disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

**Don't**:
```css
/* Loses semantic meaning */
.button:disabled {
  background: gray;
  color: darkgray;
}
```

---

## Cursor States

| Element | Cursor |
|---------|--------|
| Buttons, links | `pointer` |
| Text inputs | `text` |
| Resize handles | `col-resize` or `row-resize` |
| Disabled elements | `not-allowed` (via CSS, not pointer-events) |
| Draggable items | `grab` → `grabbing` |

---

## Transition Timing

State changes should feel instant or near-instant:

| Transition | Duration | Token |
|-----------|----------|-------|
| Hover background | 0ms (instant) | `--ov-duration-instant` |
| Focus ring | 100ms | `--ov-duration-fast` |
| Active/pressed | 0ms (instant) | `--ov-duration-instant` |
| Selected background | 100ms | `--ov-duration-fast` |

> See [Motion](../foundations/09-motion.md) for the full timing system.
