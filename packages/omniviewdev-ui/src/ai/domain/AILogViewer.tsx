import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AILogLine {
  timestamp?: string;
  content: string;
  severity?: 'info' | 'warn' | 'error' | 'debug';
  source?: string;
}

export interface AILogViewerProps {
  lines: AILogLine[];
  highlights?: number[];
  maxLines?: number;
  title?: string;
  onExpand?: () => void;
  sx?: SxProps<Theme>;
}

const severityColors: Record<string, string> = {
  info: 'var(--ov-info-default)',
  warn: 'var(--ov-warning-default)',
  error: 'var(--ov-danger-default)',
  debug: 'var(--ov-fg-faint)',
};

export default function AILogViewer({
  lines,
  highlights,
  maxLines = 15,
  title,
  onExpand,
  sx,
}: AILogViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const highlightSet = useMemo(() => new Set(highlights ?? []), [highlights]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const line of lines) {
      const sev = line.severity || 'info';
      counts[sev] = (counts[sev] || 0) + 1;
    }
    return counts;
  }, [lines]);

  const visibleLines = expanded ? lines : lines.slice(0, maxLines);
  const hasMore = lines.length > maxLines && !expanded;

  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface-inset)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.5,
          bgcolor: 'var(--ov-bg-surface)',
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        <Typography
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-muted)',
            fontFamily: 'var(--ov-font-mono)',
          }}
        >
          {title || 'logs'}
        </Typography>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {severityCounts.error && (
            <Chip
              size="small"
              label={`${severityCounts.error} errors`}
              sx={{
                height: 18,
                fontSize: 'var(--ov-text-xs)',
                bgcolor: 'color-mix(in srgb, var(--ov-danger-default) 15%, transparent)',
                color: 'var(--ov-danger-default)',
              }}
            />
          )}
          {severityCounts.warn && (
            <Chip
              size="small"
              label={`${severityCounts.warn} warnings`}
              sx={{
                height: 18,
                fontSize: 'var(--ov-text-xs)',
                bgcolor: 'color-mix(in srgb, var(--ov-warning-default) 15%, transparent)',
                color: 'var(--ov-warning-default)',
              }}
            />
          )}
        </Box>
      </Box>

      {/* Log lines */}
      <Box
        sx={{
          maxHeight: expanded ? 'none' : maxLines * 20 + 16,
          overflow: 'auto',
          p: 1,
        }}
      >
        {visibleLines.map((line, i) => {
          const isHighlighted = highlightSet.has(i);
          const color = severityColors[line.severity || 'info'] || 'var(--ov-fg-default)';

          return (
            <Box
              key={i}
              sx={{
                display: 'flex',
                gap: 1,
                py: 0.125,
                px: 0.5,
                borderRadius: '3px',
                bgcolor: isHighlighted
                  ? 'color-mix(in srgb, var(--ov-accent) 12%, transparent)'
                  : 'transparent',
                fontFamily: 'var(--ov-font-mono)',
                fontSize: '12px',
                lineHeight: '20px',
              }}
            >
              {/* Line number */}
              <Box
                component="span"
                sx={{
                  color: 'var(--ov-fg-faint)',
                  userSelect: 'none',
                  minWidth: `${String(lines.length).length + 1}ch`,
                  textAlign: 'right',
                }}
              >
                {i + 1}
              </Box>

              {/* Timestamp */}
              {line.timestamp && (
                <Box component="span" sx={{ color: 'var(--ov-fg-faint)', whiteSpace: 'nowrap' }}>
                  {line.timestamp}
                </Box>
              )}

              {/* Severity badge */}
              {line.severity && line.severity !== 'info' && (
                <Box
                  component="span"
                  sx={{
                    color,
                    fontWeight: 'var(--ov-weight-medium)',
                    textTransform: 'uppercase',
                    minWidth: '5ch',
                  }}
                >
                  {line.severity}
                </Box>
              )}

              {/* Content */}
              <Box
                component="span"
                sx={{
                  color: 'var(--ov-fg-default)',
                  wordBreak: 'break-all',
                  flex: 1,
                }}
              >
                {line.content}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Show more / expand */}
      {(hasMore || onExpand) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            gap: 1,
            py: 0.5,
            borderTop: '1px solid var(--ov-border-muted)',
            bgcolor: 'var(--ov-bg-surface)',
          }}
        >
          {hasMore && (
            <Button
              size="small"
              onClick={() => setExpanded(true)}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-muted)',
                textTransform: 'none',
              }}
            >
              Show {lines.length - maxLines} more lines
            </Button>
          )}
          {onExpand && (
            <Button
              size="small"
              onClick={onExpand}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-accent)',
                textTransform: 'none',
              }}
            >
              View full logs
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

AILogViewer.displayName = 'AILogViewer';
