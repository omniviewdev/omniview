# Detail / Inspector Panel

The detail panel is the right-side inspector that shows resource details when a row is selected. It provides deep information about a single resource: metadata, labels, annotations, containers, events, and YAML.

> **Related**: [Information Hierarchy](../patterns/information-hierarchy.md) | [Typography](../foundations/04-typography.md) | [Tabs](./tabs.md)

---

## Structure

```
┌─ Detail Panel ──────────────────────────────────┐
│  core::v1::Pod                        □ ⚙ ✕    │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Overview    Editor                              │
│                                                  │
│  METADATA                              ← header │
│  Name         coredns-6f6b679f8f-dtg5b          │
│  Namespace    kube-system                        │
│  Created      today at 2:41 PM                   │
│                                                  │
│  LABELS  2                             ← header │
│  app=coredns                                     │
│  pod-template-hash=6f6b679f8f                    │
│                                                  │
│  CONTAINERS                            ← header │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Panel background | Surface (same as content, or one step up) | `--ov-bg-surface` |
| Width | 560px default | `--ov-detail-panel-width` |
| Min width | 400px | `--ov-detail-panel-min` |
| Max width | 800px | `--ov-detail-panel-max` |
| Internal padding | 16px | `--ov-space-4` |
| Left border | 1px | `--ov-border-default` |

### Section Headers

Section headers are the primary navigation landmarks in the detail panel. They should be scannable without competing with the data.

| Property | Value | Token |
|----------|-------|-------|
| Font size | 12px | `--ov-text-sm` |
| Font weight | Semibold | `--ov-weight-semibold` |
| Text color | Muted | `--ov-fg-muted` |
| Text transform | Uppercase | — |
| Letter spacing | 0.05em | — |
| Space above | 24px | `--ov-space-6` |
| Space below | 8px | `--ov-space-2` |

```css
.section-header {
  font-size: var(--ov-text-sm);
  font-weight: var(--ov-weight-semibold);
  color: var(--ov-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: var(--ov-space-6);
  margin-bottom: var(--ov-space-2);
}
```

### Key-Value Pairs

| Property | Value | Token |
|----------|-------|-------|
| Key font | 14px, regular | `--ov-text-base` |
| Key color | Muted | `--ov-fg-muted` |
| Key width | Fixed 100-120px for alignment | — |
| Value font | 14px, regular | `--ov-text-base` |
| Value color | Default | `--ov-fg-default` |
| Row spacing | 6px between pairs | — |

```css
.kv-row {
  display: flex;
  gap: var(--ov-space-3);
  margin-bottom: 6px;
}

.kv-key {
  width: 110px;
  flex-shrink: 0;
  color: var(--ov-fg-muted);
  font-size: var(--ov-text-base);
}

.kv-value {
  color: var(--ov-fg-default);
  font-size: var(--ov-text-base);
}
```

### Tab Bar

The detail panel often has tabs (Overview, Editor, Events, YAML):

| Property | Value | Token |
|----------|-------|-------|
| Tab bar bottom border | 1px | `--ov-border-default` |
| Active tab indicator | 2px bottom border | `--ov-accent` |

> See [Tabs](./tabs.md) for full tab styling rules.

---

## Panel Header

The top of the detail panel shows the resource type and action buttons:

| Element | Style |
|---------|-------|
| Resource type label | `--ov-text-sm`, `--ov-fg-muted` (e.g., "core::v1::Pod") |
| Resource name | `--ov-text-lg`, `--ov-weight-semibold`, `--ov-fg-default` |
| Action buttons (pin, settings, close) | Icon buttons, `--ov-fg-faint`, brighten on hover |

---

## Content Patterns

### Labels and Annotations

Display as a simple list of `key=value` pairs, not as colored chips:

**Do**:
```
app=coredns
pod-template-hash=6f6b679f8f
```
In `--ov-fg-muted` for the key, `--ov-fg-default` for the value, monospace font.

**Don't**: Render each label as a colorful badge chip that dominates the section.

### Container List

Show containers as a compact list with:
- Container name in `--ov-fg-default`
- Image in `--ov-fg-muted`, monospace, truncated with tooltip
- Status as colored text (not a badge)
- Restart count in `--ov-fg-faint` if > 0

### Events Section

Recent events shown as a compact timeline:
- Event message in `--ov-fg-default`
- Timestamp in `--ov-fg-faint`
- Warning events highlighted with `--ov-warning-default` text
- Error events highlighted with `--ov-danger-default` text

---

## Open / Close Animation

The detail panel slides in from the right:
- Duration: `--ov-duration-normal` (200ms)
- Easing: `--ov-ease-out` (entering)
- The content area adjusts width simultaneously

> See [Motion](../foundations/09-motion.md) for animation guidelines.
