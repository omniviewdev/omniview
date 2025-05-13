import { Condition } from "kubernetes-types/meta/v1";
import { Chip, Tooltip, TooltipProps } from '@mui/joy';
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


function CustomTooltip({ children, ...rest }: TooltipProps) {
  const [renderTooltip, setRenderTooltip] = React.useState(false);

  return (
    <div
      onMouseEnter={() => !renderTooltip && setRenderTooltip(true)}
      className="display-contents"
    >
      {!renderTooltip && children}
      {
        renderTooltip && (
          <Tooltip {...rest}>
            {children}
          </Tooltip>
        )
      }
    </div>
  );
}

/**
 * Renders a chip based on the incoming condition.
 */
export const ConditionChip: React.FC<Props> = ({
  condition,
  flipped,
  unhealthyColor = 'faded',
  healthyColor = 'success'
}) => {
  const healthy = flipped ? condition.status === 'False' : condition.status === 'True'

  const color = () => {
    if (healthy) {
      return healthyColor
    }
    if (unhealthyColor === 'faded') {
      return 'neutral'
    }
    return unhealthyColor
  }

  return (
    <CustomTooltip size={'sm'} title={condition.message} variant={'outlined'}>
      <Chip
        size={'sm'}
        color={color()}
        variant={'solid'}
        sx={{
          opacity: !healthy && unhealthyColor === 'faded' ? 50 : 100,
          borderRadius: 2,
        }}
      >
        {condition.type}
      </Chip>
    </CustomTooltip>
  )
}

export default ConditionChip
