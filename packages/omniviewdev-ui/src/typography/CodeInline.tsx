import type { SxProps, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';

export interface CodeInlineProps {
  children: string;
  sx?: SxProps<Theme>;
}

export default function CodeInline({ children, sx }: CodeInlineProps) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: 'var(--ov-font-mono)',
        fontSize: '0.85em',
        backgroundColor: 'var(--ov-bg-surface-inset)',
        color: 'var(--ov-fg-default)',
        padding: '2px 6px',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}

CodeInline.displayName = 'CodeInline';
