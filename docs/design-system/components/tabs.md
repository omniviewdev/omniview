# Tabs

Tabs provide content switching within a panel. They appear in the detail panel (Overview/Editor/Events), the bottom drawer (Logs/Terminal/Build), and resource views.

> **Related**: [Typography](../foundations/04-typography.md) | [Interactive States](../patterns/interactive-states.md) | [Motion](../foundations/09-motion.md)

---

## Design Rules

| Property | Value | Token |
|----------|-------|-------|
| Tab height | 36px | — |
| Tab font size | 12px | `--ov-text-sm` |
| Tab font weight | Medium (500) | `--ov-weight-medium` |
| Inactive tab text | Muted | `--ov-fg-muted` |
| Active tab text | Default (bright) | `--ov-fg-default` |
| Active indicator | 2px bottom border | `--ov-accent` |
| Tab background | Transparent | Inherits from bar |
| Tab bar background | Surface | `--ov-bg-surface` |
| Tab bar bottom border | 1px | `--ov-border-default` |
| Tab horizontal padding | 12px | `--ov-space-3` |
| Close button | Faint, hover-only | `--ov-fg-faint` |

---

## Tab States

| State | Text Color | Background | Indicator |
|-------|-----------|------------|-----------|
| Inactive | `--ov-fg-muted` | Transparent | None |
| Hover | `--ov-fg-default` | `rgba(255,255,255,0.04)` | None |
| Active | `--ov-fg-default` | Transparent | 2px bottom `--ov-accent` |
| Focused (keyboard) | `--ov-fg-default` | Transparent | 2px accent outline |
| Disabled | `--ov-fg-disabled` | Transparent | None |

---

## Tab Bar Structure

```
┌────────────────────────────────────────────────────────┐
│  Overview      Editor      Events      YAML            │
│  ═══════                                               │ ← 2px accent indicator
├────────────────────────────────────────────────────────┤
│                                                        │ ← 1px border-default
│  Tab content area                                      │
```

---

## Close Buttons

For closeable tabs (like resource editor tabs):

- Close button (×) appears only on hover of the tab
- Size: 16px icon area
- Color: `--ov-fg-faint` default, `--ov-fg-default` on hover
- Position: Right side of the tab label, with 4px gap

```css
.tab-close {
  opacity: 0;
  color: var(--ov-fg-faint);
  width: 16px;
  height: 16px;
  transition: opacity var(--ov-duration-fast);
}

.tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  color: var(--ov-fg-default);
}
```

---

## Tab Overflow

When there are more tabs than the bar can display:

- Show left/right scroll arrows at the edges
- Or use a dropdown "more" menu for overflow tabs
- Scroll arrows use `--ov-fg-faint`, brightening on hover
- The active tab should always be scrolled into view

---

## Content Transitions

When switching tabs:

- Duration: `--ov-duration-normal` (200ms)
- Technique: Fade transition (opacity 0 → 1) on the content area
- No horizontal slide — keep it simple and fast
- Data-heavy content (tables, YAML) should appear instantly without animation

> See [Motion](../foundations/09-motion.md) for animation rules.
