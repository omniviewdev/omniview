import Box from '@mui/material/Box';
import MDPreview from '@uiw/react-markdown-preview';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIMarkdownProps {
  source: string;
  streaming?: boolean;
  maxHeight?: number | string;
  sx?: SxProps<Theme>;
}

export default function AIMarkdown({
  source,
  streaming = false,
  maxHeight,
  sx,
}: AIMarkdownProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        '& .wmde-markdown': {
          backgroundColor: 'transparent !important',
          color: 'var(--ov-fg-default)',
          fontSize: 'var(--ov-text-sm)',
          lineHeight: 1.6,
        },
        '& .wmde-markdown code': {
          fontFamily: 'var(--ov-font-mono)',
          fontSize: '0.85em',
          bgcolor: 'var(--ov-bg-surface-inset)',
          px: 0.5,
          py: 0.25,
          borderRadius: '3px',
        },
        '& .wmde-markdown pre': {
          bgcolor: 'var(--ov-bg-surface-inset) !important',
          borderRadius: '6px',
          border: '1px solid var(--ov-border-default)',
        },
        ...(streaming && {
          '&::after': {
            content: '""',
            display: 'inline-block',
            width: '2px',
            height: '1em',
            bgcolor: 'var(--ov-accent)',
            ml: '2px',
            verticalAlign: 'text-bottom',
            animation: 'ov-ai-cursor-blink 1s step-end infinite',
          },
          '@keyframes ov-ai-cursor-blink': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0 },
          },
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <MDPreview
        source={source}
        style={{
          backgroundColor: 'transparent',
          overflow: 'auto',
          maxHeight: maxHeight ?? 'none',
        }}
        wrapperElement={{ 'data-color-mode': 'dark' }}
      />
    </Box>
  );
}

AIMarkdown.displayName = 'AIMarkdown';
