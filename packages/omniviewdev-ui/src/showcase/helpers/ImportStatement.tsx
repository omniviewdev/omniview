import { useState, useCallback } from 'react';
import { Box, IconButton } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

interface ImportStatementProps {
  code: string;
}

/**
 * Renders a styled import snippet with a copy-to-clipboard button.
 * After copying, the icon briefly switches to a checkmark to confirm
 * the action before reverting back.
 */
export default function ImportStatement({ code }: ImportStatementProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: 'var(--ov-bg-surface-inset)',
        borderRadius: '4px',
        padding: '12px',
        paddingRight: '44px', // leave room for the copy button
      }}
    >
      <pre
        style={{
          margin: 0,
          overflow: 'auto',
        }}
      >
        <code
          style={{
            fontFamily: 'var(--ov-font-mono)',
            fontSize: '13px',
            lineHeight: 1.5,
            color: 'var(--ov-fg-default)',
          }}
        >
          {code}
        </code>
      </pre>

      <IconButton
        size="small"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        sx={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          color: copied ? 'var(--ov-success-default)' : 'var(--ov-fg-faint)',
          '&:hover': {
            color: 'var(--ov-fg-default)',
            bgcolor: 'var(--ov-state-hover)',
          },
        }}
      >
        {copied ? (
          <CheckIcon sx={{ fontSize: 16 }} />
        ) : (
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        )}
      </IconButton>
    </Box>
  );
}
