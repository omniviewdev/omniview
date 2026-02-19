# Information Hierarchy

The three-tier content rule is the most important pattern in the design system. It ensures every data view has clear visual priority without relying on decoration.

> **Related**: [Principles](../foundations/01-principles.md) | [Color](../foundations/03-color.md) | [Data Table](../components/data-table.md)

---

## The Three-Tier Content Rule

In any data view (table, detail panel, log), categorize every piece of information into one of three tiers:

| Tier | Token | Opacity | Weight | Examples |
|------|-------|---------|--------|----------|
| **Primary** | `--ov-fg-default` | 92% | Regular | Resource name, status, primary identifier |
| **Secondary** | `--ov-fg-muted` | 64% | Regular | Namespace, labels, image, ownership |
| **Tertiary** | `--ov-fg-faint` | 44% | Regular | Age, version, UID, timestamps, counts |

**Rule**: If you can't decide which tier something belongs to, it's probably Tertiary. Promote sparingly.

### Why Opacity Instead of Distinct Colors?

Using a single base color (`#ECF0F6`) at different opacities:

1. **Adapts to any surface** — text automatically works on hover states, selected rows, different panels
2. **Maintains consistent temperature** — all text feels cool-neutral regardless of tier
3. **Simplifies theming** — change one base color to shift all text tiers
4. **Matches Apple/GitHub pattern** — proven at scale in professional tools

---

## Column Priority in Tables

For resource tables, columns should be ordered and sized by importance:

```
| ★ Name (wide)  | Namespace | Status | Age    | ··· |
  Primary text     Muted      Colored  Faint    Overflow
  Left-aligned     Left       Left     Right    Icon menu
```

### Column Ordering Rules

1. **Name** — Always first, always widest. Gets the brightest text (`--ov-fg-default`).
2. **Status** — The second most important. Gets semantic color (green/yellow/red).
3. **Namespace** — Useful for filtering context, not for scanning. Muted (`--ov-fg-muted`).
4. **Type/Kind** — Categorical context. Muted.
5. **Age** — Purely contextual. Faint (`--ov-fg-faint`). Right-aligned.
6. **Additional columns** — Hidden behind a column picker or horizontal scroll.

### Column Width Guidelines

| Column Type | Width Strategy |
|-------------|---------------|
| Name | Wide (flex: 2 or more). Primary scanning column. |
| Status | Fixed width (~100px). Short text values. |
| Namespace | Medium (~120px). Semi-fixed. |
| Numeric (CPU, memory) | Narrow (~80px). Right-aligned. |
| Age | Narrow (~60px). Right-aligned. |
| Actions | Fixed narrow (~40px). Icon menu. |

---

## Detail Panel Key-Value Pairs

For key-value metadata (Name: coredns, Namespace: kube-system):

| Element | Color | Width |
|---------|-------|-------|
| Key (left) | `--ov-fg-muted` | Fixed 100-120px for vertical alignment |
| Value (right) | `--ov-fg-default` | Natural width, wrapping if needed |

**Spacing between pairs**: 6px vertical.

Align all keys to the same width so values start at a consistent left edge. This enables fast vertical scanning of the value column.

```
Name         coredns-6f6b679f8f-dtg5b     ← value column aligns
Namespace    kube-system                    ← easy to scan vertically
Created      today at 2:41 PM
Node         minikube
```

---

## Applying the Rule

### Before (flat — no hierarchy)

```
All text at the same brightness:
  coredns-dtg5b  kube-system  Running  20h  2/2  6f6b679f8f
```

Everything competes for attention. The user's eye has no landing point.

### After (three-tier hierarchy)

```
  coredns-dtg5b    kube-system   Running    20h
  ─── bright ───   ─ muted ──   ─ green ─  ─ faint ─
```

The name jumps out first. Status is immediately scannable by color. Namespace provides context without demanding attention. Age is available but quiet.

---

## Exceptions

There are situations where the three-tier rule is adjusted:

| Situation | Adjustment |
|-----------|------------|
| **Error state** | Status text in `--ov-danger-default` draws more attention than the name |
| **Search results** | Matching text highlighted, non-matching text all becomes muted |
| **Selected row** | All text slightly brighter due to accent-tinted background |
| **Section headers** | Use uppercase + letter-spacing at `--ov-fg-muted` as landmarks |

> See [Status System](./status-system.md) for how status visual weight interacts with hierarchy.
