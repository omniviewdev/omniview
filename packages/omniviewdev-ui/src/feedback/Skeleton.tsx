import MuiSkeleton from '@mui/material/Skeleton';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  width?: number | string;
  height?: number | string;
  lines?: number;
  sx?: SxProps<Theme>;
}

export default function Skeleton({
  variant = 'text',
  width,
  height,
  lines,
  sx,
}: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) } as SxProps<Theme>}>
        {Array.from({ length: lines }, (_, i) => (
          <MuiSkeleton
            key={i}
            variant="text"
            width={i === lines - 1 ? '60%' : width ?? '100%'}
            height={height}
          />
        ))}
      </Box>
    );
  }

  return (
    <MuiSkeleton
      variant={variant}
      width={width}
      height={height}
      sx={sx}
    />
  );
}

Skeleton.displayName = 'Skeleton';
