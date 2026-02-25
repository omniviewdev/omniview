import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ToolResultProps {
  result: unknown;
  error?: string;
  sx?: SxProps<Theme>;
}

export default function ToolResult({ result, error, sx }: ToolResultProps) {
  if (error) {
    return (
      <Box
        sx={{
          bgcolor: 'color-mix(in srgb, var(--ov-danger-default) 12%, transparent)',
          borderRadius: '4px',
          px: 1.5,
          py: 1,
          ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
        } as SxProps<Theme>}
      >
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            color: 'var(--ov-danger-default)',
            fontFamily: 'var(--ov-font-mono)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </Typography>
      </Box>
    );
  }

  if (typeof result === 'string') {
    return (
      <Box
        sx={{
          bgcolor: 'var(--ov-bg-surface-inset)',
          borderRadius: '4px',
          px: 1.5,
          py: 1,
          ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
        } as SxProps<Theme>}
      >
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            color: 'var(--ov-fg-default)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {result}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        bgcolor: 'var(--ov-bg-surface-inset)',
        borderRadius: '4px',
        px: 1.5,
        py: 1,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: 'var(--ov-font-mono)',
          fontSize: '12px',
          lineHeight: 1.5,
          color: 'var(--ov-fg-default)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {JSON.stringify(result, null, 2)}
      </pre>
    </Box>
  );
}

ToolResult.displayName = 'ToolResult';
