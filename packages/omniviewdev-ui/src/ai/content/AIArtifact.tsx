import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArticleIcon from '@mui/icons-material/Article';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIArtifactProps {
  title: string;
  type?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  sx?: SxProps<Theme>;
}

export default function AIArtifact({
  title,
  type,
  children,
  defaultExpanded = true,
  sx,
}: AIArtifactProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '8px',
        overflow: 'hidden',
        bgcolor: 'var(--ov-bg-surface)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box
        onClick={() => setExpanded((p) => !p)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        }}
      >
        <ArticleIcon sx={{ fontSize: 16, color: 'var(--ov-accent)' }} />
        <Typography
          sx={{
            flex: 1,
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
          }}
        >
          {title}
        </Typography>
        {type && (
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            {type}
          </Typography>
        )}
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

      <Box
        sx={{
          maxHeight: expanded ? 1000 : 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <Box
          sx={{
            borderTop: '1px solid var(--ov-border-default)',
            p: 1.5,
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}

AIArtifact.displayName = 'AIArtifact';
