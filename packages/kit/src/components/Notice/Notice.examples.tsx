import { Button, Notice } from '@omniviewdev/kit';

/** The default tone: information, plain content with no live region. */
export const ToneInfo = () => <Notice>Changes apply the next time the list refreshes.</Notice>;

export const ToneSuccess = () => <Notice tone="success">The group was saved.</Notice>;

export const ToneWarning = () => <Notice tone="warning">Two members are not available any more.</Notice>;

export const ToneError = () => <Notice tone="error">The group could not be saved.</Notice>;

/** A bold lead sentence before the message. */
export const WithTitle = () => (
  <Notice tone="warning" title="Members not available.">
    Two members were removed from their connection and are not counted.
  </Notice>
);

/** A command at the end: a compact button, a Tab stop of its own. */
export const WithRetry = () => (
  <Notice
    tone="error"
    actions={
      <Button variant="ghost" size="compact" icon="refresh">
        Retry
      </Button>
    }
  >
    The status could not be read.
  </Notice>
);

/** A problem that appears after an action is announced at once: `live="alert"`. */
export const LiveAlert = () => (
  <Notice tone="error" live="alert">
    The group could not be saved. Check the name and try again.
  </Notice>
);

/** A result is announced politely: `live="status"`. */
export const LiveStatus = () => (
  <Notice tone="success" live="status">
    The group was saved.
  </Notice>
);

/** A long message wraps, and the commands wrap below it when the line is too narrow. */
export const LongMessage = () => (
  <Notice
    tone="warning"
    title="Review needed."
    actions={
      <Button variant="ghost" size="compact">
        Review
      </Button>
    }
  >
    This group matches no members yet. Review the match rules and the connections they cover, then save the group again so that its members are counted in the list.
  </Notice>
);
