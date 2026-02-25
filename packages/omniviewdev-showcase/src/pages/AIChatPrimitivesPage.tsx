import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ChatBubble, ChatAvatar } from '@omniviewdev/ui/ai';
import { AICodeBlock, AIMarkdown } from '@omniviewdev/ui/ai';
import { TypingIndicator, StreamingText } from '@omniviewdev/ui/ai';

const sampleCode = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx`;

const sampleMarkdown = `## Kubernetes Pod Status

The pod \`nginx-7b4f9c\` is running on node **worker-1**.

\`\`\`yaml
status:
  phase: Running
  conditions:
    - type: Ready
      status: "True"
\`\`\`

> All containers are healthy.`;

export default function AIChatPrimitivesPage() {
  const [streamKey, setStreamKey] = useState(0);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Chat Primitives
      </Typography>

      {/* ---- ChatBubble ---- */}
      <Section title="ChatBubble" description="Message bubble with role-based styling, timestamp, and optional avatar slot.">
        <ImportStatement code="import { ChatBubble } from '@omniviewdev/ui/ai';" />

        <Example title="Roles">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ChatBubble role="user" timestamp="10:30 AM">
              Can you check the status of my deployment?
            </ChatBubble>
            <ChatBubble role="assistant" timestamp="10:30 AM">
              I'll check the deployment status for you. The nginx deployment has 3/3 replicas ready.
            </ChatBubble>
            <ChatBubble role="system">
              Connected to production-cluster
            </ChatBubble>
          </Box>
        </Example>

        <Example title="With Avatars">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ChatBubble
              role="user"
              timestamp="10:31 AM"
              avatar={<ChatAvatar role="user" />}
            >
              Scale the deployment to 5 replicas
            </ChatBubble>
            <ChatBubble
              role="assistant"
              timestamp="10:31 AM"
              avatar={<ChatAvatar role="assistant" status="online" />}
            >
              Done! The deployment has been scaled to 5 replicas.
            </ChatBubble>
          </Box>
        </Example>

        <Example title="Status States">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ChatBubble role="user" status="sending">
              Sending message...
            </ChatBubble>
            <ChatBubble role="user" status="sent">
              Sent message
            </ChatBubble>
            <ChatBubble role="user" status="error">
              Failed to send
            </ChatBubble>
          </Box>
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ChatBubble role="user" size="xs" timestamp="10:32 AM">
              Extra small text
            </ChatBubble>
            <ChatBubble role="assistant" size="sm" timestamp="10:32 AM">
              Small text (default)
            </ChatBubble>
            <ChatBubble role="user" size="md" timestamp="10:32 AM">
              Medium text
            </ChatBubble>
            <ChatBubble role="assistant" size="lg" timestamp="10:32 AM">
              Large text
            </ChatBubble>
          </Box>
        </Example>

        <Example title="Configurable via CSS Variable">
          <Box sx={{ '--ov-chat-font-size': 'var(--ov-text-base)', display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ChatBubble role="user" timestamp="10:33 AM">
              This container sets --ov-chat-font-size to base (14px)
            </ChatBubble>
            <ChatBubble role="assistant" timestamp="10:33 AM">
              All bubbles inside inherit the larger size without per-bubble props.
            </ChatBubble>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'role', type: "'user' | 'assistant' | 'system'", description: 'Message sender role' },
            { name: 'children', type: 'ReactNode', description: 'Message content' },
            { name: 'timestamp', type: 'string | Date', description: 'Message timestamp' },
            { name: 'avatar', type: 'ReactNode', description: 'Avatar slot' },
            { name: 'actions', type: 'ReactNode', description: 'Action buttons slot' },
            { name: 'status', type: "'sending' | 'sent' | 'error'", description: 'Message delivery status' },
            { name: 'size', type: "'xs' | 'sm' | 'md' | 'lg'", description: 'Font size. Falls back to --ov-chat-font-size CSS var.' },
          ]}
        />
      </Section>

      {/* ---- ChatAvatar ---- */}
      <Section title="ChatAvatar" description="Small avatar with role-based defaults and status dot overlay.">
        <ImportStatement code="import { ChatAvatar } from '@omniviewdev/ui/ai';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <ChatAvatar role="user" />
            <ChatAvatar role="assistant" />
            <ChatAvatar role="user" status="online" />
            <ChatAvatar role="assistant" status="busy" />
            <ChatAvatar role="user" status="offline" />
            <ChatAvatar role="user" size={40} />
            <ChatAvatar role="assistant" size={40} status="online" />
          </Box>
        </Example>
      </Section>

      {/* ---- AICodeBlock ---- */}
      <Section title="AICodeBlock" description="Syntax-highlighted code with copy button, language label, and optional line numbers.">
        <ImportStatement code="import { AICodeBlock } from '@omniviewdev/ui/ai';" />

        <Example title="Basic">
          <AICodeBlock code={sampleCode} language="yaml" />
        </Example>

        <Example title="With Line Numbers">
          <AICodeBlock code={sampleCode} language="yaml" showLineNumbers />
        </Example>

        <Example title="Max Height (scrollable)">
          <AICodeBlock code={sampleCode} language="yaml" maxHeight={80} showLineNumbers />
        </Example>

        <PropsTable
          props={[
            { name: 'code', type: 'string', description: 'Code content' },
            { name: 'language', type: 'string', default: '"code"', description: 'Language label' },
            { name: 'showLineNumbers', type: 'boolean', default: 'false', description: 'Show line numbers' },
            { name: 'maxHeight', type: 'number | string', default: '400', description: 'Max height before scrolling' },
            { name: 'onCopy', type: '() => void', description: 'Callback after copy' },
          ]}
        />
      </Section>

      {/* ---- AIMarkdown ---- */}
      <Section title="AIMarkdown" description="Streaming-aware markdown renderer with theme integration.">
        <ImportStatement code="import { AIMarkdown } from '@omniviewdev/ui/ai';" />

        <Example title="Static Markdown">
          <AIMarkdown source={sampleMarkdown} />
        </Example>

        <Example title="Streaming (with cursor)">
          <AIMarkdown source={sampleMarkdown} streaming />
        </Example>
      </Section>

      {/* ---- TypingIndicator ---- */}
      <Section title="TypingIndicator" description="Animated bouncing dots for typing state.">
        <ImportStatement code="import { TypingIndicator } from '@omniviewdev/ui/ai';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Box>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mb: 0.5, display: 'block' }}>
                Default
              </Typography>
              <TypingIndicator />
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mb: 0.5, display: 'block' }}>
                Compact
              </Typography>
              <TypingIndicator compact />
            </Box>
          </Box>
        </Example>
      </Section>

      {/* ---- StreamingText ---- */}
      <Section title="StreamingText" description="Token-like text reveal with variable cadence and smooth tracking cursor, simulating real LLM streaming output.">
        <ImportStatement code="import { StreamingText } from '@omniviewdev/ui/ai';" />

        <Example title="Simulated LLM Response">
          <Box sx={{ mb: 1 }}>
            <button
              onClick={() => setStreamKey((k) => k + 1)}
              style={{
                background: 'var(--ov-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                marginBottom: '8px',
              }}
            >
              Restart Stream
            </button>
          </Box>
          <Box sx={{ fontSize: 'var(--ov-text-base)', color: 'var(--ov-fg-default)', maxWidth: 600, lineHeight: 1.6 }}>
            <StreamingText
              key={streamKey}
              text={"The pod `api-server-xyz` in the default namespace is in a CrashLoopBackOff state with 5 restarts. Looking at the recent events, the container is failing to start due to a missing environment variable `DATABASE_URL`.\n\nI'd recommend checking your ConfigMap or Secret references in the deployment spec. You can fix this by running:\n\n  kubectl set env deployment/api-server DATABASE_URL=postgresql://db:5432/app\n\nOnce updated, the pod should recover automatically within the next backoff interval."}
              speed={2}
            />
          </Box>
        </Example>

        <Example title="Fast Burst (speed=4)">
          <Box sx={{ fontSize: 'var(--ov-text-base)', color: 'var(--ov-fg-default)', maxWidth: 600, lineHeight: 1.6 }}>
            <StreamingText
              key={`fast-${streamKey}`}
              text="Scaling deployment nginx from 3 to 5 replicas. Waiting for rollout to finish: 3 of 5 updated replicas are available. All 5 replicas are now ready and serving traffic."
              speed={4}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'text', type: 'string', description: 'Text to stream' },
            { name: 'speed', type: 'number', default: '2', description: 'Base characters per frame — actual speed varies to simulate token delivery' },
            { name: 'onComplete', type: '() => void', description: 'Called when streaming finishes' },
            { name: 'showCursor', type: 'boolean', default: 'true', description: 'Show smooth tracking cursor' },
          ]}
        />
      </Section>
    </Box>
  );
}
