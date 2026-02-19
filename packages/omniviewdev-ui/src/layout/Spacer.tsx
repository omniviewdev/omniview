import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SpacerProps {
  sx?: SxProps<Theme>;
}

export default function Spacer({ sx }: SpacerProps) {
  return <Box sx={{ flex: 1, ...sx as Record<string, unknown> }} />;
}

Spacer.displayName = 'Spacer';
