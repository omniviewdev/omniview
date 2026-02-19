# Layout

The IDE shell layout defines how panels, sidebars, headers, and content areas compose into the full application window.

> **Related**: [Spacing](../foundations/05-spacing.md) | [Elevation](../foundations/06-elevation.md) | [Sidebar](../components/sidebar.md)

---

## IDE Shell Structure

```
┌──────────────────────────────────────────────────────────┐
│  Header (38px)                                           │
├────┬──────────┬────────────────────────┬─────────────────┤
│    │          │                        │                 │
│ Nav│ Sidebar  │    Content Area        │  Detail Panel   │
│Rail│ (260px)  │    (flexible)          │  (560px)        │
│42px│          │                        │                 │
│    │          ├────────────────────────┤                 │
│    │          │  Bottom Drawer (280px) │                 │
├────┴──────────┴────────────────────────┴─────────────────┤
│  Footer / Status Bar (24px)                              │
└──────────────────────────────────────────────────────────┘
```

---

## Panel Dimensions

| Panel | Default | Min | Max | Token |
|-------|---------|-----|-----|-------|
| Header | 38px | 38px | 38px | `--ov-header-height` |
| Footer | 24px | 24px | 24px | `--ov-footer-height` |
| Nav rail | 42px | 42px | 42px | `--ov-sidenav-width` |
| Sidebar | 260px | 200px | 400px | `--ov-sidebar-width` |
| Detail panel | 560px | 400px | 800px | `--ov-detail-panel-width` |
| Bottom drawer | 280px | 120px | — | `--ov-bottom-drawer-height` |
| Content area | Flexible | ~400px | — | Takes remaining space |

---

## Panel Composition Rules

### Spatial Zones, Not Cards

Panels are spatial zones within a single window, not floating cards. This means:

- **No shadows** between layout panels — use background color shifts instead
- **Borders are optional** — use a 1px `--ov-border-default` between panels, or rely on the background color difference
- **Don't use both** border and background difference — pick one separation method

### Separation Strategy

| Panel Boundary | Separation Method |
|----------------|-------------------|
| Nav rail → Sidebar | Background color shift (rail is raised, sidebar is raised) |
| Sidebar → Content | 1px `--ov-border-default` |
| Content → Detail panel | 1px `--ov-border-default` |
| Content ↔ Bottom drawer | Resize handle (4px) with `--ov-border-muted` |
| Header → Content | 1px `--ov-border-default` or background shift |
| Content → Footer | 1px `--ov-border-default` |

---

## Panel Behavior

### Sidebar

- **Collapsible** to the nav rail (42px) via toggle button
- **Resizable** by dragging the right edge
- **Persists** its width preference across sessions
- **Animation**: `--ov-duration-normal` (200ms) for collapse/expand

### Detail Panel

- **Opens** when a resource is selected in the table
- **Closes** via close button or `Escape` key
- **Resizable** by dragging the left edge
- **Animation**: Slides in from the right, `--ov-duration-normal`

### Bottom Drawer

- **Opens** for logs, terminal, build output
- **Closeable** via close button or toggle
- **Resizable** by dragging the top edge
- **Tabs** for switching between log, terminal, and build views

---

## Content Area

The content area is the main workspace and should always fill the remaining space:

```css
.content-area {
  flex: 1;
  min-width: 400px;
  overflow: auto;
}
```

When the viewport is too narrow:
1. Detail panel auto-collapses first
2. Then bottom drawer collapses
3. Sidebar collapses to rail last
4. Content area never goes below ~400px

---

## Header Bar

| Element | Style |
|---------|-------|
| Background | `--ov-bg-surface-raised` |
| Height | 38px (`--ov-header-height`) |
| Bottom border | 1px `--ov-border-default` |
| Left section | Breadcrumbs, context indicator |
| Center section | Tab bar (if using top-level tabs) |
| Right section | Search, settings, user actions |

---

## Footer / Status Bar

| Element | Style |
|---------|-------|
| Background | `--ov-bg-surface-raised` |
| Height | 24px (`--ov-footer-height`) |
| Top border | 1px `--ov-border-default` |
| Text | `--ov-text-xs`, `--ov-fg-muted` |
| Status items | Inline, separated by `--ov-space-3` |

The status bar shows contextual information: cluster status, namespace, active connections, plugin status.

---

## Resize Handles

| Property | Value |
|----------|-------|
| Handle width/height | 4px (expands to 8px on hover for easier grabbing) |
| Cursor | `col-resize` (vertical), `row-resize` (horizontal) |
| Color | Transparent by default, `--ov-border-muted` on hover |
| Double-click | Reset to default size |

> See [Motion](../foundations/09-motion.md) for panel animation details.
