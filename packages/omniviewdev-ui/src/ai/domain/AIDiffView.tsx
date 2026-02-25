import { useState, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIDiffViewProps {
  before: string;
  after: string;
  language?: string;
  title?: string;
  onApply?: (after: string) => void;
  onCopy?: (after: string) => void;
  sx?: SxProps<Theme>;
}

interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  oldNum?: number;
  newNum?: number;
}

function computeDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build diff
  const lines: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      lines.push({ type: 'unchanged', content: oldLines[i - 1], oldNum: i, newNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.push({ type: 'add', content: newLines[j - 1], newNum: j });
      j--;
    } else {
      lines.push({ type: 'remove', content: oldLines[i - 1], oldNum: i });
      i--;
    }
  }
  lines.reverse();

  return lines;
}

export default function AIDiffView({
  before,
  after,
  language,
  title,
  onApply,
  onCopy,
  sx,
}: AIDiffViewProps) {
  const [copied, setCopied] = useState(false);
  const diffLines = useMemo(() => computeDiff(before, after), [before, after]);

  const addCount = diffLines.filter((l) => l.type === 'add').length;
  const removeCount = diffLines.filter((l) => l.type === 'remove').length;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(after).then(() => {
      setCopied(true);
      onCopy?.(after);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [after, onCopy]);

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            {title || (language ? `diff (${language})` : 'diff')}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-success-default)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            +{addCount}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-danger-default)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            -{removeCount}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <MuiIconButton
            size="small"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy result'}
            sx={{
              color: copied ? 'var(--ov-success-default)' : 'var(--ov-fg-faint)',
              '&:hover': { color: 'var(--ov-fg-default)' },
            }}
          >
            {copied ? (
              <CheckIcon sx={{ fontSize: 14 }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            )}
          </MuiIconButton>
        </Box>
      </Box>

      {/* Diff lines */}
      <Box sx={{ overflow: 'auto', maxHeight: 400, p: 0 }}>
        <pre style={{ margin: 0 }}>
          {diffLines.map((line, i) => {
            const bgMap = {
              add: 'color-mix(in srgb, var(--ov-success-default) 10%, transparent)',
              remove: 'color-mix(in srgb, var(--ov-danger-default) 10%, transparent)',
              unchanged: 'transparent',
            };
            const colorMap = {
              add: 'var(--ov-success-default)',
              remove: 'var(--ov-danger-default)',
              unchanged: 'var(--ov-fg-default)',
            };
            const prefix = { add: '+', remove: '-', unchanged: ' ' };

            return (
              <Box
                key={i}
                component="span"
                sx={{
                  display: 'block',
                  px: 1.5,
                  fontFamily: 'var(--ov-font-mono)',
                  fontSize: '12px',
                  lineHeight: '20px',
                  bgcolor: bgMap[line.type],
                  color: colorMap[line.type],
                  whiteSpace: 'pre',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-block',
                    width: '2ch',
                    userSelect: 'none',
                    color: colorMap[line.type],
                    opacity: 0.7,
                  }}
                >
                  {prefix[line.type]}
                </Box>
                {line.content}
              </Box>
            );
          })}
        </pre>
      </Box>

      {/* Apply action */}
      {onApply && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid var(--ov-border-default)',
            bgcolor: 'var(--ov-bg-surface)',
          }}
        >
          <Button
            size="small"
            variant="contained"
            onClick={() => onApply(after)}
            sx={{
              fontSize: 'var(--ov-text-xs)',
              bgcolor: 'var(--ov-accent)',
              color: 'var(--ov-accent-fg)',
              textTransform: 'none',
              '&:hover': { bgcolor: 'var(--ov-accent-muted)' },
            }}
          >
            Apply changes
          </Button>
        </Box>
      )}
    </Box>
  );
}

AIDiffView.displayName = 'AIDiffView';
