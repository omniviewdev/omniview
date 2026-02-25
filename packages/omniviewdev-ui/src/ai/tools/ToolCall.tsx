import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ToolCallProps {
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  defaultExpanded?: boolean;
  error?: string;
  sx?: SxProps<Theme>;
}

const statusIcons: Record<ToolCallProps['status'], React.ReactNode> = {
  pending: <PendingIcon sx={{ fontSize: 16, color: 'var(--ov-fg-faint)' }} />,
  running: <CircularProgress size={14} sx={{ color: 'var(--ov-accent)' }} />,
  success: <CheckCircleIcon sx={{ fontSize: 16, color: 'var(--ov-success-default)' }} />,
  error: <ErrorIcon sx={{ fontSize: 16, color: 'var(--ov-danger-default)' }} />,
};

export default function ToolCall({
  name,
  args,
  result,
  status,
  duration,
  defaultExpanded = false,
  error,
  sx,
}: ToolCallProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        onClick={() => setExpanded((p) => !p)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        }}
      >
        {statusIcons[status]}

        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontFamily: 'var(--ov-font-mono)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
            flex: 1,
          }}
        >
          {name}
        </Typography>

        {duration !== undefined && (
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
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

      {/* Expandable content */}
      <Box
        sx={{
          maxHeight: expanded ? 600 : 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <Box
          sx={{
            borderTop: '1px solid var(--ov-border-default)',
            px: 1.5,
            py: 1,
          }}
        >
          {args && Object.keys(args).length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontWeight: 600,
                  mb: 0.5,
                }}
              >
                Arguments
              </Typography>
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
                {JSON.stringify(args, null, 2)}
              </pre>
            </Box>
          )}

          {error && (
            <Box
              sx={{
                bgcolor: 'color-mix(in srgb, var(--ov-danger-default) 12%, transparent)',
                borderRadius: '4px',
                px: 1,
                py: 0.5,
              }}
            >
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-danger-default)',
                  fontFamily: 'var(--ov-font-mono)',
                }}
              >
                {error}
              </Typography>
            </Box>
          )}

          {result !== undefined && !error && (
            <Box>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontWeight: 600,
                  mb: 0.5,
                }}
              >
                Result
              </Typography>
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
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

ToolCall.displayName = 'ToolCall';
