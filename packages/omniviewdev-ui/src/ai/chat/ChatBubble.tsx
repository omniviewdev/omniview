import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export type ChatBubbleSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ChatBubbleProps {
  role: 'user' | 'assistant' | 'system';
  children: React.ReactNode;
  timestamp?: string | Date;
  avatar?: React.ReactNode;
  actions?: React.ReactNode;
  status?: 'sending' | 'sent' | 'error';
  /** Controls the font size of the bubble content. Falls back to CSS var --ov-chat-font-size. */
  size?: ChatBubbleSize;
  sx?: SxProps<Theme>;
}

const sizeMap: Record<ChatBubbleSize, string> = {
  xs: 'var(--ov-text-xs)',
  sm: 'var(--ov-text-sm)',
  md: 'var(--ov-text-base)',
  lg: 'var(--ov-text-md)',
};

export default function ChatBubble({
  role,
  children,
  timestamp,
  avatar,
  actions,
  status,
  size,
  sx,
}: ChatBubbleProps) {
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  const formattedTime = timestamp
    ? typeof timestamp === 'string'
      ? timestamp
      : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : undefined;

  const fontSize = size
    ? sizeMap[size]
    : 'var(--ov-chat-font-size, var(--ov-text-sm))';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: 1,
        // User bubbles are capped; assistant messages can use full width
        maxWidth: isAssistant ? '100%' : '85%',
        ...(role === 'system' && { maxWidth: '70%', alignSelf: 'center' }),
        ...(role !== 'system' && { alignSelf: isUser ? 'flex-end' : 'flex-start' }),
        animation: 'ov-ai-msg-enter 200ms ease-out',
        '@keyframes ov-ai-msg-enter': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      {avatar && role !== 'system' && (
        <Box sx={{ flexShrink: 0 }}>{avatar}</Box>
      )}

      <Box
        data-testid="chat-bubble-column"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
          minWidth: 0,
          alignItems: role === 'system'
            ? 'center'
            : isUser
              ? 'flex-end'
              : 'flex-start',
        }}
      >
        <Box
          sx={{
            fontSize,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            position: 'relative',
            // User: compact bubble with accent tint
            ...(isUser && {
              px: 1.5,
              py: 1,
              bgcolor: 'var(--ov-accent-muted)',
              color: 'var(--ov-fg-default)',
              borderRadius: '12px 12px 2px 12px',
            }),
            // Assistant: plain text, no bubble — like ChatGPT / Claude
            ...(isAssistant && {
              color: 'var(--ov-fg-default)',
            }),
            // System: subtle inset bubble, centered
            ...(role === 'system' && {
              px: 1.5,
              py: 0.75,
              bgcolor: 'var(--ov-bg-surface-inset)',
              color: 'var(--ov-fg-muted)',
              borderRadius: '8px',
              fontStyle: 'italic',
            }),
            ...(status === 'error' && {
              border: '1px solid var(--ov-danger-default)',
              ...(isAssistant && { px: 1, py: 0.5, borderRadius: '6px' }),
            }),
            ...(status === 'sending' && { opacity: 0.7 }),
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>}
        >
          {children}

          {actions && (
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                mt: 0.5,
                opacity: 0,
                transition: 'opacity 150ms',
                '.MuiBox-root:hover > &': { opacity: 1 },
              }}
            >
              {actions}
            </Box>
          )}
        </Box>

        {formattedTime && (
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
              ...(isUser && { px: 0.5 }),
            }}
          >
            {formattedTime}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

ChatBubble.displayName = 'ChatBubble';
