import { Button, Stack, Text } from '@omniviewdev/kit';

/** The neutral outlined command: the default. A dialog or page action. */
export const Secondary = () => <Button>Cancel</Button>;

/** The same height with a tight side, for toolbars and lanes. */
export const SecondaryCompact = () => <Button size="compact">Cancel</Button>;

/** The one filled command of a surface. */
export const Primary = () => <Button variant="primary">Create</Button>;

export const PrimaryCompact = () => (
  <Button variant="primary" size="compact">
    Create
  </Button>
);

/** The quiet command: no border until the pointer is over it. */
export const Ghost = () => <Button variant="ghost">Cancel</Button>;

/** The quiet toolbar command. */
export const GhostCompact = () => (
  <Button variant="ghost" size="compact">
    Cancel
  </Button>
);

/** A destructive command that is not the surface's primary: red text, neutral border. */
export const Danger = () => <Button tone="danger">Delete</Button>;

export const DangerCompact = () => (
  <Button tone="danger" size="compact">
    Delete
  </Button>
);

/** A destructive confirmation: the solid error control. */
export const PrimaryDanger = () => (
  <Button variant="primary" tone="danger">
    Delete
  </Button>
);

export const GhostCompactDanger = () => (
  <Button variant="ghost" tone="danger" size="compact">
    Delete
  </Button>
);

/** A toolbar command with its glyph: the Columns trigger of a list. */
export const WithIcon = () => (
  <Button variant="ghost" size="compact" icon="columns">
    Columns
  </Button>
);

/** Clear filters, as a list shows it while a filter is active. */
export const ClearFilters = () => (
  <Button variant="ghost" size="compact" icon="close">
    Clear filters
  </Button>
);

/** The filled command with a glyph. */
export const PrimaryWithIcon = () => (
  <Button variant="primary" icon="server">
    Connect
  </Button>
);

/** A bordered toolbar command with a trailing-style chevron glyph before the label. */
export const LoadMore = () => (
  <Button size="compact" icon="chevron-down">
    Load more
  </Button>
);

/** Unavailable for a reason: focusable, painted with the disabled roles, and described by its reason. */
export const SecondaryDisabled = () => <Button disabledReason="Refreshing">Cancel</Button>;

export const PrimaryDisabled = () => (
  <Button variant="primary" disabledReason="Refreshing">
    Create
  </Button>
);

export const GhostCompactDisabled = () => (
  <Button variant="ghost" size="compact" disabledReason="Refreshing">
    Cancel
  </Button>
);

export const DangerDisabled = () => (
  <Button tone="danger" disabledReason="Refreshing">
    Delete
  </Button>
);

export const PrimaryDangerDisabled = () => (
  <Button variant="primary" tone="danger" disabledReason="Refreshing">
    Delete
  </Button>
);

export const WithIconDisabled = () => (
  <Button variant="ghost" size="compact" icon="columns" disabledReason="Refreshing">
    Columns
  </Button>
);

/** The rule of the design: the reason is text the user can read beside the control, and the button repeats it as its description. */
export const DisabledWithVisibleReason = () => (
  <Stack direction="row" gap={8} align="center">
    <Button size="compact" icon="refresh" disabledReason="Refreshing">
      Refresh
    </Button>
    <Text variant="caption" tone="muted">
      Refreshing
    </Text>
  </Stack>
);

/** A request of its own is running: aria-busy now, the loader in place of the icon after a second. The label does not change. */
export const Busy = () => (
  <Button size="compact" icon="refresh" busy>
    Refresh
  </Button>
);

/** Without an icon there is nothing to replace: only aria-busy says so. */
export const BusyWithoutIcon = () => (
  <Button busy>
    Save
  </Button>
);

/** In a table row or a dense lane: the row target. */
export const Row = () => <Button size="row">Retry</Button>;

export const RowGhost = () => (
  <Button variant="ghost" size="row">
    Retry
  </Button>
);
