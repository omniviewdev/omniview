# Inputs

Form controls for text entry, selection, and search. All inputs use the inset surface level to create a recessed appearance.

> **Related**: [Borders](../foundations/07-borders.md) | [Interactive States](../patterns/interactive-states.md) | [Typography](../foundations/04-typography.md)

---

## Text Input

| Property | Value | Token |
|----------|-------|-------|
| Height | 32px (default), 28px (compact) | — |
| Background | Inset surface | `--ov-bg-surface-inset` |
| Border | 1px | `--ov-border-default` |
| Border radius | 4px | `--ov-radius-sm` |
| Font | 14px, regular | `--ov-text-base` |
| Text color | Default | `--ov-fg-default` |
| Placeholder color | Disabled | `--ov-fg-disabled` |
| Padding | 0 8px | `--ov-space-2` |

### Input States

| State | Border | Background | Notes |
|-------|--------|------------|-------|
| Default | `--ov-border-default` | `--ov-bg-surface-inset` | — |
| Hover | `--ov-border-emphasis` | `--ov-bg-surface-inset` | Slightly stronger border |
| Focused | `--ov-accent` | `--ov-bg-surface-inset` | Accent border replaces default |
| Disabled | `--ov-border-muted` | `--ov-bg-surface-inset` at 60% | Reduced opacity |
| Error | `--ov-danger-default` | `--ov-bg-surface-inset` | Red border |

```css
.input {
  height: 32px;
  padding: 0 var(--ov-space-2);
  background: var(--ov-bg-surface-inset);
  border: 1px solid var(--ov-border-default);
  border-radius: var(--ov-radius-sm);
  font-size: var(--ov-text-base);
  color: var(--ov-fg-default);
}

.input:focus {
  border-color: var(--ov-accent);
  outline: none;
}

.input::placeholder {
  color: var(--ov-fg-disabled);
}
```

---

## Search Input

Search inputs include a search icon and optional clear button:

| Property | Value |
|----------|-------|
| Search icon | `--ov-icon-sm` (16px), `--ov-fg-faint` |
| Icon position | Left side, 8px from edge |
| Text padding-left | 28px (icon + gap) |
| Clear button | × icon, appears when input has value |

```css
.search-input {
  padding-left: 28px;  /* Room for search icon */
}

.search-icon {
  position: absolute;
  left: var(--ov-space-2);
  color: var(--ov-fg-faint);
  width: var(--ov-icon-sm);
  height: var(--ov-icon-sm);
}
```

---

## Select / Dropdown

| Property | Value | Token |
|----------|-------|-------|
| Trigger | Same styling as text input | — |
| Dropdown arrow | 12px chevron | `--ov-fg-faint` |
| Dropdown menu background | Overlay surface | `--ov-bg-surface-overlay` |
| Dropdown menu border | 1px | `--ov-border-default` |
| Dropdown menu shadow | Medium | `--ov-shadow-md` |
| Option height | 32px | — |
| Option padding | 0 12px | `--ov-space-3` |
| Option hover | Hover overlay | `rgba(255,255,255,0.04)` |
| Selected option | Accent subtle | `--ov-accent-subtle` |
| Selected option text | Default | `--ov-fg-default` |

---

## Textarea

| Property | Value |
|----------|-------|
| Same base styling as text input | — |
| Min height | 80px |
| Padding | 8px (`--ov-space-2`) |
| Resize | Vertical only |
| Font | Monospace when used for code/YAML |

---

## Form Layout

### Form Control

A form control wraps a label + input + helper text:

| Element | Style |
|---------|-------|
| Label | `--ov-text-sm`, `--ov-weight-medium`, `--ov-fg-muted` |
| Gap (label → input) | 4px (`--ov-space-1`) |
| Helper text | `--ov-text-xs`, `--ov-fg-faint` |
| Error text | `--ov-text-xs`, `--ov-danger-default` |
| Gap (input → helper) | 4px (`--ov-space-1`) |

### Form Spacing

- Gap between form controls: `--ov-space-4` (16px)
- No borders between form fields — use spacing only
- Group related fields with a section header

> See [Borders](../foundations/07-borders.md) for border vs. spacing rules.
