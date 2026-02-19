# Log / Terminal Panel

The log panel displays streaming output from pods, build processes, and development servers. It's one of the most frequently viewed surfaces in the IDE.

> **Related**: [Typography](../foundations/04-typography.md) | [Color](../foundations/03-color.md) | [Elevation](../foundations/06-elevation.md)

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Background | Darkest surface level (inset) | `--ov-terminal-bg` → `--ov-bg-surface-inset` |
| Font family | Monospace | `--ov-font-mono` |
| Font size | 13px | `--ov-mono-size` |
| Line height | 1.54 (~20px) | `--ov-mono-leading` |
| Default text color | Primary | `--ov-fg-default` |
| Timestamp color | Very dim | `--ov-fg-faint` |
| Source label font size | 11px | `--ov-text-xs` |
| Source label color | Muted | `--ov-fg-muted` |
| Default height | 280px | `--ov-bottom-drawer-height` |
| Horizontal padding | 12px | `--ov-space-3` |

---

## Log Line Structure

```
[timestamp] [source] message content here
```

### Timestamp

- Font: `--ov-font-mono`, `--ov-text-xs` (11px)
- Color: `--ov-fg-faint` (very dim — timestamps are metadata, not content)
- Format: `HH:mm:ss` for today, `MM-DD HH:mm:ss` for older entries

### Source Label

**Do**: Show as plain bracketed text in a muted color:
```
10:41:23  [vite]      HMR update: /src/App.tsx
10:41:24  [etcd]      compacted revision 1234
```

**Don't**: Use colored badge chips for source labels. The current colored badges (like `vite` in red) create visual noise in every log line. The source is metadata, not the focus.

```css
.log-source {
  font-size: var(--ov-text-xs);
  color: var(--ov-fg-muted);
  font-family: var(--ov-font-mono);
  min-width: 80px;  /* Align message content */
}
```

### Message Content

- Font: `--ov-font-mono`, 13px
- Color: `--ov-fg-default`
- Long lines: Wrap or horizontal scroll (user preference)

---

## Log Level Colors

| Level | Text Color | Notes |
|-------|-----------|-------|
| Info / Default | `--ov-fg-default` | Standard log output |
| Debug | `--ov-fg-faint` | De-emphasized |
| Warning | `--ov-warning-default` | Yellow text for the message |
| Error | `--ov-danger-default` | Red text for the message |
| Fatal | `--ov-danger-default` | Red text, potentially bold |

Only the **message text** changes color for log levels. The timestamp and source label remain in their standard muted colors.

---

## Terminal Mode

When used as an interactive terminal (shell access):

| Property | Value |
|----------|-------|
| Background | `--ov-bg-surface-inset` (same as logs) |
| Cursor | Block cursor, `--ov-fg-default` |
| Selection background | `--ov-accent-muted` |
| Prompt text | `--ov-fg-muted` |
| Command text | `--ov-fg-default` |
| Output text | `--ov-fg-default` |

---

## Panel Controls

The log/terminal panel header (when in the bottom drawer):

| Element | Style |
|---------|-------|
| Panel title | `--ov-text-sm`, `--ov-weight-medium`, `--ov-fg-default` |
| Tab buttons (Logs, Terminal, Build) | Standard tab styling |
| Clear button | Ghost button, `--ov-fg-muted` |
| Scroll-to-bottom | Ghost button, appears when scrolled up |
| Resize handle | 4px tall, `--ov-border-muted`, cursor: row-resize |

---

## Search in Logs

| Property | Value |
|----------|-------|
| Search bar background | `--ov-bg-surface-overlay` |
| Match highlight | `--ov-warning-muted` background |
| Current match | `--ov-warning-default` background with stronger highlight |
| Match count | `--ov-fg-muted`, `--ov-text-xs` |

> See [Inputs](./inputs.md) for search input styling.
