import { useState, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';

import {
  ChatConversation,
  ChatSuggestions,
  ChatBubble,
  ChatAvatar,
  AIMarkdown,
} from '@omniviewdev/ui/ai';
import type { ChatMessage } from '@omniviewdev/ui/ai';

const initialMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'system',
    content: 'Connected to production-cluster',
    timestamp: '10:00 AM',
    status: 'complete',
  },
  {
    id: '2',
    role: 'user',
    content: 'Show me the status of all pods in the default namespace',
    timestamp: '10:01 AM',
    status: 'complete',
  },
  {
    id: '3',
    role: 'assistant',
    content: 'Here are the pods in the **default** namespace:\n\n| Pod | Status | Restarts |\n|-----|--------|----------|\n| nginx-7b4f9c | Running | 0 |\n| redis-abc123 | Running | 2 |\n| api-server-xyz | CrashLoopBackOff | 5 |\n\nThe `api-server-xyz` pod is having issues. Would you like me to check the logs?',
    timestamp: '10:01 AM',
    status: 'complete',
  },
];

const suggestions = [
  'Check pod logs',
  'Describe the failing pod',
  'Scale deployment',
  'Show events',
];

export default function AIChatConversationPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = useCallback((value: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: value,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'complete',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');

    // Simulate assistant response
    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `I received your message: "${value}". This is a simulated response in the showcase demo.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'complete',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }, 1000);
  }, []);

  const handleSuggestion = useCallback((suggestion: string) => {
    setInputValue(suggestion);
  }, []);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Chat Conversation
      </Typography>

      {/* ---- Full Conversation ---- */}
      <Section title="ChatConversation" description="Composes ChatMessageList + ChatInput into a full chat view.">
        <ImportStatement code="import { ChatConversation } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive Chat">
          <Box sx={{ height: 500, border: '1px solid var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ChatConversation
              messages={messages}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Ask about your cluster..."
              renderMessage={(msg) => (
                <ChatBubble
                  role={msg.role}
                  timestamp={msg.timestamp}
                  avatar={msg.role !== 'system' ? <ChatAvatar role={msg.role} /> : undefined}
                >
                  {msg.role === 'assistant' ? (
                    <AIMarkdown source={msg.content} />
                  ) : (
                    msg.content
                  )}
                </ChatBubble>
              )}
            />
          </Box>
        </Example>
      </Section>

      {/* ---- Suggestions ---- */}
      <Section title="ChatSuggestions" description="Row of clickable chip suggestions.">
        <ImportStatement code="import { ChatSuggestions } from '@omniviewdev/ui/ai';" />

        <Example title="Basic">
          <ChatSuggestions
            suggestions={suggestions}
            onSelect={handleSuggestion}
          />
        </Example>
      </Section>
    </Box>
  );
}
