import React, { useRef, useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Fab from '@mui/material/Fab';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    status: 'pending' | 'running' | 'success' | 'error';
    duration?: number;
    error?: string;
  }>;
  thinking?: string;
  status?: 'streaming' | 'complete' | 'error';
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  renderMessage?: (msg: ChatMessage) => React.ReactNode;
  onScrollToBottom?: () => void;
  sx?: SxProps<Theme>;
}

export default function ChatMessageList({
  messages,
  renderMessage,
  onScrollToBottom,
  sx,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollBtn(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    onScrollToBottom?.();
  }, [onScrollToBottom]);

  // Auto-scroll on new messages if near bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight });
      });
    }
  }, [messages.length]);

  return (
    <Box
      sx={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box
        ref={containerRef}
        onScroll={checkScroll}
        sx={{
          height: '100%',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          p: 2,
        }}
      >
        {messages.map((msg) => (
          <Box
            key={msg.id}
            sx={{
              contain: 'content',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {renderMessage ? renderMessage(msg) : (
              <Box
                sx={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  px: 1.5,
                  py: 1,
                  borderRadius: msg.role === 'user'
                    ? '12px 12px 2px 12px'
                    : '12px 12px 12px 2px',
                  bgcolor: msg.role === 'user'
                    ? 'var(--ov-accent)'
                    : 'var(--ov-bg-surface)',
                  color: msg.role === 'user'
                    ? '#fff'
                    : 'var(--ov-fg-default)',
                  fontSize: 'var(--ov-text-sm)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  animation: 'ov-ai-msg-enter 200ms ease-out',
                  '@keyframes ov-ai-msg-enter': {
                    from: { opacity: 0, transform: 'translateY(8px)' },
                    to: { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                {msg.content}
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {showScrollBtn && (
        <Fab
          size="small"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          sx={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'var(--ov-bg-surface)',
            color: 'var(--ov-fg-default)',
            border: '1px solid var(--ov-border-default)',
            boxShadow: 'none',
            '&:hover': {
              bgcolor: 'var(--ov-bg-surface-inset)',
            },
          }}
        >
          <KeyboardArrowDownIcon />
        </Fab>
      )}
    </Box>
  );
}

ChatMessageList.displayName = 'ChatMessageList';
