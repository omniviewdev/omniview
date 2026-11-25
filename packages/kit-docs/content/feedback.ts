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
  },
  KeyHint: {
    category: 'Primitives',
    summary: 'Displays a keyboard shortcut in the surrounding typography and color.',
    guidance: [
      'Supply the platform’s shortcut notation in keys. KeyHint keeps the chord left-to-right but does not format it or bind keys.',
      'Use spokenKeys when shortcut glyphs do not read clearly, and label when the action needs text beside the chord.',
    ],
  },
  Notice: {
    category: 'Primitives',
    summary: 'An inline message in a box tinted by its tone.',
    guidance: [
      'Pick tone for the status glyph and colors: info, success, warning, or error. Write the message as a string; an optional title leads it.',
      'Add live="alert" for a problem that appears after an action, or "status" for a result. Without live, the notice is plain content.',
      'Put at most two compact Buttons in actions, such as Retry.',
    ],
  },
} satisfies Record<string, Guide>;
