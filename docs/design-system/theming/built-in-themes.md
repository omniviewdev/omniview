# Built-in Themes

Omniview ships with three built-in themes. Each provides a complete set of semantic tokens.

> **Related**: [Customization](./customization.md) | [Color](../foundations/03-color.md) | [Accessibility](../patterns/accessibility.md)

---

## Omniview Dark (Default)

The primary theme. A cool-neutral dark palette inspired by GitHub Dark, Apple Dark Mode, and JetBrains Darcula.

### Surfaces

| Token | Value | Step |
|-------|-------|------|
| `--ov-bg-base` | `#0D1117` | 0 |
| `--ov-bg-surface-inset` | `#10141A` | 1 |
| `--ov-bg-surface` | `#151B23` | 2 |
| `--ov-bg-surface-raised` | `#1A2130` | 3 |
| `--ov-bg-surface-overlay` | `#1F2937` | 4 |

### Text

| Token | Value |
|-------|-------|
| `--ov-fg-default` | `rgba(236, 240, 246, 0.92)` |
| `--ov-fg-muted` | `rgba(236, 240, 246, 0.64)` |
| `--ov-fg-faint` | `rgba(236, 240, 246, 0.44)` |
| `--ov-fg-disabled` | `rgba(236, 240, 246, 0.28)` |
| `--ov-fg-accent` | `#79C0FF` |

### Accent

| Token | Value |
|-------|-------|
| `--ov-accent` | `#58A6FF` |
| `--ov-accent-muted` | `rgba(88, 166, 255, 0.20)` |
| `--ov-accent-subtle` | `rgba(88, 166, 255, 0.10)` |

### Status

| Role | Emphasis | Default | Muted |
|------|----------|---------|-------|
| Success | `#1A7F37` | `#56D364` | `rgba(86, 211, 100, 0.12)` |
| Warning | `#9A6700` | `#E3B341` | `rgba(227, 179, 65, 0.12)` |
| Danger | `#CF222E` | `#F47067` | `rgba(244, 112, 103, 0.12)` |
| Info | `#1F6FEB` | `#58A6FF` | `rgba(88, 166, 255, 0.12)` |

### Borders

| Token | Value |
|-------|-------|
| `--ov-border-default` | `rgba(255, 255, 255, 0.08)` |
| `--ov-border-muted` | `rgba(255, 255, 255, 0.05)` |
| `--ov-border-emphasis` | `rgba(255, 255, 255, 0.14)` |

---

## Omniview Light

A clean light theme for users who prefer light interfaces or work in bright environments.

### Surfaces

| Token | Value |
|-------|-------|
| `--ov-bg-base` | `#FFFFFF` |
| `--ov-bg-surface-inset` | `#F6F8FA` |
| `--ov-bg-surface` | `#FFFFFF` |
| `--ov-bg-surface-raised` | `#F6F8FA` |
| `--ov-bg-surface-overlay` | `#FFFFFF` |

### Text

| Token | Value |
|-------|-------|
| `--ov-fg-default` | `rgba(27, 31, 36, 0.92)` |
| `--ov-fg-muted` | `rgba(27, 31, 36, 0.64)` |
| `--ov-fg-faint` | `rgba(27, 31, 36, 0.44)` |
| `--ov-fg-disabled` | `rgba(27, 31, 36, 0.28)` |
| `--ov-fg-accent` | `#0969DA` |

### Accent

| Token | Value |
|-------|-------|
| `--ov-accent` | `#0969DA` |
| `--ov-accent-muted` | `rgba(9, 105, 218, 0.15)` |
| `--ov-accent-subtle` | `rgba(9, 105, 218, 0.08)` |

### Status

| Role | Emphasis | Default | Muted |
|------|----------|---------|-------|
| Success | `#1A7F37` | `#1A7F37` | `rgba(26, 127, 55, 0.10)` |
| Warning | `#9A6700` | `#9A6700` | `rgba(154, 103, 0, 0.10)` |
| Danger | `#CF222E` | `#CF222E` | `rgba(207, 34, 46, 0.10)` |
| Info | `#0969DA` | `#0969DA` | `rgba(9, 105, 218, 0.10)` |

### Borders

| Token | Value |
|-------|-------|
| `--ov-border-default` | `rgba(0, 0, 0, 0.10)` |
| `--ov-border-muted` | `rgba(0, 0, 0, 0.06)` |
| `--ov-border-emphasis` | `rgba(0, 0, 0, 0.16)` |

---

## High Contrast

An accessibility-focused theme with amplified visual differences for users who need stronger contrast.

### Key Differences from Omniview Dark

| Aspect | Standard Dark | High Contrast |
|--------|--------------|---------------|
| Text opacity (default) | 92% | 100% |
| Text opacity (muted) | 64% | 80% |
| Text opacity (faint) | 44% | 60% |
| Text opacity (disabled) | 28% | 40% |
| Border opacity (default) | 8% | 16% |
| Border opacity (emphasis) | 14% | 24% |
| Surface luminance steps | ~2-3% | ~5-6% |
| Focus ring width | 2px | 3px |
| Status saturation | Desaturated | Higher saturation |

### Surfaces

| Token | Value |
|-------|-------|
| `--ov-bg-base` | `#010409` |
| `--ov-bg-surface-inset` | `#010409` |
| `--ov-bg-surface` | `#0D1117` |
| `--ov-bg-surface-raised` | `#161B22` |
| `--ov-bg-surface-overlay` | `#1C2128` |

### Text

| Token | Value |
|-------|-------|
| `--ov-fg-default` | `rgba(240, 246, 252, 1.00)` |
| `--ov-fg-muted` | `rgba(240, 246, 252, 0.80)` |
| `--ov-fg-faint` | `rgba(240, 246, 252, 0.60)` |
| `--ov-fg-disabled` | `rgba(240, 246, 252, 0.40)` |

### Borders

| Token | Value |
|-------|-------|
| `--ov-border-default` | `rgba(255, 255, 255, 0.16)` |
| `--ov-border-muted` | `rgba(255, 255, 255, 0.10)` |
| `--ov-border-emphasis` | `rgba(255, 255, 255, 0.24)` |
