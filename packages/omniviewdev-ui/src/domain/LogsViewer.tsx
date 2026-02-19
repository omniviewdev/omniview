import { useRef, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { LogLine } from './types';

export interface LogsViewerProps {
  lines: LogLine[];
  follow?: boolean;
  onFollow?: (follow: boolean) => void;
  wrap?: boolean;
  timestamps?: boolean;
  maxLines?: number;
  severity?: 'info' | 'warn' | 'error' | 'debug';
}

const severityColors: Record<string, string> = {
  info: 'var(--ov-fg-default)',
  warn: 'var(--ov-warning)',
  error: 'var(--ov-danger)',
  debug: 'var(--ov-fg-faint)',
};

const ROW_HEIGHT = 20;

export default function LogsViewer({
  lines,
  follow = false,
  wrap = false,
  timestamps = true,
  maxLines,
  severity,
}: LogsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let result = lines;
    if (severity) {
      result = result.filter((l) => l.severity === severity);
    }
    if (maxLines) {
      result = result.slice(-maxLines);
    }
    return result;
  }, [lines, severity, maxLines]);

  useEffect(() => {
    if (follow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered.length, follow]);

  return (
    <Box
      ref={containerRef}
      sx={{
        fontFamily: 'var(--ov-font-mono)',
        fontSize: '0.75rem',
        lineHeight: `${ROW_HEIGHT}px`,
        bgcolor: '#0d1117',
        color: 'var(--ov-fg-default)',
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'auto',
        maxHeight: 400,
        p: 1,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        wordBreak: wrap ? 'break-all' : undefined,
      }}
    >
      {filtered.length === 0 ? (
        <Typography
          variant="body2"
          sx={{ color: 'var(--ov-fg-muted)', fontFamily: 'inherit', fontSize: 'inherit', py: 2, textAlign: 'center' }}
        >
          No log lines
        </Typography>
      ) : (
        filtered.map((line, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              gap: 1,
              color: severityColors[line.severity ?? 'info'],
              minHeight: ROW_HEIGHT,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
            }}
          >
            <Box
              sx={{
                color: 'var(--ov-fg-faint)',
                userSelect: 'none',
                width: 40,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {i + 1}
            </Box>
            {timestamps && line.timestamp && (
              <Box sx={{ color: 'var(--ov-fg-muted)', flexShrink: 0 }}>
                {line.timestamp}
              </Box>
            )}
            <Box sx={{ flex: 1 }}>{line.content}</Box>
          </Box>
        ))
      )}
    </Box>
  );
}

LogsViewer.displayName = 'LogsViewer';
