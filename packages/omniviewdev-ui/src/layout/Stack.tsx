import type { ReactNode } from 'react';
import MuiStack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import type { SxProps, Theme } from '@mui/material/styles';

export interface StackProps {
  direction?: 'row' | 'column';
  gap?: number;
  align?: string;
  justify?: string;
  wrap?: boolean;
  divider?: boolean;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export default function Stack({
  direction = 'column',
  gap = 1,
  align,
  justify,
  wrap = false,
  divider = false,
  children,
  sx,
}: StackProps) {
  return (
    <MuiStack
      direction={direction}
      spacing={gap}
      alignItems={align}
      justifyContent={justify}
      flexWrap={wrap ? 'wrap' : 'nowrap'}
      divider={
        divider ? (
          <Divider
            orientation={direction === 'row' ? 'vertical' : 'horizontal'}
            flexItem
          />
        ) : undefined
      }
      sx={sx}
    >
      {children}
    </MuiStack>
  );
}

Stack.displayName = 'Stack';
