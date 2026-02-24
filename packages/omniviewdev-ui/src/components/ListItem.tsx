import type { ReactNode, MouseEventHandler } from 'react';
import MuiListItem from '@mui/material/ListItem';
import MuiListItemButton from '@mui/material/ListItemButton';
import MuiListItemIcon from '@mui/material/ListItemIcon';
import MuiListItemText from '@mui/material/ListItemText';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ListItemProps {
  children?: ReactNode;
  /** Primary text label */
  primary?: ReactNode;
  /** Secondary text line */
  secondary?: ReactNode;
  /** Leading icon or decorator */
  icon?: ReactNode;
  /** Trailing action element */
  action?: ReactNode;
  /** Whether this item is selected */
  selected?: boolean;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Click handler — when provided, renders as a button */
  onClick?: MouseEventHandler;
  /** Nested content (renders children below the item text) */
  nested?: boolean;
  sx?: SxProps<Theme>;
}

export default function ListItem({
  children,
  primary,
  secondary,
  icon,
  action,
  selected = false,
  disabled = false,
  onClick,
  sx,
}: ListItemProps) {
  // If children are passed directly, render a plain list item
  if (children && !primary) {
    if (onClick) {
      return (
        <MuiListItem disablePadding secondaryAction={action} sx={sx}>
          <MuiListItemButton
            selected={selected}
            disabled={disabled}
            onClick={onClick}
          >
            {icon && <MuiListItemIcon>{icon}</MuiListItemIcon>}
            {children}
          </MuiListItemButton>
        </MuiListItem>
      );
    }
    return (
      <MuiListItem secondaryAction={action} sx={sx}>
        {icon && <MuiListItemIcon>{icon}</MuiListItemIcon>}
        {children}
      </MuiListItem>
    );
  }

  // Structured item with primary/secondary text
  if (onClick) {
    return (
      <MuiListItem disablePadding secondaryAction={action} sx={sx}>
        <MuiListItemButton
          selected={selected}
          disabled={disabled}
          onClick={onClick}
        >
          {icon && <MuiListItemIcon>{icon}</MuiListItemIcon>}
          <MuiListItemText primary={primary} secondary={secondary} />
          {children}
        </MuiListItemButton>
      </MuiListItem>
    );
  }

  return (
    <MuiListItem secondaryAction={action} sx={sx}>
      {icon && <MuiListItemIcon>{icon}</MuiListItemIcon>}
      <MuiListItemText primary={primary} secondary={secondary} />
      {children}
    </MuiListItem>
  );
}

ListItem.displayName = 'ListItem';
