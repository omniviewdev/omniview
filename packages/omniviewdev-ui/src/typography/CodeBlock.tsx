import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { CopyButton } from '../buttons';

export interface CodeBlockProps {
  children: string;
  language?: string;
  lineNumbers?: boolean;
  copy?: boolean;
  maxHeight?: number | string;
  wrap?: boolean;
  sx?: SxProps<Theme>;
}

export default function CodeBlock({
  children,
  lineNumbers = false,
  copy = true,
  maxHeight,
  wrap = false,
  sx,
}: CodeBlockProps) {
  const lines = children.split('\n');

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: 'var(--ov-bg-surface-inset)',
        borderRadius: '6px',
        border: '1px solid var(--ov-border-muted)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {copy && (
        <Box sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}>
          <CopyButton value={children} size="xs" />
        </Box>
      )}

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          pr: copy ? 5 : 1.5,
          overflow: 'auto',
          maxHeight: maxHeight,
          fontFamily: 'var(--ov-font-mono)',
          fontSize: '13px',
          lineHeight: 1.6,
          color: 'var(--ov-fg-default)',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          wordBreak: wrap ? 'break-all' : undefined,
        }}
      >
        {lineNumbers ? (
          <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <Box
                    component="td"
                    sx={{
                      pr: 2,
                      pl: 0.5,
                      textAlign: 'right',
                      userSelect: 'none',
                      color: 'var(--ov-fg-faint)',
                      width: 1,
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                    }}
                  >
                    {i + 1}
                  </Box>
                  <td>{line}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        ) : (
          <code>{children}</code>
        )}
      </Box>
    </Box>
  );
}

CodeBlock.displayName = 'CodeBlock';
