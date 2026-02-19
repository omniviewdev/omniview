# Token Adoption Guide

This guide explains how to convert existing hardcoded styles to the `--ov-*` design token system. Follow this process when migrating components or writing new ones.

> **Related**: [Token Architecture](../foundations/02-token-architecture.md) | [Joy to Material Migration](./joy-to-material.md) | [Color](../foundations/03-color.md)

---

## The Core Rule

**Never hardcode colors, sizes, or spacing in components.** Every visual value must come from a token.

```tsx
// ❌ Hardcoded
<Box sx={{ bgcolor: '#1A2130', color: '#CBD5E1', p: '12px' }}>

// ✅ Token-based
<Box sx={{ bgcolor: 'var(--ov-bg-surface-raised)', color: 'var(--ov-fg-default)', p: 'var(--ov-space-3)' }}>
```

---

## Step-by-Step Conversion

### 1. Identify Hardcoded Values

Search for these patterns in your component files:

```bash
# Hex colors
grep -rn '#[0-9A-Fa-f]\{3,8\}' ui/components/

# rgb/rgba values
grep -rn 'rgba\?\s*(' ui/components/

# Pixel values in sx props
grep -rn "p:\s*['\"][0-9]" ui/components/

# Inline style objects
grep -rn 'style={{' ui/components/
```

### 2. Map to Semantic Tokens

For each hardcoded value, determine its purpose and find the matching semantic token:

#### Colors → Background Tokens

| Hardcoded Value | Likely Purpose | Token |
|----------------|---------------|-------|
| Dark gray (#1a1a2e, #0d1117, etc.) | Background | `--ov-bg-base` or `--ov-bg-surface` |
| Slightly lighter gray (#1e2024, etc.) | Panel/sidebar bg | `--ov-bg-surface-raised` |
| Dark input bg (#10141a, etc.) | Input background | `--ov-bg-surface-inset` |
| Dropdown/modal bg (#1f2937, etc.) | Overlay bg | `--ov-bg-surface-overlay` |

#### Colors → Text Tokens

| Hardcoded Value | Likely Purpose | Token |
|----------------|---------------|-------|
| Light gray (#CBD5E1, #E2E8F0, etc.) | Primary text | `--ov-fg-default` |
| Medium gray (#94A3B8, #8B9BB5, etc.) | Secondary text | `--ov-fg-muted` |
| Dim gray (#64748B, #6B7D96, etc.) | Tertiary text | `--ov-fg-faint` |
| Very dim (#475569, etc.) | Disabled text | `--ov-fg-disabled` |
| Blue (#58A6FF, #3B82F6, etc.) | Accent/link | `--ov-accent-fg` |

#### Colors → Status Tokens

| Hardcoded Value | Likely Purpose | Token |
|----------------|---------------|-------|
| Green (#22C55E, #10B981, etc.) | Success | `--ov-success-default` |
| Yellow/amber (#F59E0B, #EAB308, etc.) | Warning | `--ov-warning-default` |
| Red (#EF4444, #F87171, etc.) | Error/danger | `--ov-danger-default` |
| Blue (#3B82F6, #60A5FA, etc.) | Info | `--ov-info-default` |

#### Colors → Border Tokens

| Hardcoded Value | Likely Purpose | Token |
|----------------|---------------|-------|
| `rgba(255,255,255,0.1)` or similar | Border | `--ov-border-default` |
| Very subtle white alpha | Subtle divider | `--ov-border-muted` |

### 3. Replace in Code

#### sx prop (MUI)

```tsx
// Before
<Typography sx={{ color: '#CBD5E1', fontSize: '14px' }}>
  {name}
</Typography>

// After
<Typography sx={{ color: 'var(--ov-fg-default)', fontSize: 'var(--ov-text-base)' }}>
  {name}
</Typography>
```

#### Inline styles

```tsx
// Before
<div style={{ backgroundColor: '#151B23', padding: '16px' }}>

// After
<div style={{ backgroundColor: 'var(--ov-bg-surface)', padding: 'var(--ov-space-4)' }}>
```

#### CSS/styled-components

```css
/* Before */
.sidebar {
  background-color: #1A2130;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

/* After */
.sidebar {
  background-color: var(--ov-bg-surface-raised);
  border-right: 1px solid var(--ov-border-default);
}
```

---

## Common Patterns

### Text Hierarchy in a Component

```tsx
// Before: All text similar brightness
<div>
  <span style={{ color: '#E2E8F0' }}>{name}</span>
  <span style={{ color: '#CBD5E1' }}>{namespace}</span>
  <span style={{ color: '#94A3B8' }}>{age}</span>
</div>

// After: Clear three-tier hierarchy
<div>
  <span style={{ color: 'var(--ov-fg-default)' }}>{name}</span>
  <span style={{ color: 'var(--ov-fg-muted)' }}>{namespace}</span>
  <span style={{ color: 'var(--ov-fg-faint)' }}>{age}</span>
</div>
```

### Status Display

```tsx
// Before: High-saturation colored badges
<Chip color="success" variant="solid">Running</Chip>

// After: Quiet colored text
<Typography sx={{ color: 'var(--ov-success-default)' }}>Running</Typography>
```

### Surface Elevation

```tsx
// Before: Drop shadow on a panel
<Paper elevation={4} sx={{ bgcolor: '#1E1E1E' }}>

// After: Background color shift (no shadow)
<Box sx={{ bgcolor: 'var(--ov-bg-surface-raised)' }}>
```

---

## Verification Checklist

After converting a component:

- [ ] No hex colors remaining in the component file
- [ ] No `rgb()` / `rgba()` values (except inside token definitions)
- [ ] All spacing uses `--ov-space-*` tokens
- [ ] All font sizes use `--ov-text-*` tokens
- [ ] Component looks correct in Omniview Dark theme
- [ ] Component adapts when switching themes (if theme switching is available)
- [ ] Text hierarchy follows the three-tier rule

---

## Escape Hatches

In rare cases where no semantic token fits:

1. **Create a component token** that defaults to an existing semantic token:
   ```css
   --ov-my-component-bg: var(--ov-bg-surface-raised);
   ```
2. **Document it** in the component's design doc
3. **Never** hardcode a raw color value — always go through a token

> See [Token Architecture](../foundations/02-token-architecture.md) for the three-tier model.
