import React from 'react';
import { Tooltip } from '@omniviewdev/base-ui';

type Side = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  /** Tooltip text. When empty, the child renders without a tooltip. */
  content?: React.ReactNode;
  side?: Side;
  /** Delay before opening, in ms. */
  delay?: number;
  /** A single element that receives the trigger props and ref. */
  children: React.ReactElement;
};

/**
 * One-line wrapper around the base-ui Tooltip compound for the common
 * "hint on hover" case. The child element is used as the trigger.
 */
export default function HintTooltip({ content, side = 'bottom', delay = 400, children }: Props) {
  if (content === undefined || content === null || content === '') {
    return children;
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={delay} render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup size='sm'>{content}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
