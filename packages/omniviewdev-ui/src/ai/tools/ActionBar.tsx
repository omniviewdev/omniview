import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import ThumbUpOffAltIcon from '@mui/icons-material/ThumbUpOffAlt';
import ThumbDownOffAltIcon from '@mui/icons-material/ThumbDownOffAlt';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ActionBarProps {
  content?: string;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  alwaysVisible?: boolean;
  sx?: SxProps<Theme>;
}

export default function ActionBar({
  content,
  onCopy,
  onRegenerate,
  onThumbsUp,
  onThumbsDown,
  alwaysVisible = false,
  sx,
}: ActionBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = content ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content, onCopy]);

  const btnSx = {
    color: 'var(--ov-fg-faint)',
    '&:hover': { color: 'var(--ov-fg-default)' },
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        ...(!alwaysVisible && {
          opacity: 0,
          transition: 'opacity 150ms',
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {(content !== undefined || onCopy) && (
        <MuiTooltip title={copied ? 'Copied!' : 'Copy'}>
          <MuiIconButton size="small" onClick={handleCopy} sx={btnSx}>
            {copied ? (
              <CheckIcon sx={{ fontSize: 14, color: 'var(--ov-success-default)' }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            )}
          </MuiIconButton>
        </MuiTooltip>
      )}

      {onRegenerate && (
        <MuiTooltip title="Regenerate">
          <MuiIconButton size="small" onClick={onRegenerate} sx={btnSx}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {onThumbsUp && (
        <MuiTooltip title="Good response">
          <MuiIconButton size="small" onClick={onThumbsUp} sx={btnSx}>
            <ThumbUpOffAltIcon sx={{ fontSize: 14 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {onThumbsDown && (
        <MuiTooltip title="Poor response">
          <MuiIconButton size="small" onClick={onThumbsDown} sx={btnSx}>
            <ThumbDownOffAltIcon sx={{ fontSize: 14 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}
    </Box>
  );
}

ActionBar.displayName = 'ActionBar';
