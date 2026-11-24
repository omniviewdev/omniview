import type { Guide } from './catalog.ts';

export const entries = {
  Chip: {
    category: 'Primitives',
    summary: 'A compact label with an optional count and tone. It can be static, actionable, or removable.',
    guidance: [
      'Use a static chip for a label or tally. Keep zero when it is a real count, and name the state in text rather than relying on tone.',
      'Use onClick for an action. Supply pressed for a toggle so the native button exposes its state through aria-pressed.',
      'Use onRemove instead of onClick for a removable chip. The chip itself remains text, with a separate Remove button named for the chip.',
      'Keep labels short. Chip text can ellipsize, so supply a tooltip yourself if the full label needs to be visible.',
    ],
    tokens: [
      { name: '--ov-border-subtle', label: 'Default static border', property: 'border-color' },
      { name: '--ov-border-control', label: 'Default action and removable border', property: 'border-color' },
      { name: '--ov-radius-control', label: 'Corner radius', property: 'border-radius' },
      { name: '--ov-success-bg', label: 'Success tone fill', property: 'background-color' },
      { name: '--ov-warning-bg', label: 'Warning tone fill', property: 'background-color' },
      { name: '--ov-error-bg', label: 'Error tone fill', property: 'background-color' },
      { name: '--ov-info-bg', label: 'Information tone fill', property: 'background-color' },
      { name: '--ov-bg-inline', label: 'Muted tone fill', property: 'background-color' },
      { name: '--ov-control-height', label: 'Action and removable minimum height', property: 'min-height' },
      { name: '--ov-selection-inactive', label: 'Pressed fill', property: 'background-color' },
      { name: '--ov-accent', label: 'Focus outline', property: 'outline-color' },
    ],
  },
  Icon: {
    category: 'Primitives',
    summary: 'A decorative SVG from Kit’s glyph registry, available at 12, 16, and 20 pixels.',
    guidance: [
      'Use the default 16-pixel glyph beside text, 12 pixels for small details, and 20 pixels for a toolbar button glyph.',
      'Put the accessible name on the surrounding control or in visible text. Icon is hidden from assistive technology and does not receive pointer events.',
      'Registry glyphs use the current text color, fixed artwork colors, or theme colors, depending on the glyph layer.',
    ],
    tokens: [
      { name: '--ov-icon-chevron', label: 'Pinned chevron stroke', property: 'stroke' },
      { name: '--ov-icon-success', label: 'Success glyph fill', property: 'fill' },
      { name: '--ov-icon-error', label: 'Error glyph fill', property: 'fill' },
      { name: '--ov-icon-info', label: 'Information glyph fill', property: 'fill' },
      { name: '--ov-icon-warning', label: 'Warning glyph fill', property: 'fill' },
      { name: '--ov-icon-warning-mark', label: 'Warning glyph mark', property: 'fill' },
    ],
  },
  MiddleEllipsis: {
    category: 'Primitives',
    summary: 'Fits a name in a narrow space while preserving the distinguishing suffix of a long name.',
    guidance: [
      'Place it in a width-constrained cell or row and pass the full name. Names shorter than 13 characters truncate at the end instead.',
      'Set tail when a known suffix distinguishes similar names. The default keeps a third of a long name, between 6 and 12 characters.',
      'The full name remains available once as real text for assistive technology and copying. TooltipHost can show it when the name is clipped.',
    ],
    tokens: [],
  },
  MissingValue: {
    category: 'Primitives',
    summary: 'A muted em dash for a value that is missing or does not apply.',
    guidance: [
      'Use it for absent data, not for zero or a real boolean value. It fits the surrounding text size and line height.',
      'The dash has the accessible name Not applicable by default. Pass name to describe a different kind of absence.',
      'Pass reason when the cause matters. It becomes part of the accessible name rather than relying on a tooltip.',
    ],
    tokens: [
      { name: '--ov-fg-muted', label: 'Dash color', property: 'color' },
      { name: '--ov-font-ui', label: 'Dash font family', property: 'font-family' },
      { name: '--ov-font-features', label: 'Dash font features', property: 'font-feature-settings' },
    ],
  },
  Stack: {
    category: 'Primitives',
    summary: 'A flex container for arranging children in a column or row using Kit spacing.',
    guidance: [
      'Use the default column for vertical flow or direction="row" for horizontal flow.',
      'Use gap between children and pad inside the container. Both use the same closed scale: 2, 4, 6, 8, 12, 16, 20, and 24.',
      'Use align on the cross axis and justify on the main axis. Stack renders a div, so add semantic elements where the content needs them.',
    ],
    tokens: ([2, 4, 6, 8, 12, 16, 20, 24] as const).map((step) => ({
      name: `--ov-spacing-${step}` as const,
      label: `Gap and padding step ${step}`,
      property: 'padding',
    })),
  },
  Status: {
    category: 'Primitives',
    summary: 'Pairs the platform’s state word with a consistent glyph for its semantic role.',
    guidance: [
      'Keep the platform’s original label. Map the state to a Kit role instead of supplying a custom glyph.',
      'Use healthy for a good verdict and running for an active lifecycle state without a verdict. Use progress with queued for work waiting to start.',
      'Use attention when something needs a look, error for failure, stopped for an inactive state without failure, and info for informational messages.',
      'Keep the meaning in the label; the glyph is decorative. Yes, no, true, and false render as plain text without a glyph.',
    ],
    tokens: [
      { name: '--ov-spacing-4', label: 'Glyph and text gap', property: 'gap' },
      { name: '--ov-fg', label: 'State label color', property: 'color' },
      { name: '--ov-icon', label: 'Contextual glyph color', property: 'color' },
      { name: '--ov-fs-13', label: 'State label size', property: 'font-size' },
      { name: '--ov-lh-16', label: 'State label line height', property: 'line-height' },
    ],
  },
  StatusSummary: {
    category: 'Primitives',
    summary: 'A compact overview of related statuses, values, and facts that wraps when needed.',
    guidance: [
      'Give the group a descriptive label, such as Orders API status. Supply items in reading order; an empty array renders nothing.',
      'Use status for a glyph and state label, value for a bold quantity with an optional label, and text for a plain fact.',
      'Use tone on value and text items as a secondary cue. Assistive technology reads the items and skips the separator dots.',
    ],
    tokens: [
      { name: '--ov-spacing-4', label: 'Row gap', property: 'row-gap' },
      { name: '--ov-spacing-8', label: 'Column gap', property: 'column-gap' },
      { name: '--ov-fg-muted', label: 'Separator and muted item color', property: 'color' },
      { name: '--ov-success-fg', label: 'Success item color', property: 'color' },
      { name: '--ov-warning-fg', label: 'Warning item color', property: 'color' },
      { name: '--ov-error-fg', label: 'Error item color', property: 'color' },
      { name: '--ov-link', label: 'Information item color', property: 'color' },
    ],
  },
  TagList: {
    category: 'Primitives',
    summary: 'A labeled group of wrapping metadata tags, with optional values and a disclosure for longer lists.',
    guidance: [
      'Use a descriptive group label, such as Labels or Annotations. Omit value for a key-only tag. Tags are text, not buttons.',
      'Long values truncate, while long keys keep their suffix. Keys longer than 38 characters get a separate chip for the value when one is supplied.',
      'The list shows six tags by default. Set visible to change the limit or defaultExpanded to start open. The native Show all / Show fewer button exposes its expanded state.',
    ],
    tokens: [
      { name: '--ov-spacing-8', label: 'Spacing between tags', property: 'gap' },
      { name: '--ov-border-subtle', label: 'Tag border', property: 'border-color' },
      { name: '--ov-radius-control', label: 'Tag and disclosure corners', property: 'border-radius' },
      { name: '--ov-font-code', label: 'Tag font family', property: 'font-family' },
      { name: '--ov-bg-inline', label: 'Key background', property: 'background-color' },
      { name: '--ov-link', label: 'Disclosure text color', property: 'color' },
      { name: '--ov-accent', label: 'Disclosure focus outline', property: 'outline-color' },
    ],
  },
  Text: {
    category: 'Primitives',
    summary: 'Renders text in Kit’s heading, title, body, or caption style without tying visual size to document structure.',
    guidance: [
      'Use variant for visual hierarchy and as for semantics. Choose h1–h4 according to the document outline, not the desired font size.',
      'Text defaults to a span with the body variant. Use as="p" for paragraphs and tone="muted" for secondary text.',
    ],
    tokens: [
      { name: '--ov-font-ui', label: 'UI font family', property: 'font-family' },
      { name: '--ov-fs-18', label: 'Heading size', property: 'font-size' },
      { name: '--ov-fs-13', label: 'Title and body size', property: 'font-size' },
      { name: '--ov-fs-12', label: 'Caption size', property: 'font-size' },
      { name: '--ov-lh-24', label: 'Heading line height', property: 'line-height' },
      { name: '--ov-lh-16', label: 'Title, body, and caption line height', property: 'line-height' },
      { name: '--ov-fg', label: 'Default text color', property: 'color' },
      { name: '--ov-fg-muted', label: 'Muted text color', property: 'color' },
    ],
  },
} satisfies Record<string, Guide>;
