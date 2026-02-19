# Token Architecture

The design token system is the backbone of Omniview's visual language. Every color, size, spacing value, and shadow in the application flows through CSS custom properties organized in three tiers.

> **Related**: [Color](./03-color.md) | [Typography](./04-typography.md) | [Spacing](./05-spacing.md) | [Token Adoption Guide](../migration/token-adoption.md)

---

## Three-Tier Model

Following GitHub Primer's three-tier model, adapted for MUI's CSS variable system:

```
┌─────────────────────────────────────────────────┐
│  Tier 1: PRIMITIVES                             │
│  Raw color scales, fixed spacing values,        │
│  font stacks. Never referenced in components.   │
│  e.g. --ov-scale-gray-800: #1E2024             │
├─────────────────────────────────────────────────┤
│  Tier 2: SEMANTIC TOKENS                        │
│  Purpose-named tokens that map to primitives.   │
│  These are what components reference.           │
│  e.g. --ov-bg-surface: var(--ov-scale-gray-900)│
├─────────────────────────────────────────────────┤
│  Tier 3: COMPONENT TOKENS                       │
│  Scoped to specific component patterns.         │
│  Override semantic tokens for local context.     │
│  e.g. --ov-sidebar-bg: var(--ov-bg-surface)    │
└─────────────────────────────────────────────────┘
```

### Tier 1: Primitives

Raw values. These define the available palette but should **never** be referenced directly in component code. They exist so that semantic tokens can remap to them based on the active theme.

```css
/* Neutral scale */
--ov-scale-gray-0:  #0D1117;
--ov-scale-gray-1:  #10141A;
--ov-scale-gray-2:  #151B23;
/* ... through --ov-scale-gray-13 */

/* Blue accent scale */
--ov-scale-blue-5:  #58A6FF;
--ov-scale-blue-6:  #79C0FF;
```

### Tier 2: Semantic Tokens

Purpose-named tokens that describe *what the value is for*, not what it looks like. These are the primary API for component developers.

```css
--ov-bg-base:              var(--ov-scale-gray-0);
--ov-bg-surface:           var(--ov-scale-gray-2);
--ov-bg-surface-raised:    var(--ov-scale-gray-3);
--ov-bg-surface-overlay:   var(--ov-scale-gray-4);
--ov-bg-surface-inset:     var(--ov-scale-gray-1);

--ov-fg-default:           rgba(236, 240, 246, 0.92);
--ov-fg-muted:             rgba(236, 240, 246, 0.64);
--ov-fg-faint:             rgba(236, 240, 246, 0.44);
```

### Tier 3: Component Tokens

Scoped tokens for specific UI regions or component patterns. These default to a semantic token but can be independently overridden by themes.

```css
--ov-sidebar-bg:           var(--ov-bg-surface-raised);
--ov-table-row-bg-hover:   rgba(255, 255, 255, 0.03);
--ov-tab-active-border:    var(--ov-accent);
--ov-editor-bg:            var(--ov-bg-surface-inset);
--ov-terminal-bg:          var(--ov-bg-surface-inset);
```

---

## Naming Convention

```
--ov-{category}-{role}-{modifier}
```

| Part | Values | Examples |
|------|--------|---------|
| **Prefix** | `--ov` | Always present |
| **Category** | `bg`, `fg`, `border`, `shadow`, `radius`, `space`, `font`, `size`, `weight`, `leading` | Describes the CSS property domain |
| **Role** | `surface`, `default`, `muted`, `accent`, `success`, `warning`, `danger`, `info` | Describes the semantic purpose |
| **Modifier** | `emphasis`, `subtle`, `hover`, `active`, `disabled`, `raised`, `inset`, `overlay` | Describes the variant or state |

### Full Semantic Token Reference

**Backgrounds**:

| Token | Purpose |
|-------|---------|
| `--ov-bg-base` | Deepest background (app body) |
| `--ov-bg-surface` | Default content area background |
| `--ov-bg-surface-raised` | Panels, sidebars — one step above surface |
| `--ov-bg-surface-overlay` | Dropdowns, modals — floating above content |
| `--ov-bg-surface-inset` | Inputs, terminal, code editor — recessed |

**Foregrounds**:

| Token | Purpose |
|-------|---------|
| `--ov-fg-default` | Primary text (names, body content) |
| `--ov-fg-muted` | Secondary text (namespaces, labels, metadata) |
| `--ov-fg-faint` | Tertiary text (timestamps, ages, counts) |
| `--ov-fg-disabled` | Disabled text, placeholders |
| `--ov-fg-accent` | Links, interactive text |

**Borders**:

| Token | Purpose |
|-------|---------|
| `--ov-border-default` | Standard borders and dividers |
| `--ov-border-muted` | Subtle separators |
| `--ov-border-emphasis` | Stronger borders when needed |

**Accent & Status**:

| Token | Purpose |
|-------|---------|
| `--ov-accent` | Primary accent (focus rings, selections) |
| `--ov-accent-muted` | Accent backgrounds (selected row bg) |
| `--ov-accent-subtle` | Hover tints |
| `--ov-accent-fg` | Accent-colored text (links) |
| `--ov-success-default` | Healthy status text |
| `--ov-warning-default` | Warning status text |
| `--ov-danger-default` | Error status text |
| `--ov-info-default` | Informational status text |

> See [Color](./03-color.md) for complete color values and the neutral scale.

---

## MUI Integration

Semantic tokens map into MUI Material's theme structure so that components using `theme.palette`, `sx`, or `styled()` automatically receive the correct values:

```typescript
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    background: {
      default: 'var(--ov-bg-base)',
      paper:   'var(--ov-bg-surface)',
    },
    text: {
      primary:   'var(--ov-fg-default)',
      secondary: 'var(--ov-fg-muted)',
      disabled:  'var(--ov-fg-disabled)',
    },
    primary: {
      main: 'var(--ov-accent)',
    },
    error:   { main: 'var(--ov-danger-default)' },
    warning: { main: 'var(--ov-warning-default)' },
    success: { main: 'var(--ov-success-default)' },
    info:    { main: 'var(--ov-info-default)' },
    divider: 'var(--ov-border-default)',
  },
  typography: {
    fontFamily: 'var(--ov-font-ui)',
    fontSize: 14,
  },
  shape: {
    borderRadius: 6,  // --ov-radius-md
  },
});
```

This means:
- `theme.palette.background.paper` resolves to `var(--ov-bg-surface)`
- `theme.palette.text.primary` resolves to `var(--ov-fg-default)`
- Component overrides can still use `--ov-*` tokens directly via `sx` or CSS

> See [Joy to Material Migration](../migration/joy-to-material.md) for the full migration strategy.

---

## Theme Resolution Order

When a token value is resolved at runtime:

```
Component tokens  →  User overrides  →  Built-in theme  →  Primitive defaults
(most specific)                                            (least specific)
```

This enables progressive customization: a user can override just `--ov-accent` to change the accent color throughout the entire app, or override `--ov-sidebar-bg` to change only the sidebar.

> See [Theme Customization](../theming/customization.md) for the user-facing theme API.
