import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ChatMessage } from './ChatMessageList';

export interface ChatConversationProps {
  messages: ChatMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  renderMessage?: (msg: ChatMessage) => React.ReactNode;
  header?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  inputActions?: React.ReactNode;
  sx?: SxProps<Theme>;
}

// Lazy imports to avoid circular — these are siblings
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';

export default function ChatConversation({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  renderMessage,
  header,
  disabled = false,
  loading = false,
  placeholder,
  inputActions,
  sx,
}: ChatConversationProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'var(--ov-bg-base)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {header}

      <ChatMessageList
        messages={messages}
        renderMessage={renderMessage}
      />

      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        disabled={disabled}
        loading={loading}
        placeholder={placeholder}
        actions={inputActions}
      />
    </Box>
  );
}

ChatConversation.displayName = 'ChatConversation';
