# Sidebar / Tree Navigation

The sidebar provides hierarchical navigation through resources. It organizes resource types into collapsible groups and shows context connections.

> **Related**: [Spacing](../foundations/05-spacing.md) | [Interactive States](../patterns/interactive-states.md) | [Layout](../patterns/layout.md)

---

## Structure

```
┌─ Sidebar ──────────────────┐
│  🔲 minikube           ⚙  │
│                             │
│  ▸ Nodes                    │
│  ▸ Events                   │
│  ▸ Namespaces               │
│  ▾ Workload                 │
│      CronJob                │
│      DaemonSet              │
│      Deployment             │
│      Job                    │
│    ● Pod                    │ ← selected
│      ReplicaSet             │
└─────────────────────────────┘
```

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Background | Raised surface | `--ov-sidebar-bg` → `--ov-bg-surface-raised` |
| Width | 260px default | `--ov-sidebar-width` |
| Min width | 200px | `--ov-sidebar-min-width` |
| Max width | 400px | `--ov-sidebar-max-width` |
| Item height | 32px | — |
| Item horizontal padding | 12px left, 8px right | `--ov-space-3`, `--ov-space-2` |
| Item font | 14px, regular | `--ov-text-base` |
| Item text color | Default | `--ov-fg-default` |
| Category/group label font | 12px, semibold | `--ov-text-sm`, `--ov-weight-semibold` |
| Category/group label color | Muted | `--ov-fg-muted` |
| Indent per nesting level | 16px | `--ov-space-4` |
| Section spacing | 8px gap between groups | `--ov-space-2` |
| Expand/collapse icon | 12px chevron | `--ov-icon-xs`, `--ov-fg-faint` |
| Right border | 1px | `--ov-border-default` |

---

## Item States

| State | Visual Treatment |
|-------|-----------------|
| Default | No background, `--ov-fg-default` text |
| Hover | `rgba(255, 255, 255, 0.04)` background |
| Selected | `--ov-accent-subtle` background |
| Selected text | `--ov-fg-default` (brightened, **not** accent-colored) |
| Selected indicator | 2px left border in `--ov-accent` or background shift |
| Focused (keyboard) | 2px accent outline |
| Disabled/unavailable | `--ov-fg-disabled` text, no hover effect |

### Selected State Details

The selected item should be clearly distinguishable but not overwhelming:

**Do**: Use a subtle accent-tinted background with a left accent border:
```css
.sidebar-item-selected {
  background: var(--ov-accent-subtle);
  border-left: 2px solid var(--ov-accent);
  color: var(--ov-fg-default);
}
```

**Don't**: Make the entire selected item a solid accent color:
```css
/* Too heavy — dominates the sidebar */
.sidebar-item-selected {
  background: var(--ov-accent);
  color: white;
}
```

---

## Group Headers

Category groups (Workload, Network, Storage) use smaller, muted text to create visual landmarks without competing with the items they contain.

```css
.sidebar-group-header {
  font-size: var(--ov-text-sm);
  font-weight: var(--ov-weight-semibold);
  color: var(--ov-fg-muted);
  padding: var(--ov-space-2) var(--ov-space-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
```

---

## Collapse Behavior

- The sidebar is collapsible to the icon-only navigation rail (42px)
- Collapsing should animate with `--ov-duration-normal` (200ms)
- When collapsed, tooltips show the full label on hover
- The expand/collapse control sits at the bottom or top of the sidebar

---

## Context Indicator

The top of the sidebar shows the active context (cluster name) with:
- A small icon or avatar
- The context name in `--ov-text-base`, `--ov-weight-medium`
- A settings/gear icon on the right, `--ov-fg-faint`, visible on hover

> See [Layout](../patterns/layout.md) for how the sidebar fits into the IDE shell.
