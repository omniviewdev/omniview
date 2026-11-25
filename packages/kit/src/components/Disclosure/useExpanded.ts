import { useId, useState } from 'react';

/**
 * How a part that expands and collapses is driven. Controlled: the caller owns `open` and flips it in `onOpenChange`.
 * Uncontrolled: the part keeps the state, starts at `defaultOpen` (closed when absent) and reports each change.
 */
export type ExpandState =
  | { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly defaultOpen?: undefined }
  | { readonly open?: undefined; readonly defaultOpen?: boolean | undefined; readonly onOpenChange?: ((open: boolean) => void) | undefined };

type Source = {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
};

/** The expanded state of a trigger and the region it opens: whether it is open, the flip, and the ids that tie the two together. Internal to `SectionCard` and `Disclosure`. */
export function useExpanded({ open: controlled, defaultOpen, onOpenChange }: Source) {
  const base = useId();
  const [own, setOwn] = useState(defaultOpen === true);
  const open = controlled ?? own;
  return {
    open,
    triggerId: `${base}-trigger`,
    bodyId: `${base}-body`,
    toggle: () => {
      const next = !open;
      if (controlled === undefined) {
        setOwn(next);
      }

      onOpenChange?.(next);
    },
  };
}
