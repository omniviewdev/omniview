import React from 'react';

// Material-ui
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';

// Project imports
import { type HeaderIconButton as HeaderIconButtonProps } from '@/store/header/types';
import { Icon } from '@/components/icons/Icon';

type Props = HeaderIconButtonProps;

/**
 * A button with a defined action in the header. Does not link to any other pages in the application.
 */
const HeaderIconButton: React.FC<Props> = ({ id, helpText, icon, onClick }) => (
  <Tooltip content={helpText} placement='bottom'>
    <IconButton
      size='sm'
      color='neutral'
      onClick={onClick}
      sx={{
        '--wails-draggable': 'no-drag',
      }}
    >
      <Icon name={icon} />
    </IconButton>
  </Tooltip>
);

export default HeaderIconButton;
