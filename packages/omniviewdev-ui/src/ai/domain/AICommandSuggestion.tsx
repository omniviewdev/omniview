import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import MuiIconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AICommandSuggestionProps {
  command: string;
  description?: string;
  dangerous?: boolean;
  dangerMessage?: string;
  onRun?: (command: string) => void;
  onCopy?: (command: string) => void;
  sx?: SxProps<Theme>;
}

export default function AICommandSuggestion({
  command,
  description,
  dangerous = false,
  dangerMessage,
  onRun,
  onCopy,
  sx,
}: AICommandSuggestionProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      onCopy?.(command);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [command, onCopy]);

  const handleRun = useCallback(() => {
    if (dangerous && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onRun?.(command);
  }, [command, dangerous, confirming, onRun]);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: `1px solid ${dangerous ? 'var(--ov-danger-muted)' : 'var(--ov-border-default)'}`,
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {dangerous && (
            <WarningAmberIcon
              sx={{ fontSize: 14, color: 'var(--ov-danger-default)' }}
            />
          )}
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: dangerous ? 'var(--ov-danger-default)' : 'var(--ov-fg-muted)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            {dangerous ? 'dangerous command' : 'command'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <MuiIconButton
            size="small"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy command'}
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

          {onRun && (
            <MuiIconButton
              size="small"
              onClick={handleRun}
              aria-label="Run in terminal"
              sx={{
                color: 'var(--ov-fg-faint)',
                '&:hover': { color: 'var(--ov-success-default)' },
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 16 }} />
            </MuiIconButton>
          )}
        </Box>
      </Box>

      {/* Command body */}
      <Box sx={{ px: 1.5, py: 1 }}>
        <pre style={{ margin: 0, overflow: 'auto' }}>
          <code
            style={{
              fontFamily: 'var(--ov-font-mono)',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--ov-fg-default)',
            }}
          >
            {command}
          </code>
        </pre>
      </Box>

      {/* Description */}
      {description && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid var(--ov-border-muted)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1.5,
            }}
          >
            {description}
          </Typography>
        </Box>
      )}

      {/* Confirmation bar */}
      {confirming && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid var(--ov-danger-muted)',
            bgcolor: 'color-mix(in srgb, var(--ov-danger-default) 8%, transparent)',
          }}
        >
          <WarningAmberIcon
            sx={{ fontSize: 14, color: 'var(--ov-danger-default)' }}
          />
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-danger-default)',
              flex: 1,
            }}
          >
            {dangerMessage || 'This command may be destructive. Are you sure?'}
          </Typography>
          <Button
            size="small"
            onClick={handleCancel}
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              minWidth: 'auto',
              textTransform: 'none',
            }}
          >
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleRun}
            aria-label="Confirm run"
            sx={{
              fontSize: 'var(--ov-text-xs)',
              bgcolor: 'var(--ov-danger-default)',
              color: '#fff',
              minWidth: 'auto',
              textTransform: 'none',
              '&:hover': { bgcolor: 'var(--ov-danger-emphasis)' },
            }}
          >
            Run anyway
          </Button>
        </Box>
      )}
    </Box>
  );
}

AICommandSuggestion.displayName = 'AICommandSuggestion';
