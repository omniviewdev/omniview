# Badges / Chips

Badges are compact labels for categorical classification. They should be small, quiet, and used sparingly. Badges are **not** for status display — use colored text for that.

> **Related**: [Status System](../patterns/status-system.md) | [Typography](../foundations/04-typography.md) | [Color](../foundations/03-color.md)

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Height | 20px | — |
| Font size | 11px | `--ov-text-xs` |
| Font weight | Medium (500) | `--ov-weight-medium` |
| Horizontal padding | 6px | — |
| Border radius | 4px | `--ov-radius-sm` |
| Default background | Raised surface | `--ov-bg-surface-raised` |
| Default text color | Muted | `--ov-fg-muted` |

---

## When to Use Badges

**Do use badges for**:
- Resource type labels (e.g., "DaemonSet", "StatefulSet")
- Category tags (e.g., "System", "User")
- Version indicators (e.g., "v1", "v1beta1")
- Count indicators (e.g., "3 conditions", "12 labels")

**Don't use badges for**:
- Resource status (Running, Error, Pending) — use colored text instead
- Every piece of metadata — badges create visual noise when overused
- Single-word values that could just be text

---

## Variants

### Default Badge

For neutral categorization:

```css
.badge {
  height: 20px;
  padding: 0 6px;
  font-size: var(--ov-text-xs);
  font-weight: var(--ov-weight-medium);
  border-radius: var(--ov-radius-sm);
  background: var(--ov-bg-surface-raised);
  color: var(--ov-fg-muted);
}
```

### Semantic Badge

For badges that carry semantic meaning (use sparingly):

| Role | Background | Text |
|------|-----------|------|
| Info | `--ov-info-muted` | `--ov-info-default` |
| Success | `--ov-success-muted` | `--ov-success-default` |
| Warning | `--ov-warning-muted` | `--ov-warning-default` |
| Danger | `--ov-danger-muted` | `--ov-danger-default` |

**Important**: Semantic badges use **muted** backgrounds with semantic text color. Never use high-contrast colored backgrounds for routine information.

**Do**:
```css
/* Dev Mode badge — informational, not alarming */
background: var(--ov-info-muted);
color: var(--ov-info-default);
```

**Don't**:
```css
/* Too loud for routine status */
background: var(--ov-info-emphasis);
color: #FFFFFF;
```

---

## Badge with Count

For indicating quantity (like "3 conditions"):

```css
.badge-count {
  /* Same as default badge */
  background: var(--ov-bg-surface-raised);
  color: var(--ov-fg-muted);
}
```

Show the count as text inside the badge. Clicking expands to show the full list.

---

## Badge Spacing

- Gap between adjacent badges: `--ov-space-1` (4px)
- Gap between badge and surrounding text: `--ov-space-2` (8px)
- Max badges in a row before overflow: 3-4 (show "+N more" for overflow)

---

## Table Cell Badges

In table cells, badges should be especially restrained:

- Maximum 1-2 badges per cell
- Prefer plain text over badges when possible
- If a cell would need 3+ badges, use a count badge that expands on click
- Never let badges push the cell beyond its allocated width

> See [Data Table](./data-table.md) for table-specific guidance.
