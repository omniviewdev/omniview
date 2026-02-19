# Motion & Transitions

Motion in Omniview is functional, not decorative. Animations help users understand spatial relationships (panel sliding in), state changes (tab switching), and element lifecycle (dropdown appearing). They should never delay the user or draw attention to themselves.

> **Related**: [Principles](./01-principles.md) | [Interactive States](../patterns/interactive-states.md) | [Accessibility](../patterns/accessibility.md)

---

## Timing Tokens

```css
--ov-duration-instant:  0ms;     /* Hover color changes */
--ov-duration-fast:     100ms;   /* Button state changes, focus rings */
--ov-duration-normal:   200ms;   /* Panel slides, tab switches */
--ov-duration-slow:     300ms;   /* Modal open/close, drawer slide */
```

### When to Use Each Duration

| Duration | Use Cases |
|----------|-----------|
| `instant` (0ms) | Hover background color, text color changes, cursor changes |
| `fast` (100ms) | Button active state, focus ring appearance, checkbox toggle |
| `normal` (200ms) | Panel slide in/out, tab content switch, dropdown appear |
| `slow` (300ms) | Modal open/close, drawer slide, overlay fade, command palette |

---

## Easing Functions

```css
--ov-ease-default:  cubic-bezier(0.2, 0, 0, 1);    /* General purpose */
--ov-ease-in:       cubic-bezier(0.4, 0, 1, 1);     /* Element exiting view */
--ov-ease-out:      cubic-bezier(0, 0, 0.2, 1);     /* Element entering view */
```

| Easing | Use Cases |
|--------|-----------|
| `ease-default` | Most transitions (background, opacity, border-color) |
| `ease-in` | Element leaving: panel closing, modal dismissing, dropdown hiding |
| `ease-out` | Element appearing: panel opening, modal appearing, dropdown showing |

### Usage Pattern

```css
/* Panel slide-in */
.panel-enter {
  transform: translateX(100%);
  transition: transform var(--ov-duration-normal) var(--ov-ease-out);
}
.panel-enter-active {
  transform: translateX(0);
}

/* Dropdown appear */
.dropdown-enter {
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--ov-duration-normal) var(--ov-ease-out),
              transform var(--ov-duration-normal) var(--ov-ease-out);
}
.dropdown-enter-active {
  opacity: 1;
  transform: translateY(0);
}
```

---

## Animation Rules

### Always Animate

- Panel open/close (sidebar, detail panel, bottom drawer)
- Drawer resize (drag handle)
- Tab switches (content crossfade or slide)
- Dropdown appear/disappear
- Modal/dialog open/close
- Tooltip appear/disappear
- Command palette open/close

### Never Animate

- Table data updates (new data should appear instantly)
- Status color changes (a pod going from Running to Error should switch immediately)
- Scroll position changes
- Content loading (show loading state instantly, don't fade in)
- Real-time counter updates

### Prefer These Properties

For best performance, animate only compositor-friendly properties:

| Prefer | Avoid |
|--------|-------|
| `opacity` | `display` |
| `transform` (translate, scale) | `width`, `height` |
| `filter` | `margin`, `padding` |
| `clip-path` | `top`, `left`, `right`, `bottom` |

---

## Reduced Motion

Respect the user's operating system preference for reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0ms !important;
    transition-duration: 0ms !important;
  }
}
```

When reduced motion is active:
- All transitions become instant
- Panel slides become instant show/hide
- Dropdowns appear/disappear without animation
- Loading spinners may still animate (they convey information, not decoration)

> See [Accessibility](../patterns/accessibility.md) for more on motion sensitivity.
