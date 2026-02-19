# Component Patterns

This directory documents the recurring UI components in Omniview. Each document describes the component's structure, design rules, token usage, and do/don't guidance.

## Inventory

| Component | Status | Document |
|-----------|--------|----------|
| [Data Table](./data-table.md) | Defined | Resource list tables (pods, deployments, nodes) |
| [Sidebar](./sidebar.md) | Defined | Tree navigation, resource browser |
| [Detail Panel](./detail-panel.md) | Defined | Right inspector panel, metadata display |
| [Log / Terminal](./log-terminal.md) | Defined | Log panel, terminal output, build output |
| [Tabs](./tabs.md) | Defined | Tab bars for content switching |
| [Buttons](./buttons.md) | Defined | Button variants (primary, secondary, ghost, danger) |
| [Badges](./badges.md) | Defined | Badge/chip patterns for categorization |
| [Inputs](./inputs.md) | Defined | Text inputs, search, select, form controls |
| [Command Palette](./command-palette.md) | Defined | Cmd+K search, navigation, actions |

## Conventions

All component documents follow a consistent format:

1. **Overview** — What the component is and when to use it
2. **Structure** — ASCII diagram of the component layout
3. **Design Rules** — Token-based specs as a table
4. **Do / Don't** — Concrete guidance with before/after examples
5. **Related** — Links to foundation docs and other components

## Token Usage

Components reference **semantic tokens** (`--ov-*`), never primitive values. Where a component needs a specific override, it uses a **component token** that defaults to a semantic token:

```css
/* Component token with semantic default */
--ov-sidebar-bg: var(--ov-bg-surface-raised);
```

This allows themes to override the sidebar background independently without affecting other raised surfaces.

> See [Token Architecture](../foundations/02-token-architecture.md) for the three-tier system.
