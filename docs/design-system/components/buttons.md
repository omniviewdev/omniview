# Buttons

Buttons trigger actions. Omniview uses four button variants to establish a clear hierarchy of importance.

> **Related**: [Color](../foundations/03-color.md) | [Interactive States](../patterns/interactive-states.md) | [Iconography](../foundations/08-iconography.md)

---

## Variants

| Variant | Background | Text | Border | Use For |
|---------|-----------|------|--------|---------|
| **Primary** | `--ov-accent` | `#FFFFFF` | None | Main action: Save, Apply, Connect |
| **Secondary** | `transparent` | `--ov-fg-default` | `--ov-border-default` | Alternative action: Cancel, Back |
| **Ghost** | `transparent` | `--ov-fg-muted` | None | Subtle action: toolbar items, inline actions |
| **Danger** | `--ov-danger-emphasis` | `#FFFFFF` | None | Destructive action: Delete, Remove |

### Visual Hierarchy

```
Primary  ██████████  ← Strongest visual weight
Secondary ▓▓▓▓▓▓▓▓▓  ← Clear but secondary
Ghost     ░░░░░░░░░  ← Minimal, blends in
Danger   ██████████  ← Draws attention through color
```

---

## Sizing

| Size | Height | Horizontal Padding | Font |
|------|--------|-------------------|------|
| Default | 32px | 12px (`--ov-space-3`) | `--ov-text-sm` (12px) |
| Compact | 28px | 8px (`--ov-space-2`) | `--ov-text-sm` (12px) |

- Border radius: `--ov-radius-md` (6px) for all sizes
- Icon-only buttons: Square aspect ratio (32x32 or 28x28)

---

## Button States

### Primary Button

| State | Background | Text |
|-------|-----------|------|
| Default | `--ov-accent` | `#FFFFFF` |
| Hover | Lightened accent | `#FFFFFF` |
| Active | Darkened accent | `#FFFFFF` |
| Focused | `--ov-accent` + 2px accent ring | `#FFFFFF` |
| Disabled | `--ov-accent` at 40% opacity | `#FFFFFF` at 40% opacity |

### Secondary Button

| State | Background | Text | Border |
|-------|-----------|------|--------|
| Default | `transparent` | `--ov-fg-default` | `--ov-border-default` |
| Hover | `rgba(255,255,255,0.04)` | `--ov-fg-default` | `--ov-border-emphasis` |
| Active | `rgba(255,255,255,0.07)` | `--ov-fg-default` | `--ov-border-emphasis` |
| Focused | `transparent` + 2px accent ring | `--ov-fg-default` | `--ov-border-default` |
| Disabled | `transparent` at 40% opacity | `--ov-fg-disabled` | `--ov-border-muted` |

### Ghost Button

| State | Background | Text |
|-------|-----------|------|
| Default | `transparent` | `--ov-fg-muted` |
| Hover | `rgba(255,255,255,0.04)` | `--ov-fg-default` |
| Active | `rgba(255,255,255,0.07)` | `--ov-fg-default` |
| Focused | `transparent` + 2px accent ring | `--ov-fg-muted` |
| Disabled | `transparent` | `--ov-fg-disabled` |

---

## Icon Buttons

Icon-only buttons follow the Ghost variant by default:

```css
.icon-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ov-radius-md);
  color: var(--ov-fg-muted);
}

.icon-button:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--ov-fg-default);
}
```

- Icon size: `--ov-icon-md` (20px) in default buttons, `--ov-icon-sm` (16px) in compact
- For icon + text buttons, use `gap: var(--ov-space-1)` (4px) between icon and label

---

## Button Groups

When buttons appear together:

- Gap: `--ov-space-2` (8px) between buttons
- Primary button should be on the right (action position)
- Danger buttons should be visually separated from other buttons

> See [Interactive States](../patterns/interactive-states.md) for the state overlay system.
