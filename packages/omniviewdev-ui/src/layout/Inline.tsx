import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import Stack from './Stack';

export interface InlineProps {
  gap?: number;
  align?: string;
  justify?: string;
  divider?: boolean;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export default function Inline({
  gap = 1,
  align = 'center',
  justify,
  divider = false,
  children,
  sx,
}: InlineProps) {
  return (
    <Stack
      direction="row"
      gap={gap}
      align={align}
      justify={justify}
      wrap
      divider={divider}
      sx={sx}
    >
      {children}
    </Stack>
  );
}

Inline.displayName = 'Inline';
