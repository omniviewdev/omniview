import type { Guide } from './catalog.ts';

export const entries = {
  EmptyState: {
    category: 'Layout',
    summary: 'Explains why a surface is empty and what can appear there.',
    guidance: [
      'Name what is missing in the title. Use the hint to explain what appears here and how it gets here.',
      'Offer one action only if it leads out of the empty state.',
      'Use compact in shallow surfaces to replace the icon box with a bare glyph and the caption with body text.',
      'The owning view controls placement, announcements, and focus.',
    ],
    tokens: [
      { name: '--ov-spacing-8', label: 'Default gap', property: 'gap' },
      { name: '--ov-spacing-12', label: 'Compact gap', property: 'gap' },
      { name: '--ov-fg-muted', label: 'Muted foreground', property: 'color' },
      { name: '--ov-icon', label: 'Default icon foreground', property: 'color' },
    ],
  },
  ProgressBar: {
    category: 'Primitives',
    summary: 'A thin track for measured progress or work with an unknown total.',
    guidance: [
      'Name the work with label. It is not visible, so place any visible status beside the bar.',
      'Pass a percentage for measured work or indeterminate when progress cannot be measured. Use valueText for units such as “2 of 5 files”.',
      'Keep the last measured value when paused. The paused prop changes the fill and stops motion; supply the paused status yourself.',
      'Indeterminate progress uses a stripe by default. Set indeterminateMotion to sweep for a moving segment. Both respect reduced motion.',
    ],
    tokens: [
      { name: '--ov-radius-mark', label: 'Track and fill radius', property: 'border-radius' },
      { name: '--ov-progress-track', label: 'Track background', property: 'background-color' },
      { name: '--ov-accent', label: 'Active fill', property: 'background-color' },
      { name: '--ov-fg-secondary', label: 'Paused fill', property: 'background-color' },
      { name: '--ov-link', label: 'Animated stripe highlight', property: 'background-image' },
    ],
  },
  KeyHint: {
    category: 'Primitives',
    summary: 'Displays a keyboard shortcut in the surrounding typography and color.',
    guidance: [
      'Supply the platform’s shortcut notation in keys. KeyHint keeps the chord left-to-right but does not format it or bind keys.',
      'Use spokenKeys when shortcut glyphs do not read clearly, and label when the action needs text beside the chord.',
    ],
    tokens: [
      { name: '--ov-spacing-4', label: 'Gap between chord and label', property: 'gap' },
    ],
  },
} satisfies Record<string, Guide>;
