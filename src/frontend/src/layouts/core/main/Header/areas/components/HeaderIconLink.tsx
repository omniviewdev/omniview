import React from 'react';
import { Link } from 'react-router-dom';

// Material-ui
import IconButton from '@mui/joy/IconButton';
import Tooltip from '@mui/joy/Tooltip';

// Project imports
import { type HeaderIconLink as HeaderIconLinkProps } from '@/store/header/types';
import { Icon } from '@/components/icons/Icon';

type Props = HeaderIconLinkProps;

/**
 * A button with a defined action in the header. Does not link to any other pages in the application.
 */
const HeaderIconLink: React.FC<Props> = ({ id, helpText, icon, href }) => (
  <WithConditionalTooltip helpText={helpText}>
    <Link to={href}>
      <IconButton
        name={id}
        size='sm'
        variant='outlined'
        color='neutral'
        sx={{
          '--wails-draggable': 'no-drag',
        }}
      >
        <Icon name={icon} size={16} />
      </IconButton>
    </Link>
  </WithConditionalTooltip>
);

export const WithConditionalTooltip = ({ helpText, children }: { helpText?: string; children: React.ReactElement }) => helpText ? <Tooltip title={helpText} arrow placement='bottom' variant='outlined'>{children}</Tooltip> : <>{children}</>;

export default HeaderIconLink;
