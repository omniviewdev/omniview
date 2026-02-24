import { Condition } from "kubernetes-types/meta/v1";
import { Chip } from '@omniviewdev/ui';
import { Tooltip } from '@omniviewdev/ui/overlays';
import React from "react";

type Props = {
  /** The kubernetes condition */
  condition: Condition;

  /** Flip the status so that 'False' is treated as healthy */
  flipped?: boolean

  /** The color level to use for the unhealthy value. Defaults to 'faded' */
  unhealthyColor?: 'warning' | 'danger' | 'neutral' | 'faded'

  /** The color level to use for the healthy value. Defaults to 'success' */
  healthyColor?: 'success' | 'neutral'
}


function CustomTooltip({ children, content, ...rest }: { children: React.ReactElement; content?: string; size?: string }) {
  const [renderTooltip, setRenderTooltip] = React.useState(false);

  return (
    <div
      onMouseEnter={() => !renderTooltip && setRenderTooltip(true)}
      className="display-contents"
    >
      {!renderTooltip && children}
      {
        renderTooltip && (
          <Tooltip content={content} {...rest}>
            {children}
          </Tooltip>
        )
      }
    </div>
  );
}

/**
 * Renders a chip based on the incoming condition.
 * Healthy = subtle green soft, unhealthy = faded grey.
 */
export const ConditionChip: React.FC<Props> = ({
  condition,
  flipped,
  unhealthyColor = 'faded',
  healthyColor = 'success'
}) => {
  const healthy = flipped ? condition.status === 'False' : condition.status === 'True'

  const color = healthy
    ? healthyColor
    : unhealthyColor === 'faded'
      ? 'neutral'
      : unhealthyColor;

  return (
    <CustomTooltip size='sm' content={condition.message}>
      <Chip
        size='xs'
        color={color}
        emphasis='soft'
        sx={{
          borderRadius: 1,
          ...(!healthy && unhealthyColor === 'faded' ? { opacity: 0.45 } : {}),
        }}
        label={condition.type}
      />
    </CustomTooltip>
  )
}

export default ConditionChip
