# Accessibility

Accessibility is a core requirement, not an afterthought. The design system ensures that all users — including those with visual impairments, color vision deficiency, or motor limitations — can effectively use Omniview.

> **Related**: [Color](../foundations/03-color.md) | [Interactive States](./interactive-states.md) | [Motion](../foundations/09-motion.md)

---

## Contrast Requirements

| Element | Minimum Contrast | Standard | Notes |
|---------|-----------------|----------|-------|
| Body text (`--ov-fg-default`) | 7:1 against `--ov-bg-surface` | WCAG AAA | Primary content must be highly readable |
| Secondary text (`--ov-fg-muted`) | 4.5:1 against `--ov-bg-surface` | WCAG AA | Metadata and labels |
| Tertiary text (`--ov-fg-faint`) | 3:1 against `--ov-bg-surface` | WCAG AA Large | Timestamps, decorative — large text equivalent |
| Interactive borders | 3:1 against adjacent background | WCAG AA | Inputs, focus rings |
| Focus indicators | 3:1 against adjacent background | WCAG AA | Focus rings and outlines |
| Status colors | 3:1 against their background | WCAG AA | Semantic text colors |

### Verifying Contrast

When implementing new tokens or themes, verify contrast ratios:

- `--ov-fg-default` (`rgba(236,240,246,0.92)`) on `--ov-bg-surface` (`#151B23`): ~12:1
- `--ov-fg-muted` (`rgba(236,240,246,0.64)`) on `--ov-bg-surface` (`#151B23`): ~7:1
- `--ov-fg-faint` (`rgba(236,240,246,0.44)`) on `--ov-bg-surface` (`#151B23`): ~4.5:1
- `--ov-accent` (`#58A6FF`) on `--ov-bg-surface` (`#151B23`): ~7:1

---

## Color Independence

Never use color as the *only* indicator of meaning. Every semantic use of color must have a redundant non-color indicator.

| Semantic Signal | Color Indicator | Redundant Indicator |
|----------------|-----------------|---------------------|
| Resource status "Running" | Green text | Text label "Running" |
| Error state | Red text | Error icon + text label |
| Selected row | Accent-tinted background | Brightness change + optional left indicator |
| Required field | — | Asterisk (*) or "Required" label |
| Active tab | — | Bottom border indicator |
| Sort direction | — | Arrow icon |

### Do

```
✓ Running    ← Green text + "Running" label
✕ Error      ← Red icon + red text + "Error" label
● Selected   ← Blue tint + left border + brighter text
```

### Don't

```
●            ← Green dot alone (what does it mean?)
██████████   ← Red background with no text (what went wrong?)
```

---

## High Contrast Theme

The token architecture supports a high-contrast theme variant where all visual differences are amplified:

| Token Category | Standard | High Contrast |
|---------------|----------|---------------|
| Text opacity tiers | 92% / 64% / 44% / 28% | 100% / 80% / 60% / 40% |
| Border opacity | 8% / 5% / 14% | 16% / 10% / 24% |
| Surface step differences | ~2-3% luminance | ~5-6% luminance |
| Status color saturation | Desaturated | Higher saturation |
| Focus ring width | 2px | 3px |

> See [Built-in Themes](../theming/built-in-themes.md) for the complete high-contrast spec.

---

## Keyboard Navigation

### Requirements

- Every interactive element must be reachable via `Tab` key
- Focus order should match visual reading order (left-to-right, top-to-bottom)
- Every interactive element must have a visible focus indicator (`:focus-visible`)
- Complex components (tables, trees) support arrow key navigation
- `Escape` closes modals, panels, and dropdowns
- `Enter` / `Space` activates the focused element

### Focus Management

| Component | Keyboard Behavior |
|-----------|-------------------|
| Table | Arrow keys navigate rows, `Enter` selects, `Space` toggles checkbox |
| Sidebar tree | Arrow keys navigate items, `Enter` expands/selects, `Left/Right` collapse/expand |
| Tabs | Arrow keys switch tabs, `Enter` confirms |
| Command palette | `Cmd+K` opens, arrow keys navigate, `Enter` selects, `Escape` closes |
| Modal | Focus trapped inside, `Tab` cycles, `Escape` closes |

---

## Reduced Motion

Respect the user's operating system preference:

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
- Panel animations skip to final state
- Loading spinners may still animate (they convey essential information)
- Avoid replacing motion cues with nothing — use instant state changes instead

---

## Screen Reader Considerations

| Element | ARIA Requirement |
|---------|-----------------|
| Status text | `aria-label` describing the full status meaning |
| Icon-only buttons | `aria-label` describing the action |
| Table | Proper `<table>` semantics or `role="grid"` |
| Sidebar tree | `role="tree"` with `role="treeitem"` children |
| Tabs | `role="tablist"` / `role="tab"` / `role="tabpanel"` |
| Modals | `role="dialog"` with `aria-modal="true"` |
| Status dots | `aria-label` (not just color) |
| Loading states | `aria-live="polite"` for status updates |

---

## Text Sizing

- All font sizes use `rem` units (relative to root font size)
- This means users who increase their browser/system font size get proportionally larger text
- Layout should accommodate up to 200% text scaling without breaking
- Don't use `px` for font sizes in components

> See [Typography](../foundations/04-typography.md) for the rem-based type scale.
