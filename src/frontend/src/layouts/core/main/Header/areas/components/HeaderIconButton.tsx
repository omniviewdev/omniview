import React from 'react'

// material-ui
import IconButton from '@mui/joy/IconButton'
import Tooltip from '@mui/joy/Tooltip'

// project imports
import { HeaderIconButton as HeaderIconButtonProps } from '@/store/header/types'
import { Icon } from '@/components/icons/Icon'

type Props = HeaderIconButtonProps

/**
 * A button with a defined action in the header. Does not link to any other pages in the application.
 */
const HeaderIconButton: React.FC<Props> = ({ id, helpText, icon, onClick }) => {
  return (
    <Tooltip title={helpText} arrow placement='bottom' variant='outlined'>
      <IconButton
        name={id}
        size="sm"
        variant="outlined"
        color="neutral"
        onClick={onClick}
        sx={{
          '--wails-draggable': 'no-drag',
        }}
      >
        <Icon name={icon} />
      </IconButton>
    </Tooltip>
  )
}

export default HeaderIconButton;
