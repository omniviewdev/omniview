import React from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import { LuTriangleAlert, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { Button } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';

export type TerminalErrorInfo = {
  title: string;
  suggestion: string;
  raw: string;
  retryable?: boolean;
  retryCommands?: string[];
};

type Props = {
  error: TerminalErrorInfo;
  onRetry: (command: string[]) => void;
  backgroundColor?: string;
};

export default function TerminalError({ error, onRetry, backgroundColor }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 4,
        bgcolor: backgroundColor ?? 'black',
        zIndex: 10,
      }}
    >
      <LuTriangleAlert size={32} color="var(--palette-error-main, #f44336)" />

      <Text weight="semibold" sx={{ color: 'error.main', fontSize: '16px' }}>
        {error.title}
      </Text>

      <Text
        size="sm"
        sx={{
          color: 'text.secondary',
          maxWidth: 500,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        {error.suggestion}
      </Text>

      {/* Collapsible raw error */}
      <Box sx={{ maxWidth: 600, width: '100%' }}>
        <Box
          onClick={() => setShowRaw(!showRaw)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            color: 'text.secondary',
            justifyContent: 'center',
            mb: 0.5,
            '&:hover': { color: 'text.primary' },
          }}
        >
          <Text size="xs">{showRaw ? 'Hide' : 'Show'} details</Text>
          {showRaw ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
        </Box>
        <Collapse in={showRaw}>
          <Box
            sx={{
              bgcolor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 1,
              p: 1.5,
              fontFamily: 'monospace',
              fontSize: '11px',
              color: 'rgba(255,255,255,0.7)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {error.raw}
          </Box>
        </Collapse>
      </Box>

      {/* Retry buttons — only shown when error is retryable with commands */}
      {error.retryable !== false && error.retryCommands && error.retryCommands.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Text size="sm" sx={{ color: 'text.secondary', mb: 1, textAlign: 'center' }}>
            Try a different shell:
          </Text>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 0.5 }}>
            {error.retryCommands.map((cmd) => (
              <Button
                key={cmd}
                emphasis="outline"
                size="sm"
                onClick={() => onRetry([cmd])}
                sx={{
                  color: 'rgba(255,255,255,0.8)',
                  borderColor: 'rgba(255,255,255,0.2)',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: 'rgba(255,255,255,0.5)',
                    bgcolor: 'rgba(255,255,255,0.05)',
                  },
                }}
              >
                {cmd}
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
