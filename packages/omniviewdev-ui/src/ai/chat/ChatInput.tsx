import { useCallback, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  maxLength?: number;
  actions?: React.ReactNode;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  sx?: SxProps<Theme>;
}

const MAX_ROWS = 6;
const LINE_HEIGHT = 22;

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  loading = false,
  maxLength,
  actions,
  sx,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = LINE_HEIGHT * MAX_ROWS + 16; // padding
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (value.trim() && !disabled && !loading) {
          onSubmit(value.trim());
        }
      }
    },
    [value, disabled, loading, onSubmit],
  );

  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled && !loading) {
      onSubmit(value.trim());
    }
  }, [value, disabled, loading, onSubmit]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        borderTop: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: 'var(--ov-bg-surface-inset)',
          borderRadius: '8px',
          border: '1px solid var(--ov-border-default)',
          px: 1.5,
          py: 0.75,
          transition: 'border-color 150ms',
          '&:focus-within': {
            borderColor: 'var(--ov-accent)',
          },
        }}
      >
        <Box
          component="textarea"
          ref={textareaRef}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          maxLength={maxLength}
          rows={1}
          sx={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            bgcolor: 'transparent',
            color: 'var(--ov-fg-default)',
            fontFamily: 'var(--ov-font-ui)',
            fontSize: 'var(--ov-text-base)',
            lineHeight: `${LINE_HEIGHT}px`,
            p: 0,
            '&::placeholder': {
              color: 'var(--ov-fg-faint)',
            },
            '&:disabled': {
              opacity: 0.5,
            },
          }}
        />

        <Box
          component="button"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled || loading}
          aria-label="Send message"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: 'none',
            bgcolor: 'transparent',
            color: value.trim() ? 'var(--ov-accent)' : 'var(--ov-fg-faint)',
            cursor: value.trim() ? 'pointer' : 'default',
            p: 0,
            lineHeight: 0,
            '&:disabled': { opacity: 0.4, cursor: 'default' },
          }}
        >
          <SendIcon sx={{ fontSize: 18 }} />
        </Box>
      </Box>

      {(actions || maxLength) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 0.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {actions}
          </Box>
          {maxLength && (
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: value.length > maxLength * 0.9
                  ? 'var(--ov-warning-default)'
                  : 'var(--ov-fg-faint)',
              }}
            >
              {value.length}/{maxLength}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

ChatInput.displayName = 'ChatInput';
