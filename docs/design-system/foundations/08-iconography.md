# Iconography

Icons are supporting visual elements that aid scannability. They should be consistent in style, properly sized to the grid, and never brighter than the text they accompany.

> **Related**: [Typography](./04-typography.md) | [Spacing](./05-spacing.md) | [Color](./03-color.md)

---

## Icon Sizing

Icons align to the 4px grid:

| Token | Size | Usage |
|-------|------|-------|
| `--ov-icon-xs` | 12px | Inline status dots, small indicators, tree expand chevrons |
| `--ov-icon-sm` | 16px | Table row icons, sidebar tree icons, inline icons |
| `--ov-icon-md` | 20px | Button icons, tab icons, toolbar actions |
| `--ov-icon-lg` | 24px | Panel header icons, empty state illustrations |
| `--ov-icon-xl` | 32px | Navigation rail icons, feature icons |

### Sizing Rules

- Always use sizes from the token scale — don't set arbitrary icon sizes
- Match icon size to the context: 16px in tables, 20px in buttons, 32px in the nav rail
- When an icon sits next to text, it should be the same optical height as the text's x-height or cap height

---

## Icon Color

| Context | Color Token | Notes |
|---------|-------------|-------|
| Default (decorative) | `--ov-fg-muted` | Icons should be quieter than text |
| Interactive (buttons) | `--ov-fg-default` | Brighter for clickable elements |
| Interactive (hover) | `--ov-fg-default` | Via opacity increase or direct color |
| Disabled | `--ov-fg-disabled` | Same as disabled text |
| Status indicator | Semantic color | `--ov-success-default`, etc. |
| Active/selected | `--ov-accent` or `--ov-fg-default` | Context-dependent |

### Key Rule

Icons should **never** be brighter than the text they accompany. A table row with a 16px icon next to a resource name should have the icon in `--ov-fg-muted` and the name in `--ov-fg-default`.

**Do**:
```css
.row-icon { color: var(--ov-fg-muted); }
.row-name { color: var(--ov-fg-default); }
```

**Don't**:
```css
.row-icon { color: var(--ov-fg-default); }  /* Icon competing with text */
.row-name { color: var(--ov-fg-default); }
```

---

## Icon Style

### Recommended Library

Use **Lucide** (`lucide-react` or `react-icons/lu`) as the primary icon set. Lucide provides:

- Consistent 24px grid with 1.5px stroke weight
- Outlined/stroke style (lighter visual weight, suitable for UI chrome)
- Comprehensive icon set covering IDE needs
- Good Kubernetes/infrastructure-adjacent metaphors

### Style Guidelines

| Guideline | Details |
|-----------|---------|
| **Prefer outlined icons** | Stroke/outline style for UI chrome (lighter weight) |
| **Use filled for active states** | Filled variant can indicate selected/active (e.g., filled star vs outline star) |
| **Don't mix families** | All icons in a view should come from the same family |
| **Consistent stroke weight** | If using Lucide, keep the default 1.5px stroke |
| **No decorative color** | Icons are monochrome unless indicating semantic status |

### Icon + Text Alignment

When pairing an icon with text on the same line:

```css
.icon-text-pair {
  display: flex;
  align-items: center;
  gap: var(--ov-space-1);  /* 4px gap between icon and text */
}

.icon-text-pair svg {
  flex-shrink: 0;          /* Prevent icon from shrinking */
  width: var(--ov-icon-sm); /* 16px */
  height: var(--ov-icon-sm);
}
```
