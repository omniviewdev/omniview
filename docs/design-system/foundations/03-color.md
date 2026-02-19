# Color System

The color system establishes Omniview's visual identity: a cool-neutral dark palette with opacity-based text hierarchy and desaturated status colors.

> **Related**: [Token Architecture](./02-token-architecture.md) | [Status System](../patterns/status-system.md) | [Accessibility](../patterns/accessibility.md)

---

## Design Goals

- **Cool-neutral dark palette**: Shift from warm zinc tones toward a cooler, blue-gray base. Cool backgrounds create higher *perceived* contrast for light text, making content feel crisper.
- **Opacity-based text hierarchy**: Following Apple HIG, use a single light base color at different opacities for text tiers. This naturally adapts to any surface.
- **Desaturated status colors**: Status indicators should be muted by default, not neon. Reserve high saturation for critical states.

---

## Neutral Scale

A 14-step neutral scale, cool-tinted. Steps 0–6 are background surfaces, 7–8 are borders, 9–13 are foreground.

### Dark Theme — "Omniview Dark"

| Step | Hex | CSS Variable | Usage |
|------|-----|-------------|-------|
| 0 | `#0D1117` | `--ov-scale-gray-0` | Base background (deepest) |
| 1 | `#10141A` | `--ov-scale-gray-1` | Inset surfaces (inputs, terminal) |
| 2 | `#151B23` | `--ov-scale-gray-2` | Default surface (main content area) |
| 3 | `#1A2130` | `--ov-scale-gray-3` | Raised surface (sidebars, panels) |
| 4 | `#1F2937` | `--ov-scale-gray-4` | Elevated surface (cards, dropdowns) |
| 5 | `#253345` | `--ov-scale-gray-5` | Overlay surface (modals, popovers) |
| 6 | `#2D3D52` | `--ov-scale-gray-6` | Hover highlights on surfaces |
| 7 | `#364559` | `--ov-scale-gray-7` | Subtle borders, faint dividers |
| 8 | `#3E4F66` | `--ov-scale-gray-8` | Default borders (meets contrast on step 2) |
| 9 | `#6B7D96` | `--ov-scale-gray-9` | Faint text, disabled, placeholders |
| 10 | `#8B9BB5` | `--ov-scale-gray-10` | Muted text, timestamps, secondary labels |
| 11 | `#ABB8CC` | `--ov-scale-gray-11` | Secondary text, metadata values |
| 12 | `#CBD5E1` | `--ov-scale-gray-12` | Default text (primary body content) |
| 13 | `#ECF0F6` | `--ov-scale-gray-13` | Emphasized text (names, titles, headings) |

Each step increases luminance approximately 2–3%. The progression should be subtle — you shouldn't *notice* the sidebar is different from the content area, but removing the difference would make the layout feel flat.

---

## Text Hierarchy (Opacity Approach)

Following Apple's label system, text is defined as a single base color at descending opacities. This means text naturally works on any surface tone and automatically maintains appropriate contrast during state changes (hover, selection).

```css
--ov-fg-base:      #ECF0F6;
--ov-fg-default:   rgba(236, 240, 246, 0.92);  /* Primary text */
--ov-fg-muted:     rgba(236, 240, 246, 0.64);  /* Secondary labels, metadata */
--ov-fg-faint:     rgba(236, 240, 246, 0.44);  /* Tertiary: timestamps, counts, ages */
--ov-fg-disabled:  rgba(236, 240, 246, 0.28);  /* Disabled, placeholder */
```

### When to Use Each Level

| Level | Token | Opacity | Use For |
|-------|-------|---------|---------|
| Primary | `--ov-fg-default` | 92% | Resource names, body text, values |
| Secondary | `--ov-fg-muted` | 64% | Namespaces, labels, metadata keys, secondary columns |
| Tertiary | `--ov-fg-faint` | 44% | Timestamps, ages, UIDs, version numbers, counts |
| Disabled | `--ov-fg-disabled` | 28% | Disabled controls, placeholder text |

**Rule**: If you can't decide which tier something belongs to, it's probably Tertiary. Promote sparingly.

> See [Information Hierarchy](../patterns/information-hierarchy.md) for the full three-tier content rule.

---

## Accent Color

The primary accent color is used for focus rings, selected states, active tabs, and interactive affordances.

```css
--ov-accent:         #58A6FF;                    /* Default accent (blue) */
--ov-accent-muted:   rgba(88, 166, 255, 0.20);  /* Accent backgrounds */
--ov-accent-subtle:  rgba(88, 166, 255, 0.10);  /* Hover tints */
--ov-accent-fg:      #79C0FF;                    /* Accent-colored text (links) */
```

This is a GitHub-inspired blue that reads clearly on dark surfaces without being harsh. The accent color is user-customizable via the theme system.

### Accent Usage

| Context | Token |
|---------|-------|
| Focus rings | `--ov-accent` |
| Selected row/item background | `--ov-accent-subtle` |
| Active tab indicator | `--ov-accent` |
| Link text | `--ov-accent-fg` |
| Primary button background | `--ov-accent` |

---

## Semantic Status Colors

Each semantic role has three variants: `emphasis` (solid background), `default` (text/icon), and `muted` (subtle background).

| Role | Emphasis (bg) | Default (text) | Muted (bg) |
|------|--------------|----------------|------------|
| Success | `#1A7F37` | `#56D364` | `rgba(86, 211, 100, 0.12)` |
| Warning | `#9A6700` | `#E3B341` | `rgba(227, 179, 65, 0.12)` |
| Danger | `#CF222E` | `#F47067` | `rgba(244, 112, 103, 0.12)` |
| Info | `#1F6FEB` | `#58A6FF` | `rgba(88, 166, 255, 0.12)` |

**Important**: These are intentionally *desaturated* compared to raw primary colors. A running pod doesn't need to glow green — it needs to calmly indicate health. An error state *should* draw the eye, but through contrast with the calm surroundings, not through neon saturation.

### Status Color Tokens

```css
/* Success */
--ov-success-emphasis:  #1A7F37;
--ov-success-default:   #56D364;
--ov-success-muted:     rgba(86, 211, 100, 0.12);

/* Warning */
--ov-warning-emphasis:  #9A6700;
--ov-warning-default:   #E3B341;
--ov-warning-muted:     rgba(227, 179, 65, 0.12);

/* Danger */
--ov-danger-emphasis:   #CF222E;
--ov-danger-default:    #F47067;
--ov-danger-muted:      rgba(244, 112, 103, 0.12);

/* Info */
--ov-info-emphasis:     #1F6FEB;
--ov-info-default:      #58A6FF;
--ov-info-muted:        rgba(88, 166, 255, 0.12);
```

> See [Status System](../patterns/status-system.md) for how these map to Kubernetes resource statuses.

---

## Light Theme Considerations

When implementing a light theme:

- **Invert the neutral scale direction**: Step 0 = lightest (`#FFFFFF`), step 13 = darkest (`#1B1F24`)
- **Same semantic token names apply**: Only the primitive mappings change
- **Status colors need light-mode values**: Darker tones for text on light backgrounds (e.g., success text becomes `#1A7F37` instead of `#56D364`)
- **Same accent hue at a different luminance**: The accent blue shifts darker for sufficient contrast on white surfaces
- **Opacity-based text still works**: But the base color inverts (dark base on light surfaces)

```css
/* Light theme text hierarchy */
--ov-fg-base:      #1B1F24;
--ov-fg-default:   rgba(27, 31, 36, 0.92);
--ov-fg-muted:     rgba(27, 31, 36, 0.64);
--ov-fg-faint:     rgba(27, 31, 36, 0.44);
--ov-fg-disabled:  rgba(27, 31, 36, 0.28);
```

> See [Built-in Themes](../theming/built-in-themes.md) for complete light theme values.
