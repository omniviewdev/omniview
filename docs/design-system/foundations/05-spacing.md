# Spacing & Layout

All spacing in Omniview is based on a 4px grid. This creates consistent rhythm across the interface and ensures optical alignment between different components.

> **Related**: [Typography](./04-typography.md) | [Layout Patterns](../patterns/layout.md) | [Elevation](./06-elevation.md)

---

## Spacing Scale

Based on a 4px grid. All component internal spacing and layout gaps use these values.

| Token | Value | Usage |
|-------|-------|-------|
| `--ov-space-0` | 0px | No space |
| `--ov-space-1` | 4px | Inline icon-text gap, tight padding |
| `--ov-space-2` | 8px | Default component padding, small gaps |
| `--ov-space-3` | 12px | Table cell padding, list item padding |
| `--ov-space-4` | 16px | Section padding, card padding |
| `--ov-space-5` | 20px | Panel margins |
| `--ov-space-6` | 24px | Large section gaps |
| `--ov-space-8` | 32px | Page-level margins |
| `--ov-space-10` | 40px | Major section breaks |
| `--ov-space-12` | 48px | Feature section spacing (rare) |

### Common Patterns

```css
/* Icon next to text */
gap: var(--ov-space-1);     /* 4px */

/* Items in a toolbar */
gap: var(--ov-space-2);     /* 8px */

/* Table cell padding */
padding: 0 var(--ov-space-3); /* 0 12px */

/* Card/panel internal padding */
padding: var(--ov-space-4);   /* 16px */

/* Space between sections in a panel */
margin-top: var(--ov-space-6); /* 24px */
```

---

## Layout Dimensions

Fixed dimensions for the IDE shell, defined as CSS custom properties so they can be referenced in `calc()`.

```css
--ov-header-height:        38px;
--ov-footer-height:        24px;
--ov-sidenav-width:        42px;    /* Icon-only left rail */
--ov-sidebar-width:        260px;   /* Tree/navigation sidebar */
--ov-sidebar-min-width:    200px;
--ov-sidebar-max-width:    400px;
--ov-detail-panel-width:   560px;   /* Right detail/inspector panel */
--ov-detail-panel-min:     400px;
--ov-detail-panel-max:     800px;
--ov-bottom-drawer-height: 280px;   /* Default log/terminal height */
```

### IDE Shell Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header (38px)                                           │
├────┬──────────┬────────────────────────┬─────────────────┤
│    │          │                        │                 │
│ 42 │  260px   │    Content Area        │   Detail Panel  │
│ px │ Sidebar  │    (flexible)          │   (560px)       │
│    │          │                        │                 │
│    │          ├────────────────────────┤                 │
│    │          │  Bottom Drawer (280px) │                 │
├────┴──────────┴────────────────────────┴─────────────────┤
│  Footer (24px)                                           │
└──────────────────────────────────────────────────────────┘
```

All panel widths are resizable within their min/max bounds. The content area is flexible and takes remaining space.

---

## Grid Alignment

All vertical spacing should align to the 4px grid. This means:

- Line heights produce values divisible by 4 (or acceptably close)
- Padding values come from the spacing scale
- Icon sizes are multiples of 4: 12, 16, 20, 24
- Row heights in tables and lists are multiples of 4: 32, 36, 40

### Key Row Heights

| Component | Height | Calculation |
|-----------|--------|-------------|
| Table row | 36px | 8px top/bottom padding + 20px content |
| Sidebar item | 32px | 6px top/bottom padding + 20px content |
| Tab bar | 36px | Matches table row height |
| Header bar | 38px | Fixed |
| Footer/status bar | 24px | Fixed |
| Button (default) | 32px | 6px top/bottom padding + 20px content |
| Button (compact) | 28px | 4px top/bottom padding + 20px content |

### Vertical Rhythm Example

```css
/* A well-aligned detail panel section */
.section-header {
  font-size: var(--ov-text-sm);      /* 12px */
  line-height: 16px;                  /* 4px grid */
  margin-top: var(--ov-space-6);      /* 24px above */
  margin-bottom: var(--ov-space-2);   /* 8px below */
}

.key-value-row {
  height: 24px;                       /* 4px grid */
  font-size: var(--ov-text-base);     /* 14px */
  line-height: 20px;                  /* 4px grid */
  margin-bottom: 4px;                 /* tight spacing */
}
```

---

## Responsive Behavior

Omniview is a desktop application, but panels should handle reasonable viewport ranges gracefully:

- **Sidebar**: Collapsible to icon-only rail (42px). Min 200px when expanded.
- **Detail panel**: Collapsible (hidden). Min 400px when visible.
- **Bottom drawer**: Collapsible (hidden). Min 120px when visible. Max follows content height.
- **Content area**: Always fills remaining space. Minimum ~400px before panels auto-collapse.

> See [Layout Patterns](../patterns/layout.md) for panel composition and behavior rules.
