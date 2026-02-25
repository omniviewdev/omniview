import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import ToolCall from './ToolCall';
import type { ToolCallProps } from './ToolCall';

export interface ToolCallListProps {
  calls: ToolCallProps[];
  sx?: SxProps<Theme>;
}

export default function ToolCallList({ calls, sx }: ToolCallListProps) {
  if (!calls.length) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        position: 'relative',
        pl: 2,
        // Connecting line
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 7,
          top: 12,
          bottom: 12,
          width: '1px',
          bgcolor: 'var(--ov-border-default)',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {calls.map((call, i) => (
        <ToolCall key={`${call.name}-${i}`} {...call} />
      ))}
    </Box>
  );
}

ToolCallList.displayName = 'ToolCallList';
