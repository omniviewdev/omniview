import type { ReactNode } from 'react';
import MuiList from '@mui/material/List';
import MuiListSubheader from '@mui/material/ListSubheader';
import MuiDivider from '@mui/material/Divider';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ComponentSize } from '../types';

export interface ListProps {
  children: ReactNode;
  size?: ComponentSize;
  /** Optional subheader text */
  subheader?: string;
  /** Dense rendering */
  dense?: boolean;
  /** Disable default padding */
  disablePadding?: boolean;
  sx?: SxProps<Theme>;
}

const densityMap: Record<ComponentSize, boolean> = {
  xs: true,
  sm: true,
  md: false,
  lg: false,
  xl: false,
};

export default function List({
  children,
  size = 'md',
  subheader,
  dense,
  disablePadding = false,
  sx,
}: ListProps) {
  return (
    <MuiList
      dense={dense ?? densityMap[size]}
      disablePadding={disablePadding}
      subheader={
        subheader ? <MuiListSubheader>{subheader}</MuiListSubheader> : undefined
      }
      sx={sx}
    >
      {children}
    </MuiList>
  );
}

List.displayName = 'List';

/** Re-export MUI ListSubheader for direct use */
export { MuiListSubheader as ListSubheader };

/** Simple list divider */
export function ListDivider({ sx }: { sx?: SxProps<Theme> }) {
  return <MuiDivider component="li" sx={sx} />;
}

ListDivider.displayName = 'ListDivider';
