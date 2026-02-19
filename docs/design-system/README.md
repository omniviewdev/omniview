# Omniview Design System

A comprehensive design language for building a professional, native-feeling IDE experience. This documentation defines the visual foundations, token architecture, component patterns, and UX principles that make Omniview feel polished, scannable, and trustworthy.

**Inspired by**: Apple Human Interface Guidelines, GitHub Primer, JetBrains Darcula
**Built on**: MUI Material design tokens via CSS custom properties (`--ov-*`)
**Philosophy**: Dark-first, information-dense, optically precise

---

## Quick Start

If you're implementing UI, here's the cheat sheet:

```
BACKGROUNDS                          TEXT
  --ov-bg-surface-inset   (darkest)    --ov-fg-default   (92% bright)
  --ov-bg-base                         --ov-fg-muted     (64%)
  --ov-bg-surface                      --ov-fg-faint     (44%)
  --ov-bg-surface-raised               --ov-fg-disabled  (28%)
  --ov-bg-surface-overlay (lightest)

ACCENT & STATUS                      BORDERS
  --ov-accent              (blue)      --ov-border-default  (8% white)
  --ov-success-default     (green)     --ov-border-muted    (5% white)
  --ov-warning-default     (yellow)    --ov-border-emphasis  (14% white)
  --ov-danger-default      (red)
  --ov-info-default        (blue)    SPACING (4px grid)
                                       1=4  2=8  3=12  4=16  5=20  6=24

TYPE SCALE                           FONT WEIGHT
  xs=11  sm=12  base=14               400 Regular (body)
  md=15  lg=16  xl=20                  500 Medium (emphasis)
  2xl=24                               600 Semibold (headings)
```

---

## Documentation Map

### Foundations

The core visual primitives that everything else builds on.

| Document | Description |
|----------|-------------|
| [Principles](./foundations/01-principles.md) | 6 core design principles: content over chrome, hierarchy through restraint, etc. |
| [Token Architecture](./foundations/02-token-architecture.md) | Three-tier token system (primitives → semantic → component), naming conventions, MUI mapping |
| [Color](./foundations/03-color.md) | Neutral scale, text hierarchy (opacity approach), accent color, semantic status colors |
| [Typography](./foundations/04-typography.md) | Font stacks (system + monospace), type scale (11–24px), weight usage |
| [Spacing](./foundations/05-spacing.md) | 4px grid, spacing scale, layout dimensions, IDE shell measurements |
| [Elevation](./foundations/06-elevation.md) | Surface hierarchy (5 levels), shadow tokens, radius tokens |
| [Borders](./foundations/07-borders.md) | Semi-transparent borders, when to use borders vs. spacing |
| [Iconography](./foundations/08-iconography.md) | Icon sizing (12–32px), color rules, Lucide icon set |
| [Motion](./foundations/09-motion.md) | Timing (0–300ms), easing curves, what to animate vs. not |

### Components

Detailed patterns for recurring UI components.

| Document | Description |
|----------|-------------|
| [Component Index](./components/README.md) | Inventory and status tracking for all components |
| [Data Table](./components/data-table.md) | Resource list tables — row height, cell styling, status display, sorting |
| [Sidebar](./components/sidebar.md) | Tree navigation — item height, selected/hover states, group headers |
| [Detail Panel](./components/detail-panel.md) | Inspector panel — section headers, key-value pairs, tab integration |
| [Log / Terminal](./components/log-terminal.md) | Log panel — monospace styling, source labels, level colors |
| [Tabs](./components/tabs.md) | Tab bar — active indicator, close buttons, overflow handling |
| [Buttons](./components/buttons.md) | Button variants — primary, secondary, ghost, danger |
| [Badges](./components/badges.md) | Badge/chip patterns — when to use, when not to, semantic variants |
| [Inputs](./components/inputs.md) | Text inputs, search, select, textarea, form layout |
| [Command Palette](./components/command-palette.md) | Cmd+K search — result items, keyboard shortcuts, open/close |

### Patterns

Cross-cutting design patterns that apply across components.

| Document | Description |
|----------|-------------|
| [Information Hierarchy](./patterns/information-hierarchy.md) | Three-tier content rule, column priority in tables |
| [Layout](./patterns/layout.md) | IDE shell layout, panel composition, responsive behavior |
| [Interactive States](./patterns/interactive-states.md) | Hover, focus, active, selected, disabled — the overlay approach |
| [Status System](./patterns/status-system.md) | Resource status mapping, visual weight progression |
| [Accessibility](./patterns/accessibility.md) | Contrast requirements, color independence, keyboard navigation, reduced motion |

### Theming

How users and community members customize the visual appearance.

| Document | Description |
|----------|-------------|
| [Customization](./theming/customization.md) | User-facing theme API, JSON theme file spec, runtime application |
| [Creating Themes](./theming/creating-themes.md) | Step-by-step guide for building a custom theme |
| [Built-in Themes](./theming/built-in-themes.md) | Complete specs for Omniview Dark, Omniview Light, High Contrast |

### Migration

Guides for transitioning from the current implementation to the design system.

| Document | Description |
|----------|-------------|
| [Joy to Material](./migration/joy-to-material.md) | Component-by-component mapping, API differences, theme migration |
| [Token Adoption](./migration/token-adoption.md) | How to convert hardcoded styles to `--ov-*` tokens |

---

## Key Decisions

These are the most impactful design decisions in the system:

1. **Cool-neutral palette** — Shift from warm zinc to cool blue-gray for crisper perceived contrast
2. **Opacity-based text hierarchy** — One base color at 92%/64%/44% opacity instead of distinct colors
3. **Quiet status by default** — Running = calm green text, Error = red text + icon
4. **No shadows on layout panels** — Use background color shifts instead
5. **Three-tier token architecture** — Primitives → Semantic → Component for clean theming
6. **Desaturated status colors** — Reserve high saturation for critical states only

---

## Before / After

| Current Issue | Design System Fix |
|--------------|-------------------|
| Warm muddy backgrounds | Cool-neutral scale (`#0D1117` → `#ECF0F6`) |
| All text same brightness | Three-tier opacity hierarchy (92% / 64% / 44%) |
| Neon status badges | Desaturated semantic colors, text-only for healthy state |
| Condition chips dominate table rows | Dot indicators + tooltips, or count badges |
| Panels blend into one flat surface | Subtle surface elevation steps (2-3% lighter per level) |
| Section headers invisible | Uppercase, letter-spaced, muted section headers |
| Colored log source badges | Plain `[source]` prefix in muted text |
| Hardcoded colors in components | All colors via `--ov-*` semantic tokens |
| No theming API for users | JSON theme files with semantic token overrides |
