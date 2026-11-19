import { IconButton, Stack, Text } from '@omniviewdev/kit';
import { useState } from 'react';

// A toggle written the way a consumer writes it: the caller owns the pressed state.
function StatefulToggle({ initial = false }: { readonly initial?: boolean }) {
  const [pressed, setPressed] = useState(initial);
  return (
    <IconButton
      icon="case-sensitive"
      label="Match case"
      variant="ghost"
      pressed={pressed}
      onClick={() => {
        setPressed(!pressed);
      }}
    />
  );
}

/** The neutral outlined square: the page header's utility command. */
export const Secondary = () => <IconButton icon="refresh" label="Refresh items" />;

/** The quiet square of a toolbar. */
export const Ghost = () => <IconButton icon="refresh" label="Refresh items" variant="ghost" />;

export const Primary = () => <IconButton icon="refresh" label="Refresh items" variant="primary" />;

export const Danger = () => <IconButton icon="close" label="Clear selection" tone="danger" />;

export const GhostDanger = () => <IconButton icon="close" label="Clear selection" variant="ghost" tone="danger" />;

/** Unavailable for a reason: focusable, painted with the disabled roles, described by its reason. */
export const SecondaryDisabled = () => <IconButton icon="refresh" label="Refresh items" disabledReason="Refreshing" />;

export const GhostDisabled = () => <IconButton icon="refresh" label="Refresh items" variant="ghost" disabledReason="Refreshing" />;

/** The Refresh command of a page header: while a read runs it says why, in text beside it. */
export const DisabledWithVisibleReason = () => (
  <Stack direction="row" gap={8} align="center">
    <IconButton icon="refresh" label="Refresh items" disabledReason="Refreshing" />
    <Text variant="caption" tone="muted">
      Refreshing
    </Text>
  </Stack>
);

/** A request of its own is running: aria-busy now, the loader in the glyph's slot after a second. */
export const Busy = () => <IconButton icon="refresh" label="Refresh items" busy />;

/** In a table row: the row target. */
export const Row = () => <IconButton icon="copy" label="Copy name" size="row" />;

export const RowGhost = () => <IconButton icon="copy" label="Copy name" variant="ghost" size="row" />;

/** A toggle: `pressed` makes it `aria-pressed`, with one fixed label. It is the quiet square of a find bar; it fills when on. Press it. */
export const Toggle = () => <StatefulToggle />;

/** On: the quiet fill of the inactive selection, and the same fill under the pointer. */
export const TogglePressed = () => <StatefulToggle initial />;
