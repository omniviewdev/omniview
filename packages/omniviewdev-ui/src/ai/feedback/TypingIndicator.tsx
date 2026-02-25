import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface TypingIndicatorProps {
  compact?: boolean;
  sx?: SxProps<Theme>;
}

export default function TypingIndicator({ compact = false, sx }: TypingIndicatorProps) {
  const dotSize = compact ? 4 : 6;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '3px' : '4px',
        px: compact ? 0 : 1,
        py: compact ? 0 : 0.5,
        '@keyframes ov-ai-dot-bounce': {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-4px)' },
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            bgcolor: 'var(--ov-fg-faint)',
            animation: 'ov-ai-dot-bounce 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </Box>
  );
}

TypingIndicator.displayName = 'TypingIndicator';
