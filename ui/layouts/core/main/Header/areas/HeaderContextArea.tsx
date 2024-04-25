import React from 'react';
import { Link } from 'react-router-dom';

// Material-ui
import Box from '@mui/joy/Box';
import IconButton from '@mui/joy/IconButton';
import Typography from '@mui/joy/Typography';

// Project imports
import { Icon } from '@/components/icons/Icon';

type Props = {
  /** A title for the context area. */
  title: string;

  /**
   * The icon to display in the context area. This can be a string of any icon within
   * the react-icons library, or a pure jsx component
   */
  icon?: React.ReactNode | string;

  /** An optional link to navigate to when the icon is clicked. Mutally exclusive with onIconClick */
  iconLink?: string;

  /** An optional action when the icon is clicked. Turns the icon into an icon button. */
  onIconClick?: () => void;
};

/**
 * Display a piece of contextual information in the header, like the current page or section.
 */
const HeaderContextArea: React.FC<Props> = ({ icon, title, iconLink, onIconClick }) => (
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 1.5,
      width: '100%',
      height: '100%',
    }}
  >
    {iconLink || onIconClick ? (
      <IconButton
        size='sm'
        variant='soft'
        // Sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
        href={iconLink}
      >
        {typeof icon === 'string' ? <Icon name={icon} /> : icon}
      </IconButton>
    ) : (
      <Typography component='h1' fontWeight='xl'>
        {icon}
        {title}
      </Typography>
    )}
  </Box>
);

/**
 * Conditionally renders a link around the children if a link is provided.
 */
export const WithConditionalLink = ({ link, children }: { link?: string; children: React.ReactNode }) => {
  if (link) {
    return <Link to={link}>{children}</Link>;
  }

  return children;
};

export default HeaderContextArea;
