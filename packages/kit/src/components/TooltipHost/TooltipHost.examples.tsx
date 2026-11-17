import { Button, IconButton, Stack, Text } from '@omniviewdev/kit';

// The host itself is mounted once by the application (ui-next/main.tsx), never by an example: a second one in a window throws.
// A tip is the data attribute `tip('text')` returns (`data-ov-tip`), which a part passes through like any `data-*`; examples write it out.

/** An icon-only command: its tip is its name, which it also has as its accessible name, so the tip is no second description. */
export const IconCommand = () => <IconButton icon="refresh" label="Refresh list" data-ov-tip="Refresh list" />;

/** A command that is unavailable: the reason is printed beside it (design 14 P2), and the tip only repeats it. */
export const Reason = () => (
  <Stack direction="row" gap={8} align="center">
    <Button disabledReason="Refreshing" data-ov-tip="Refreshing">
      Refresh
    </Button>
    <Text variant="caption" tone="muted">
      Refreshing
    </Text>
  </Stack>
);

/** A relative time whose absolute form is the tip (design 13 D5, 14 DT1); the same time is in the inspector. */
export const AbsoluteTime = () => <Text data-ov-tip="2026-11-05 10:42 UTC · 4 days ago">4d</Text>;

/** A tip with lines of its own: plain text, newlines kept. */
export const Lines = () => <Text data-ov-tip={'Created 4 days ago\n2026-11-05 10:42 UTC'}>Created</Text>;

/** A trigger that opens at once, for a control that is only its name (a rail tool). */
export const Immediate = () => <IconButton icon="box" label="Resources" variant="ghost" data-ov-tip="Resources" data-ov-tip-delay="0" />;
