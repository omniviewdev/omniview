# Borders & Separators

Borders are a secondary tool for separating content. In most cases, spacing and background color shifts are preferable. When borders are needed, they use semi-transparent values that naturally adapt to their surface.

> **Related**: [Elevation](./06-elevation.md) | [Color](./03-color.md) | [Spacing](./05-spacing.md)

---

## Semi-Transparent Borders

Following Apple HIG, borders use semi-transparent white so they naturally adapt to the surface they sit on. This means the same border token looks correct on any background level.

```css
--ov-border-default:  rgba(255, 255, 255, 0.08);  /* Standard dividers */
--ov-border-muted:    rgba(255, 255, 255, 0.05);  /* Subtle separators */
--ov-border-emphasis: rgba(255, 255, 255, 0.14);  /* Stronger when needed */
```

### Light Theme

In light theme, the border tokens invert to semi-transparent black:

```css
--ov-border-default:  rgba(0, 0, 0, 0.10);
--ov-border-muted:    rgba(0, 0, 0, 0.06);
--ov-border-emphasis: rgba(0, 0, 0, 0.16);
```

---

## When to Use Borders vs. Spacing

| Situation | Approach |
|-----------|----------|
| Between adjacent panels (sidebar \| content \| detail) | 1px border `--ov-border-default` **or** a background color shift — not both |
| Between table rows | **No borders.** Use subtle alternating row shading or let whitespace suffice |
| Between sections in a detail panel | Spacing (`--ov-space-6`) and a section header — no horizontal rule |
| Between form fields | Spacing only |
| Around input fields | 1px `--ov-border-default`, shifting to `--ov-accent` on focus |
| Between tab items | No borders between tabs. Bottom border on the active tab only |
| Around dropdown menus | 1px `--ov-border-default` + shadow |
| Around modals | 1px `--ov-border-muted` + shadow |

### Do / Don't

**Do**: Separate the sidebar from the content area with a single 1px border:
```css
.sidebar {
  border-right: 1px solid var(--ov-border-default);
}
```

**Don't**: Add both a border *and* a different background to create double separation:
```css
/* Over-styled — pick one approach */
.sidebar {
  background: var(--ov-bg-surface-raised);
  border-right: 1px solid var(--ov-border-default);
  box-shadow: 1px 0 4px rgba(0, 0, 0, 0.2);
}
```

**Do**: Let table rows breathe with padding alone:
```css
.table-row {
  padding: var(--ov-space-2) var(--ov-space-3);
}
```

**Don't**: Add borders between every table row:
```css
/* Too heavy — creates visual noise */
.table-row {
  border-bottom: 1px solid var(--ov-border-default);
}
```

---

## Divider Component

When a visible divider is explicitly needed (e.g., between toolbar groups, between dropdown sections):

```css
.ov-divider {
  height: 1px;
  background: var(--ov-border-default);
  margin: var(--ov-space-3) 0;  /* 12px vertical spacing */
}

/* Vertical divider (between inline items) */
.ov-divider-vertical {
  width: 1px;
  height: 16px;
  background: var(--ov-border-default);
  margin: 0 var(--ov-space-2);  /* 8px horizontal spacing */
}
```

---

## Focus Borders

Input fields and interactive elements use the accent color for focus indication:

```css
/* Default state */
border: 1px solid var(--ov-border-default);

/* Focus state */
border: 1px solid var(--ov-accent);
outline: none;  /* The border change replaces the outline */

/* Or with outline for non-bordered elements */
outline: 2px solid var(--ov-accent);
outline-offset: 2px;
```

> See [Interactive States](../patterns/interactive-states.md) for the complete state system.
