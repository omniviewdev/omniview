import { IconButton, Stack, Text } from '@omniviewdev/kit';

/** The neutral outlined square: the page header's utility command. */
export const Secondary = () => <IconButton icon="refresh" label="Refresh Pods" />;

/** The quiet square of a toolbar. */
export const Ghost = () => <IconButton icon="refresh" label="Refresh Pods" variant="ghost" />;

export const Primary = () => <IconButton icon="refresh" label="Refresh Pods" variant="primary" />;

export const Danger = () => <IconButton icon="close" label="Clear selection" tone="danger" />;

export const GhostDanger = () => <IconButton icon="close" label="Clear selection" variant="ghost" tone="danger" />;

/** Unavailable for a reason: focusable, painted with the disabled roles, described by its reason. */
export const SecondaryDisabled = () => <IconButton icon="refresh" label="Refresh Pods" disabledReason="Refreshing" />;

export const GhostDisabled = () => <IconButton icon="refresh" label="Refresh Pods" variant="ghost" disabledReason="Refreshing" />;

/** The Refresh command of a page header: while a read runs it says why, in text beside it. */
export const DisabledWithVisibleReason = () => (
  <Stack direction="row" gap={8} align="center">
    <IconButton icon="refresh" label="Refresh Pods" disabledReason="Refreshing" />
    <Text variant="caption" tone="muted">
      Refreshing
    </Text>
  </Stack>
);

/** A request of its own is running: aria-busy now, the loader in the glyph's slot after a second. */
export const Busy = () => <IconButton icon="refresh" label="Refresh Pods" busy />;

/** In a table row: the row target. */
export const Row = () => <IconButton icon="copy" label="Copy name" size="row" />;

export const RowGhost = () => <IconButton icon="copy" label="Copy name" variant="ghost" size="row" />;
