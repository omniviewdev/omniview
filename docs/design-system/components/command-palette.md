# Command Palette

The `Cmd+K` command palette is a primary navigation and action tool. It provides quick access to resources, commands, and navigation without leaving the keyboard.

> **Related**: [Elevation](../foundations/06-elevation.md) | [Typography](../foundations/04-typography.md) | [Inputs](./inputs.md)

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Background | Overlay surface | `--ov-bg-surface-overlay` |
| Border | 1px, stronger | `--ov-border-emphasis` |
| Shadow | Large | `--ov-shadow-lg` |
| Border radius | 8px | `--ov-radius-lg` |
| Width | 560px (centered) | — |
| Max height | 400px | — |

---

## Input Area

| Property | Value | Token |
|----------|-------|-------|
| Input text | 14px, regular | `--ov-text-base`, `--ov-fg-default` |
| Placeholder text | Faint | `--ov-fg-faint` |
| Input padding | 12px | `--ov-space-3` |
| Input border-bottom | 1px | `--ov-border-default` |
| Search icon | 20px | `--ov-icon-md`, `--ov-fg-faint` |

---

## Result Items

| Property | Value | Token |
|----------|-------|-------|
| Item height | 36px | — |
| Item padding | 0 12px | `--ov-space-3` |
| Item text | 14px, regular | `--ov-text-base`, `--ov-fg-default` |
| Item description | 12px | `--ov-text-sm`, `--ov-fg-muted` |
| Hover background | Hover overlay | `rgba(255,255,255,0.04)` |
| Selected background | Accent subtle | `--ov-accent-subtle` |
| Item icon | 16px | `--ov-icon-sm`, `--ov-fg-muted` |

### Result Item Structure

```
┌──────────────────────────────────────────────────┐
│  🔍  Search pods, services, commands...          │
├──────────────────────────────────────────────────┤
│  📦  coredns-6f6b679f8f       kube-system   ⌘↩  │ ← selected
│  📦  etcd-minikube            kube-system        │
│  ⚙  kubectl apply             Command            │
│  📄  deployments              Resource Type       │
└──────────────────────────────────────────────────┘
```

### Result Categories

Results are grouped by type with category headers:

| Element | Style |
|---------|-------|
| Category header | `--ov-text-xs`, `--ov-weight-semibold`, `--ov-fg-faint`, uppercase |
| Category separator | 1px `--ov-border-muted` above the header |

---

## Keyboard Shortcuts

| Property | Value | Token |
|----------|-------|-------|
| Shortcut text | Monospace | `--ov-font-mono`, `--ov-text-xs` |
| Shortcut color | Faint | `--ov-fg-faint` |
| Key indicator bg | Slightly raised | `--ov-bg-surface-raised` |
| Key indicator padding | 2px 4px | — |
| Key indicator radius | 3px | — |

```css
.keyboard-shortcut {
  font-family: var(--ov-font-mono);
  font-size: var(--ov-text-xs);
  color: var(--ov-fg-faint);
  background: var(--ov-bg-surface-raised);
  padding: 2px 4px;
  border-radius: 3px;
}
```

---

## Open / Close

- Trigger: `Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux)
- Open animation: Fade in + slight scale up (0.96 → 1.0), `--ov-duration-normal`
- Close: `Escape` key, click outside, or selecting a result
- Close animation: Fade out, `--ov-duration-fast`
- Backdrop: Semi-transparent black overlay (`rgba(0, 0, 0, 0.5)`)

---

## Empty State

When no results match the search:

- Centered text: "No results found"
- Color: `--ov-fg-muted`
- Font: `--ov-text-sm`
- Optional: Suggested actions or help text below

> See [Motion](../foundations/09-motion.md) for animation details.
