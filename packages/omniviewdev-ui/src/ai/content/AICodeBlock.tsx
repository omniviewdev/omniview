import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AICodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: number | string;
  onCopy?: () => void;
  sx?: SxProps<Theme>;
}

export default function AICodeBlock({
  code,
  language,
  showLineNumbers = false,
  maxHeight = 400,
  onCopy,
  sx,
}: AICodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code, onCopy]);

  const lines = code.split('\n');

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface-inset)',
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
            textTransform: 'lowercase',
          }}
        >
          {language || 'code'}
        </Typography>

        <MuiIconButton
          size="small"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
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

      {/* Code content */}
      <Box
        sx={{
          overflow: 'auto',
          maxHeight,
          p: 1.5,
        }}
      >
        <pre style={{ margin: 0, overflow: 'visible' }}>
          <code
            style={{
              fontFamily: 'var(--ov-font-mono)',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--ov-fg-default)',
            }}
          >
            {showLineNumbers
              ? lines.map((line, i) => (
                  <Box
                    component="span"
                    key={i}
                    sx={{ display: 'block' }}
                  >
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-block',
                        width: `${String(lines.length).length + 1}ch`,
                        color: 'var(--ov-fg-faint)',
                        userSelect: 'none',
                        textAlign: 'right',
                        pr: 2,
                      }}
                    >
                      {i + 1}
                    </Box>
                    {line}
                  </Box>
                ))
              : code}
          </code>
        </pre>
      </Box>
    </Box>
  );
}

AICodeBlock.displayName = 'AICodeBlock';
