# Data Table

The data table is the most critical component in Omniview. Tables display resource lists — pods, deployments, nodes, services — and are the primary surface users interact with.

> **Related**: [Information Hierarchy](../patterns/information-hierarchy.md) | [Status System](../patterns/status-system.md) | [Typography](../foundations/04-typography.md)

---

## Structure

```
┌─ Header Row ──────────────────────────────────────────┐
│  □  Name ▼         Namespace    Status    Age    ···  │
├───────────────────────────────────────────────────────┤
│  □  coredns-dtg5b  kube-system  Running   20h    ···  │
│  □  etcd-minikube  kube-system  Running   20h    ···  │
│  □  kube-proxy     kube-system  Running   20h    ···  │
└───────────────────────────────────────────────────────┘
```

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Row height | 36px | — |
| Cell horizontal padding | 12px | `--ov-space-3` |
| Header text style | 12px, semibold, uppercase | `--ov-text-sm`, `--ov-weight-semibold` |
| Header text color | Secondary | `--ov-fg-muted` |
| Cell text style | 14px, regular | `--ov-text-base`, `--ov-weight-regular` |
| Cell text color | Primary | `--ov-fg-default` |
| Row hover background | Slight highlight | `--ov-bg-surface-raised` or `rgba(255,255,255,0.03)` |
| Selected row background | Accent tint | `--ov-accent-subtle` |
| Row borders | None | — |
| Table background | Surface | `--ov-bg-surface` |

### Column Text Hierarchy

| Column Type | Color | Weight | Examples |
|-------------|-------|--------|----------|
| Name (primary identifier) | `--ov-fg-default` (brightest) | Regular | Pod name, deployment name |
| Namespace | `--ov-fg-muted` | Regular | Secondary context |
| Status | Semantic color | Regular | Running, Error, Pending |
| Age / Timestamp | `--ov-fg-faint` | Regular | 20h, 3d, 2025-01-15 |
| Numeric data | `--ov-fg-muted` | Regular | CPU, memory, replica count |

---

## Status Display in Tables

This is one of the most impactful design decisions. Status should be **quiet for healthy states** and **loud for problems**.

### Do

- **Status column**: Plain text colored by semantic role
  - "Running" → `--ov-success-default` (calm green text)
  - "Pending" → `--ov-info-default` (blue text)
  - "Error" → `--ov-danger-default` (red text)
- **Conditions**: Show as small dot indicators or count badges ("3 conditions") that expand on hover/click
- **Container count**: Show as "2/2" text, not colored squares

### Don't

- Use large colored badge chips for statuses like "Running"
- Spell out long conditions like `PodReadyToStartContainers` in a table cell
- Use high-saturation colored backgrounds for routine healthy status
- Add icons to every status — reserve icons for warning and error states

---

## Sorting and Filtering

| Element | Style |
|---------|-------|
| Sort indicator | Small arrow icon (12px) next to column header, `--ov-fg-faint` |
| Active sort column header | `--ov-fg-default` (brighter than other headers) |
| Filter input | Appears above table in a toolbar row, standard input styling |
| Empty state | Centered text, `--ov-fg-muted`, with optional icon |

---

## Row Interactions

| State | Visual Treatment |
|-------|-----------------|
| Default | No background (inherits table surface) |
| Hover | `rgba(255, 255, 255, 0.03)` overlay |
| Selected | `--ov-accent-subtle` background |
| Selected + Hover | `--ov-accent-muted` background (slightly stronger) |
| Multi-selected | Same as selected, with checkbox filled |
| Focused (keyboard) | 2px accent outline inside the row |

---

## Column Configuration

- Users can show/hide columns via a column picker
- Column widths are resizable by dragging
- The Name column should always be visible and is the widest by default
- Additional columns beyond the viewport trigger horizontal scroll, not wrapping

---

## Responsive Behavior

- On narrow viewports, lower-priority columns hide automatically
- The Name and Status columns should never be hidden
- A "columns" button reveals hidden columns

> See [Information Hierarchy](../patterns/information-hierarchy.md) for column priority ordering.
