import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIStructuredDataViewerProps {
  content: string;
  format?: 'yaml' | 'json' | 'hcl' | 'toml' | 'text';
  title?: string;
  collapsible?: boolean;
  onApply?: (content: string) => void;
  onEdit?: (content: string) => void;
  onCopy?: (content: string) => void;
  sx?: SxProps<Theme>;
}

export default function AIStructuredDataViewer({
  content,
  format = 'text',
  title,
  collapsible = false,
  onApply,
  onEdit,
  onCopy,
  sx,
}: AIStructuredDataViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!collapsible);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      onCopy?.(content);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content, onCopy]);

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
        onClick={collapsible ? () => setExpanded((p) => !p) : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.5,
          bgcolor: 'var(--ov-bg-surface)',
          borderBottom: expanded ? '1px solid var(--ov-border-default)' : 'none',
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {collapsible && (
            <ExpandMoreIcon
              sx={{
                fontSize: 16,
                color: 'var(--ov-fg-faint)',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 150ms ease',
              }}
            />
          )}
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              fontFamily: 'var(--ov-font-mono)',
            }}
          >
            {title || format}
          </Typography>
        </Box>

        <Box
          onClick={(e) => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
        >
          <MuiIconButton
            size="small"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy content'}
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

      {/* Content */}
      <Box
        sx={{
          maxHeight: expanded ? 500 : 0,
          overflow: expanded ? 'auto' : 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <pre style={{ margin: 0, overflow: 'visible' }}>
            <code
              style={{
                fontFamily: 'var(--ov-font-mono)',
                fontSize: '12px',
                lineHeight: 1.6,
                color: 'var(--ov-fg-default)',
              }}
            >
              {content}
            </code>
          </pre>
        </Box>
      </Box>

      {/* Actions */}
      {expanded && (onApply || onEdit) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 0.75,
            px: 1.5,
            py: 0.5,
            borderTop: '1px solid var(--ov-border-default)',
            bgcolor: 'var(--ov-bg-surface)',
          }}
        >
          {onEdit && (
            <Button
              size="small"
              onClick={() => onEdit(content)}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-muted)',
                textTransform: 'none',
              }}
            >
              Edit
            </Button>
          )}
          {onApply && (
            <Button
              size="small"
              variant="contained"
              onClick={() => onApply(content)}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                bgcolor: 'var(--ov-accent)',
                color: 'var(--ov-accent-fg)',
                textTransform: 'none',
                '&:hover': { bgcolor: 'var(--ov-accent-muted)' },
              }}
            >
              Apply
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

AIStructuredDataViewer.displayName = 'AIStructuredDataViewer';
