import { KeyHint, Text } from '@omniviewdev/kit';

/** The shortcut inherits the Search label's type and color. */
export const Shortcut = () => (
  <Text tone="muted">
    Search <KeyHint keys="Ctrl+K" />
  </Text>
);

/** The visible glyphs have spoken words; the action sits beside them. */
export const Action = () => (
  <Text variant="caption" tone="muted">
    <KeyHint keys="⌘↵" spokenKeys="Command Enter" label="Background tab" />
  </Text>
);

/** The pair follows the locale while the chord keeps its left-to-right order. */
export const RightToLeft = () => (
  <div dir="rtl" lang="ar">
    <Text variant="caption" tone="muted">
      <KeyHint keys="Ctrl+Alt+," label="فتح الإعدادات" />
    </Text>
  </div>
);
