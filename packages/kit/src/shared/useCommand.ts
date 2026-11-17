import { useEffect, useId, useState, type MouseEvent } from 'react';

/** How long a command's own request runs before its icon becomes the loader: one second (design 13 M2, 05 local loading). */
export const LOADER_DELAY_MS = 1000;

type CommandInput = {
  readonly busy: boolean | undefined;
  readonly disabledReason: string | undefined;
  readonly onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
};

type Command = {
  /** Why the command is unavailable; undefined when it is available. An empty reason is no reason. */
  readonly reason: string | undefined;
  /** The id of the element that holds the reason, for `aria-describedby`. */
  readonly reasonId: string;
  /** Whether the loader replaces the icon now: busy for more than a second. */
  readonly loader: boolean;
  /** The click handler: it does nothing while the command is unavailable. */
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * What Button and IconButton share: a command that is unavailable for a reason stays focusable (aria-disabled, never the native
 * attribute: a focused button does not lose focus when it becomes unavailable) and its click does nothing, however it was made
 * (the pointer, Enter or Space all end in a click); a command that is busy says so at once, and shows the loader after a second
 * so a quick request does not flash one (design 14 P2, V62; 13 M2; 04 DR1).
 */
export function useCommand({ busy, disabledReason, onClick }: CommandInput): Command {
  const reasonId = useId();
  const reason = disabledReason !== undefined && disabledReason.trim() !== '' ? disabledReason : undefined;
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (busy !== true) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setElapsed(true);
    }, LOADER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [busy]);

  return {
    reason,
    reasonId,
    loader: busy === true && elapsed,
    onClick: (event) => {
      if (reason !== undefined) {
        event.preventDefault();
        return;
      }

      onClick?.(event);
    },
  };
}
