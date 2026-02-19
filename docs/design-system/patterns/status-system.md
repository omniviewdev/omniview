# Status System

The status system maps Kubernetes resource states to visual treatments. The core principle: **healthy is the default and should be the quietest state**. Problems demand attention; normalcy should be calm.

> **Related**: [Color](../foundations/03-color.md) | [Data Table](../components/data-table.md) | [Badges](../components/badges.md)

---

## Resource Status Mapping

| Status Category | Examples | Color Role | Visual Treatment |
|-----------------|----------|------------|-----------------|
| **Healthy** | Running, Active, Bound, Available | Success | Colored text only |
| **Progressing** | Pending, ContainerCreating, Initializing | Info | Colored text only |
| **Warning** | Unknown, Unschedulable, Degraded | Warning | Colored text + icon |
| **Error** | Failed, CrashLoopBackOff, Evicted | Danger | Colored text + icon |
| **Terminated** | Succeeded, Completed | Muted | `--ov-fg-faint` |
| **Neutral/Info** | Terminating, Deleted | Muted | `--ov-fg-muted` |

---

## Visual Weight Progression

This is the critical design decision. Visual prominence increases with severity:

```
Visual prominence (low → high):

  Succeeded/Completed    ░░         (faint, it's done)
  Running/Active         ▒░         (calm green text, no decoration)
  Pending/Creating       ▒▒         (info blue, in progress)
  Warning/Unknown        ▓▒         (warm yellow, attention)
  Error/CrashLoop        ▓▓         (red text + icon, demands action)
```

### Healthy State (Quietest)

- Text color: `--ov-success-default` (`#56D364`)
- No icon, no badge, no background
- Just calm green text that says "everything is fine"
- This is the most common state and should be the least visually demanding

### Progressing State

- Text color: `--ov-info-default` (`#58A6FF`)
- No icon by default
- Optional: subtle pulsing animation for active creation/initialization
- Shows that something is happening, but not a problem

### Warning State

- Text color: `--ov-warning-default` (`#E3B341`)
- Small warning icon (⚠) at `--ov-icon-xs` (12px)
- Icon + text together create more visual weight than text alone
- "Hey, you should look at this"

### Error State (Loudest)

- Text color: `--ov-danger-default` (`#F47067`)
- Error icon (✕ or ⊘) at `--ov-icon-xs` (12px)
- Icon + colored text creates maximum visual weight
- "This needs attention now"

### Terminated State

- Text color: `--ov-fg-faint`
- No icon, no semantic color
- Succeeded/Completed jobs are done — they shouldn't distract from active resources

---

## Status in Different Contexts

### Table Row

```css
/* Status column in a table */
.status-text {
  font-size: var(--ov-text-base);
  font-weight: var(--ov-weight-regular);
}

.status-healthy  { color: var(--ov-success-default); }
.status-progress { color: var(--ov-info-default); }
.status-warning  { color: var(--ov-warning-default); }
.status-error    { color: var(--ov-danger-default); }
.status-done     { color: var(--ov-fg-faint); }
```

### Status Dot

For compact status representation (e.g., next to the resource name):

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot-healthy  { background: var(--ov-success-default); }
.status-dot-progress { background: var(--ov-info-default); }
.status-dot-warning  { background: var(--ov-warning-default); }
.status-dot-error    { background: var(--ov-danger-default); }
.status-dot-done     { background: var(--ov-fg-faint); }
```

### Detail Panel

In the detail panel, status can be slightly more verbose:
- Status text in the appropriate semantic color
- Additional context (reason, message) in `--ov-fg-muted`
- Conditions as a compact list, not as badge chips

### Sidebar

Resource count badges in the sidebar:
- Show error count in `--ov-danger-default` if any resources are in error
- Otherwise, show total count in `--ov-fg-faint`

---

## Conditions Display

Kubernetes conditions (Ready, Initialized, ContainersReady, etc.) should NOT be displayed as individual colored badges.

**Do**:
- Show as a count badge: "3 conditions"
- Expand to a list on click/hover
- In the list, show condition name + status (True/False) with appropriate color

**Don't**:
- Render `PodScheduled`, `Initialized`, `Ready` as individual green/red badge chips
- This creates extreme visual noise in table rows

---

## Container Status Display

For container readiness in tables:

**Do**: Show as fraction text: `2/2`, `1/3`
- All ready: `--ov-fg-muted` (quiet, everything is fine)
- Not all ready: `--ov-warning-default` (draws attention)

**Don't**: Show as colored squares or individual container badges.

> See [Data Table](../components/data-table.md) for table-specific status display rules.
