# Creating Themes

This guide walks through creating a custom Omniview theme from scratch.

> **Related**: [Customization](./customization.md) | [Built-in Themes](./built-in-themes.md) | [Color](../foundations/03-color.md)

---

## Step 1: Choose a Base

Start with the built-in theme closest to your vision:

- **Omniview Dark** — Cool-neutral dark, most themes will start here
- **Omniview Light** — Light theme base
- **High Contrast** — Amplified differences for visibility

Copy the base theme file and modify it.

---

## Step 2: Define Your Neutral Scale

The neutral scale is the foundation. Choose 14 steps from darkest to lightest (for dark themes):

```jsonc
{
  "name": "My Theme",
  "type": "dark",
  "colors": {
    // Step 0 (deepest background) through Step 13 (brightest text)
    "bg.base":           "#0B0E14",   // Your deepest background
    "bg.surfaceInset":   "#0E1119",   // Inset surfaces
    "bg.surface":        "#131820",   // Main content area
    "bg.surfaceRaised":  "#181E28",   // Sidebars, panels
    "bg.surfaceOverlay": "#1E2530"    // Dropdowns, modals
  }
}
```

### Guidelines

- Each surface step should be 2-3% lighter than the previous
- Keep the hue consistent across the scale (all cool-blue, all warm-gray, etc.)
- Test that the darkest and lightest steps are at least 4-5 steps apart in perceived brightness

---

## Step 3: Set Text Colors

Use the opacity approach with your chosen base color:

```jsonc
{
  "colors": {
    // Pick a light base color that matches your neutral hue
    "fg.default":   "rgba(230, 237, 243, 0.92)",
    "fg.muted":     "rgba(230, 237, 243, 0.64)",
    "fg.faint":     "rgba(230, 237, 243, 0.44)"
  }
}
```

### Verify Contrast

Check these minimum ratios against your `bg.surface`:

| Text Level | Required Ratio |
|-----------|---------------|
| `fg.default` | 7:1 (WCAG AAA) |
| `fg.muted` | 4.5:1 (WCAG AA) |
| `fg.faint` | 3:1 (WCAG AA Large) |

Use a tool like [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) or the built-in contrast checker in browser DevTools.

---

## Step 4: Choose an Accent Color

The accent color appears in focus rings, active tabs, selected items, and primary buttons:

```jsonc
{
  "colors": {
    "accent": "#A371F7"  // Example: purple accent
  }
}
```

### Accent Guidelines

- Must have at least 3:1 contrast against `bg.surface`
- Should feel vibrant but not overwhelming
- Will be used at multiple opacities (10%, 20%, 100%) automatically
- Common choices: blue, purple, teal, green

---

## Step 5: Set Status Colors (Optional)

If the default status colors don't match your palette, override them:

```jsonc
{
  "colors": {
    "success": "#56D364",
    "warning": "#E3B341",
    "danger":  "#F47067",
    "info":    "#58A6FF"
  }
}
```

Each status color is used for text/icons. The system automatically generates muted and emphasis variants.

---

## Step 6: Set Borders (Optional)

```jsonc
{
  "colors": {
    "border.default": "rgba(255, 255, 255, 0.08)",
    "border.muted":   "rgba(255, 255, 255, 0.05)"
  }
}
```

---

## Step 7: Component Overrides (Optional)

For fine-grained control over specific components:

```jsonc
{
  "colors": {
    "sidebar.bg":  "#0E1119",
    "editor.bg":   "#0B0E14",
    "terminal.bg": "#080A0F"
  }
}
```

---

## Step 8: Typography (Optional)

```jsonc
{
  "typography": {
    "fontFamily": "'Inter', -apple-system, sans-serif",
    "monoFontFamily": "'JetBrains Mono', 'SF Mono', monospace",
    "fontSize": 14
  }
}
```

---

## Step 9: Test Your Theme

1. Place the file in `~/.omniview/themes/my-theme.json`
2. Select it in Omniview's appearance settings
3. Verify:
   - [ ] Text is readable at all three tiers
   - [ ] Status colors are distinguishable
   - [ ] Focus rings are visible
   - [ ] Sidebar/content/detail panel boundaries are clear
   - [ ] Inputs are distinguishable from their background
   - [ ] The accent color doesn't clash with status colors

---

## Example: Solarized Dark

```jsonc
{
  "name": "Solarized Dark",
  "type": "dark",
  "colors": {
    "bg.base":           "#002B36",
    "bg.surfaceInset":   "#001F27",
    "bg.surface":        "#073642",
    "bg.surfaceRaised":  "#0A4050",
    "bg.surfaceOverlay": "#0D4D5E",

    "fg.default":   "rgba(253, 246, 227, 0.92)",
    "fg.muted":     "rgba(253, 246, 227, 0.64)",
    "fg.faint":     "rgba(253, 246, 227, 0.44)",

    "accent":  "#268BD2",
    "success": "#859900",
    "warning": "#B58900",
    "danger":  "#DC322F",
    "info":    "#2AA198"
  }
}
```

---

## Sharing Themes

Community themes can be shared as JSON files. Include:
- A descriptive `name`
- The correct `type` (`dark` or `light`)
- All semantic color tokens (don't rely on users having a specific base theme)
- A README or screenshot showing the theme in action

> See [Built-in Themes](./built-in-themes.md) for the complete specs of the default themes.
