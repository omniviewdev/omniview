# Elevation & Depth

Elevation creates spatial hierarchy in the interface. In dark mode, elevated surfaces are *lighter*, not darker — following Apple's dark mode guidance where "lifting" a surface toward the viewer means increasing its luminance.

> **Related**: [Color](./03-color.md) | [Borders](./07-borders.md) | [Layout Patterns](../patterns/layout.md)

---

## Philosophy

- **Elevated = lighter** in dark mode (opposite of light mode)
- **No shadows on layout panels** — shadows are reserved for floating elements
- **Subtle differences** — each step is ~2-3% lighter; perceptible but not obvious
- **Spatial zones, not cards** — the IDE shell is composed of zones, not stacked cards

---

## Surface Hierarchy

Five elevation levels, from deepest to nearest to the user:

```
Deepest          ← Inset (inputs, terminal bg)     --ov-bg-surface-inset
                 ← Base  (body background)          --ov-bg-base
                 ← Surface (main content area)      --ov-bg-surface
                 ← Raised (sidebar, panels)         --ov-bg-surface-raised
Nearest to user  ← Overlay (dropdowns, modals)      --ov-bg-surface-overlay
```

### Token Values (Dark Theme)

| Token | Hex | Step | Usage |
|-------|-----|------|-------|
| `--ov-bg-surface-inset` | `#10141A` | 1 | Inputs, terminal, code editor background |
| `--ov-bg-base` | `#0D1117` | 0 | App body, deepest background |
| `--ov-bg-surface` | `#151B23` | 2 | Main content area, table background |
| `--ov-bg-surface-raised` | `#1A2130` | 3 | Sidebars, panels, headers |
| `--ov-bg-surface-overlay` | `#1F2937` | 4 | Dropdowns, modals, command palette |

### When to Use Each Level

| Surface Level | Components |
|---------------|------------|
| **Inset** | Text inputs, textarea, terminal background, code editor background |
| **Base** | App body (behind all panels) |
| **Surface** | Main content area, table backgrounds, tab content area |
| **Raised** | Left sidebar, right detail panel, header bar, bottom drawer header |
| **Overlay** | Dropdown menus, modal dialogs, command palette, tooltips |

---

## Shadow Tokens

Shadows are only used for truly floating elements — UI that appears above the layout rather than being part of it.

```css
--ov-shadow-sm:   0 1px 3px rgba(0, 0, 0, 0.30), 0 1px 2px rgba(0, 0, 0, 0.20);
--ov-shadow-md:   0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.25);
--ov-shadow-lg:   0 8px 24px rgba(0, 0, 0, 0.40), 0 4px 8px rgba(0, 0, 0, 0.30);
--ov-shadow-xl:   0 16px 48px rgba(0, 0, 0, 0.45);
```

| Token | Usage |
|-------|-------|
| `--ov-shadow-sm` | Tooltips, small popovers |
| `--ov-shadow-md` | Dropdown menus, select listboxes |
| `--ov-shadow-lg` | Modal dialogs, command palette |
| `--ov-shadow-xl` | Full-screen overlays (rare) |

### Shadow Rules

**Do apply shadows to**:
- Dropdown menus
- Modal dialogs
- Command palette
- Tooltips
- Context menus

**Never apply shadows to**:
- Sidebars
- Panels
- Bottom drawers
- Header bars
- Tab bars

These layout elements use background color differences for depth, not shadows.

---

## Radius Tokens

Border radius values for consistent rounding across components.

```css
--ov-radius-none: 0;
--ov-radius-sm:   4px;     /* Inputs, small chips */
--ov-radius-md:   6px;     /* Buttons, cards, badges */
--ov-radius-lg:   8px;     /* Modals, larger containers */
--ov-radius-xl:   12px;    /* Feature cards, callouts */
--ov-radius-full: 9999px;  /* Pills, avatars, status dots */
```

### Radius Usage

| Radius | Components |
|--------|------------|
| `none` | Table cells, layout panels, tab bars |
| `sm` (4px) | Input fields, small badge chips, inline code |
| `md` (6px) | Buttons, cards, dropdown menus, badges — **default** |
| `lg` (8px) | Modal dialogs, large containers |
| `xl` (12px) | Feature cards, callout boxes |
| `full` | Avatars, status dots, pill badges |

**Default radius**: `--ov-radius-md` (6px). Don't mix too many radii in one view — consistency is more important than component-level customization.
