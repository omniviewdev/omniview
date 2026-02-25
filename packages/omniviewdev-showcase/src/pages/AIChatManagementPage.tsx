import { useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';

import {
  ChatDrawer,
  ChatHeader,
  ChatHistory,
  ChatTabs,
} from '@omniviewdev/ui/ai';
import type { ConversationSummary, ChatTab } from '@omniviewdev/ui/ai';

const mockConversations: ConversationSummary[] = [
  { id: '1', title: 'Debug CrashLoopBackOff', lastMessage: 'The memory limit needs to be increased...', timestamp: new Date().toISOString(), messageCount: 12, modelId: 'claude-3.5-sonnet' },
  { id: '2', title: 'Scale nginx deployment', lastMessage: 'Done! Scaled to 5 replicas.', timestamp: new Date(Date.now() - 3600000).toISOString(), messageCount: 4, modelId: 'gpt-4' },
  { id: '3', title: 'Network policy review', lastMessage: 'The ingress rules look correct...', timestamp: new Date(Date.now() - 86400000).toISOString(), messageCount: 8 },
  { id: '4', title: 'Helm chart migration', lastMessage: 'Here\'s the migration plan...', timestamp: new Date(Date.now() - 172800000).toISOString(), messageCount: 15 },
  { id: '5', title: 'Resource optimization', lastMessage: 'Based on the metrics, these pods are over-provisioned...', timestamp: new Date(Date.now() - 604800000).toISOString(), messageCount: 20 },
];

const mockTabs: ChatTab[] = [
  { id: '1', label: 'Debug CrashLoop' },
  { id: '2', label: 'Scale nginx' },
  { id: '3', label: 'Network policy' },
];

export default function AIChatManagementPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeConv, setActiveConv] = useState('1');
  const [activeTab, setActiveTab] = useState('1');
  const [tabs, setTabs] = useState(mockTabs);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Chat Management
      </Typography>

      {/* ---- ChatHeader ---- */}
      <Section title="ChatHeader" description="Drawer header with model info, token count, and action buttons.">
        <ImportStatement code="import { ChatHeader } from '@omniviewdev/ui/ai';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ChatHeader
              modelName="claude-3.5-sonnet"
              tokenCount={4250}
              maxTokens={8192}
              onNewConversation={() => {}}
              onToggleHistory={() => {}}
              onClose={() => {}}
            />
            <ChatHeader
              modelName="gpt-4"
              tokenCount={7800}
              maxTokens={8192}
              onClose={() => {}}
            />
          </Box>
        </Example>
      </Section>

      {/* ---- ChatTabs ---- */}
      <Section title="ChatTabs" description="Horizontal tab bar for multiple active chats.">
        <ImportStatement code="import { ChatTabs } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive">
          <ChatTabs
            tabs={tabs}
            activeId={activeTab}
            onSelect={setActiveTab}
            onClose={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
            onNew={() => {
              const newTab = { id: `new-${Date.now()}`, label: `New Chat ${tabs.length + 1}` };
              setTabs((prev) => [...prev, newTab]);
              setActiveTab(newTab.id);
            }}
          />
        </Example>
      </Section>

      {/* ---- ChatHistory ---- */}
      <Section title="ChatHistory" description="Searchable list of past conversations grouped by date.">
        <ImportStatement code="import { ChatHistory } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive">
          <Box sx={{ height: 350, border: '1px solid var(--ov-border-default)', borderRadius: '8px', overflow: 'hidden' }}>
            <ChatHistory
              conversations={mockConversations}
              activeId={activeConv}
              onSelect={setActiveConv}
              onDelete={(id) => alert(`Delete ${id}`)}
            />
          </Box>
        </Example>
      </Section>

      {/* ---- ChatDrawer ---- */}
      <Section title="ChatDrawer" description="Right-anchored drawer for AI chat interface.">
        <ImportStatement code="import { ChatDrawer } from '@omniviewdev/ui/ai';" />

        <Example title="Open Drawer">
          <Button
            variant="outlined"
            onClick={() => setDrawerOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            Open Chat Drawer
          </Button>
          <ChatDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <ChatHeader
              modelName="claude-3.5-sonnet"
              tokenCount={1200}
              onClose={() => setDrawerOpen(false)}
              onNewConversation={() => {}}
            />
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ov-fg-faint)' }}>
              <Typography>Chat content goes here</Typography>
            </Box>
          </ChatDrawer>
        </Example>
      </Section>
    </Box>
  );
}
