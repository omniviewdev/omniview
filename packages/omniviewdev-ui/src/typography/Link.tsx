import MuiLink from '@mui/material/Link';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SemanticColor } from '../types';
import { toMuiColor } from '../types';
import type { ReactNode, MouseEventHandler } from 'react';

export interface LinkProps {
  children: ReactNode;
  href?: string;
  color?: SemanticColor;
  underline?: 'always' | 'hover' | 'none';
  /** Opens in new tab with rel="noopener noreferrer" */
  external?: boolean;
  onClick?: MouseEventHandler;
  sx?: SxProps<Theme>;
}

export default function Link({
  children,
  href,
  color = 'primary',
  underline = 'hover',
  external = false,
  onClick,
  sx,
}: LinkProps) {
  return (
    <MuiLink
      href={href}
      color={toMuiColor(color) as 'primary' | 'secondary' | 'error' | 'inherit'}
      underline={underline}
      onClick={onClick}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      sx={sx}
    >
      {children}
    </MuiLink>
  );
}

Link.displayName = 'Link';
