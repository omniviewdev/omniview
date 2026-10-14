import React from 'react';
import { Tooltip } from '@omniviewdev/base-ui';

export type SimpleTooltipProps = {
  title: React.ReactNode;
  /** The trigger element. Rendered in place (no extra button wrapper). */
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
};

/** `title`-style tooltip wrapper around base-ui Tooltip. */
export const SimpleTooltip: React.FC<SimpleTooltipProps> = ({ title, children, side = 'top' }) => (
  <Tooltip.Root size="sm">
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner side={side} sideOffset={6}>
        <Tooltip.Popup>{title}</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);

export default SimpleTooltip;
