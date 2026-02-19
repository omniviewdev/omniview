# Typography

Typography is the primary tool for establishing visual hierarchy in an IDE. Omniview uses system fonts for native feel and a carefully tuned type scale optimized for information-dense displays.

> **Related**: [Principles](./01-principles.md) | [Spacing](./05-spacing.md) | [Information Hierarchy](../patterns/information-hierarchy.md)

---

## Font Stacks

### UI Font

Used for all interface chrome: sidebar, tabs, tables, labels, buttons, form controls.

```css
--ov-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
              Helvetica, Arial, sans-serif;
```

System fonts are faster to render, feel native, and adapt to the platform. Users who want a custom font can override `--ov-font-ui` in their theme.

### Monospace Font

Used for code surfaces: editor, terminal, logs, YAML, JSON, inline code.

```css
--ov-font-mono: "SF Mono", "Cascadia Code", "JetBrains Mono", "Fira Code",
                Menlo, Consolas, "Liberation Mono", monospace;
```

The fallback order prioritizes platform-native monospace fonts before cross-platform alternatives.

---

## Type Scale

An IDE-optimized scale with 14px as the workhorse body size. All values in rem (base 16px) to respect user font-size preferences.

| Token | Size | rem | Weight | Line Height | Usage |
|-------|------|-----|--------|-------------|-------|
| `--ov-text-xs` | 11px | 0.6875 | 400 | 1.45 | Micro labels, badge text |
| `--ov-text-sm` | 12px | 0.75 | 400 | 1.42 | Status bar, breadcrumbs, captions, column headers |
| `--ov-text-base` | 14px | 0.875 | 400 | 1.43 | Body text, tree items, table cells |
| `--ov-text-md` | 15px | 0.9375 | 500 | 1.40 | Emphasized body, sidebar headers |
| `--ov-text-lg` | 16px | 1.0 | 600 | 1.375 | Section headings, panel titles |
| `--ov-text-xl` | 20px | 1.25 | 600 | 1.3 | Page titles |
| `--ov-text-2xl` | 24px | 1.5 | 600 | 1.25 | Feature titles (rare) |

### Token Implementation

```css
--ov-text-xs:    0.6875rem;   /* 11px */
--ov-text-sm:    0.75rem;     /* 12px */
--ov-text-base:  0.875rem;    /* 14px */
--ov-text-md:    0.9375rem;   /* 15px */
--ov-text-lg:    1rem;        /* 16px */
--ov-text-xl:    1.25rem;     /* 20px */
--ov-text-2xl:   1.5rem;      /* 24px */
```

**Note**: The scale is tighter than typical web typography (11–24px vs 12–48px) because IDE interfaces need more information density. Sizes above `--ov-text-xl` are rare and reserved for feature-level headings.

---

## Weight Usage

| Weight | Value | Token | Usage |
|--------|-------|-------|-------|
| Regular | 400 | `--ov-weight-regular` | Body text, table cells, metadata values |
| Medium | 500 | `--ov-weight-medium` | Emphasized labels, active sidebar items, badge text |
| Semibold | 600 | `--ov-weight-semibold` | Section headings, panel titles, column headers |

### Hierarchy Through Weight

**Rule**: Differentiate hierarchy by weight before reaching for size. A 14px semibold header next to 14px regular body text creates clear hierarchy without size inflation.

**Do**:
```css
/* Section header */
font-size: var(--ov-text-sm);
font-weight: var(--ov-weight-semibold);
color: var(--ov-fg-muted);
text-transform: uppercase;
letter-spacing: 0.05em;

/* Body text below it */
font-size: var(--ov-text-base);
font-weight: var(--ov-weight-regular);
color: var(--ov-fg-default);
```

**Don't**:
```css
/* Over-styled header */
font-size: var(--ov-text-lg);
font-weight: 700;
color: var(--ov-accent);
text-decoration: underline;
```

---

## Monospace Typography

For log panels, terminals, code editors, and inline code:

```css
--ov-mono-size:    13px;     /* Slightly smaller than UI text */
--ov-mono-leading: 1.54;    /* ~20px at 13px — generous for readability */
--ov-mono-weight:  400;
```

### Usage Guidelines

| Context | Font | Size | Notes |
|---------|------|------|-------|
| Code editor | `--ov-font-mono` | 13px | Standard monospace |
| Terminal | `--ov-font-mono` | 13px | Same as editor for consistency |
| Log messages | `--ov-font-mono` | 13px | Message content |
| Log timestamps | `--ov-font-mono` | 11px (`--ov-text-xs`) | Smaller to de-emphasize |
| Log source labels | `--ov-font-mono` | 11px (`--ov-text-xs`) | Muted color |
| Inline code | `--ov-font-mono` | 0.9em | Relative to surrounding text |
| YAML/JSON values | `--ov-font-mono` | 13px | In detail panels |

---

## Line Height Guidelines

Line heights are tuned to align with the 4px grid where possible:

| Scale Level | Size | Line Height | Computed | Grid-Aligned |
|-------------|------|-------------|----------|-------------|
| xs (11px) | 0.6875rem | 1.45 | ~16px | 16px (4 x 4) |
| sm (12px) | 0.75rem | 1.42 | ~17px | ~16px |
| base (14px) | 0.875rem | 1.43 | ~20px | 20px (5 x 4) |
| md (15px) | 0.9375rem | 1.40 | ~21px | ~20px |
| lg (16px) | 1rem | 1.375 | 22px | ~24px with padding |
| xl (20px) | 1.25rem | 1.3 | 26px | ~28px with padding |
| 2xl (24px) | 1.5rem | 1.25 | 30px | ~32px with padding |

> See [Spacing](./05-spacing.md) for the 4px grid system.
