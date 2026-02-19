# Theme Customization

Omniview's theme system allows users to customize the visual appearance by overriding design tokens. The three-tier token architecture makes this powerful yet simple — users override semantic tokens, and all components automatically reflect the changes.

> **Related**: [Token Architecture](../foundations/02-token-architecture.md) | [Creating Themes](./creating-themes.md) | [Built-in Themes](./built-in-themes.md)

---

## User-Facing Theme API

Users can customize Omniview's appearance through:

1. **Built-in themes**: "Omniview Dark" (default), "Omniview Light", "High Contrast"
2. **User overrides**: A JSON/JSONC configuration file that overrides any semantic token
3. **Community themes**: Importable theme files that provide complete token sets

---

## Theme File Structure

Theme files live in `~/.omniview/themes/` and use JSON or JSONC format:

```jsonc
// ~/.omniview/themes/my-theme.json
{
  "name": "My Custom Theme",
  "type": "dark",  // "dark" | "light"
  "colors": {
    // Semantic tokens — users never set primitives directly
    "bg.base":           "#0D1117",
    "bg.surface":        "#151B23",
    "bg.surfaceRaised":  "#1A2130",
    "bg.surfaceOverlay": "#1F2937",
    "bg.surfaceInset":   "#10141A",

    "fg.default":        "rgba(236, 240, 246, 0.92)",
    "fg.muted":          "rgba(236, 240, 246, 0.64)",
    "fg.faint":          "rgba(236, 240, 246, 0.44)",
    "fg.accent":         "#79C0FF",

    "accent":            "#58A6FF",
    "success":           "#56D364",
    "warning":           "#E3B341",
    "danger":            "#F47067",
    "info":              "#58A6FF",

    "border.default":    "rgba(255, 255, 255, 0.08)",
    "border.muted":      "rgba(255, 255, 255, 0.05)",

    // Component overrides (optional)
    "editor.bg":         "#0D1117",
    "terminal.bg":       "#010409",
    "sidebar.bg":        "#10141A"
  },
  "typography": {
    "fontFamily":     null,  // null = use default system stack
    "monoFontFamily": null,  // null = use default mono stack
    "fontSize":       14     // base size in px
  }
}
```

### Token Naming in Theme Files

Theme files use dot-notation that maps to CSS custom property names:

| Theme File Key | CSS Custom Property |
|---------------|-------------------|
| `bg.base` | `--ov-bg-base` |
| `bg.surface` | `--ov-bg-surface` |
| `fg.default` | `--ov-fg-default` |
| `border.default` | `--ov-border-default` |
| `editor.bg` | `--ov-editor-bg` |

---

## Theme Resolution Order

```
Component tokens  →  User overrides  →  Built-in theme  →  Primitive defaults
(most specific)                                            (least specific)
```

This means:
- A user can override just `accent` to change the accent color everywhere
- Or override `sidebar.bg` to change only the sidebar background
- Unspecified tokens fall through to the built-in theme defaults

---

## Runtime Theme Application

Themes are applied by setting CSS custom properties on the document root:

```typescript
function applyTheme(theme: OmniviewTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.type); // 'dark' | 'light'

  for (const [token, value] of Object.entries(theme.resolvedTokens)) {
    root.style.setProperty(`--ov-${token}`, value);
  }
}
```

### Theme Switching

- Themes can be switched at runtime without page reload
- The transition between themes uses a brief fade (`--ov-duration-normal`)
- All components automatically pick up new token values via CSS custom properties

---

## Partial Overrides

Users don't need to specify every token. A partial theme only overrides what it changes:

```jsonc
// A minimal theme that just changes the accent color
{
  "name": "Purple Accent",
  "type": "dark",
  "colors": {
    "accent": "#A371F7"
  }
}
```

All other tokens fall through to the base "Omniview Dark" theme.

---

## Validation

Theme files are validated at load time:

- Color values must be valid CSS color strings (hex, rgb, rgba, hsl, hsla)
- `type` must be `"dark"` or `"light"`
- Unknown keys are ignored (forward compatibility)
- Invalid values log a warning and fall through to defaults
- Theme names must be unique

> See [Creating Themes](./creating-themes.md) for a step-by-step guide.
