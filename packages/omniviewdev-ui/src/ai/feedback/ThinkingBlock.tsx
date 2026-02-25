import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ThinkingBlockProps {
  thinking: string;
  isActive?: boolean;
  defaultExpanded?: boolean;
  label?: string;
  sx?: SxProps<Theme>;
}

export default function ThinkingBlock({
  thinking,
  isActive = false,
  defaultExpanded = false,
  label = 'Thinking...',
  sx,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        overflow: 'hidden',
        position: 'relative',
        ...(isActive && {
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: '6px',
            padding: '1px',
            background: 'linear-gradient(90deg, var(--ov-accent), var(--ov-info-default), var(--ov-accent))',
            backgroundSize: '200% 100%',
            animation: 'ov-ai-shimmer 2s linear infinite',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            pointerEvents: 'none',
          },
          '@keyframes ov-ai-shimmer': {
            '0%': { backgroundPosition: '200% 0' },
            '100%': { backgroundPosition: '-200% 0' },
          },
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        onClick={() => setExpanded((p) => !p)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          bgcolor: 'var(--ov-bg-surface)',
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: isActive ? 'var(--ov-accent)' : 'var(--ov-fg-faint)',
            ...(isActive && {
              animation: 'ov-conn-pulse 1.5s ease-in-out infinite',
              '@keyframes ov-conn-pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.3 },
              },
            }),
          }}
        />
        <Typography
          sx={{
            flex: 1,
            fontSize: 'var(--ov-text-sm)',
            color: 'var(--ov-fg-muted)',
            fontStyle: 'italic',
          }}
        >
          {label}
        </Typography>
        <MuiIconButton
          size="small"
          sx={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms',
            color: 'var(--ov-fg-faint)',
          }}
          tabIndex={-1}
        >
          <ExpandMoreIcon sx={{ fontSize: 16 }} />
        </MuiIconButton>
      </Box>

      {/* Content */}
      <Box
        sx={{
          maxHeight: expanded ? 400 : 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <Box
          sx={{
            borderTop: '1px solid var(--ov-border-default)',
            px: 1.5,
            py: 1,
            bgcolor: 'var(--ov-bg-surface-inset)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-sm)',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--ov-font-mono)',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {thinking}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

ThinkingBlock.displayName = 'ThinkingBlock';
