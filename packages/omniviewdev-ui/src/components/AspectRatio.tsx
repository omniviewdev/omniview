import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AspectRatioProps {
  /** Ratio expressed as "width/height" string or a number (e.g. 16/9) */
  ratio?: string | number;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export default function AspectRatio({
  ratio = '1/1',
  children,
  sx,
}: AspectRatioProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: typeof ratio === 'number' ? String(ratio) : ratio,
        overflow: 'hidden',
        '& > *': {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        },
        ...sx as Record<string, unknown>,
      }}
    >
      {children}
    </Box>
  );
}

AspectRatio.displayName = 'AspectRatio';
