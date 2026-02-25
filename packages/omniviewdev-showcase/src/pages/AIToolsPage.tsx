import { Box, Typography } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import {
  ToolCall,
  ToolCallList,
  ToolResult,
  ActionBar,
} from '@omniviewdev/ui/ai';
import {
  ThinkingBlock,
  ChainOfThought,
  ChainOfThoughtStep,
  AILoader,
} from '@omniviewdev/ui/ai';

export default function AIToolsPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Tools & Reasoning
      </Typography>

      {/* ---- ToolCall ---- */}
      <Section title="ToolCall" description="Expandable card showing tool name, args, duration, and result.">
        <ImportStatement code="import { ToolCall } from '@omniviewdev/ui/ai';" />

        <Example title="Status Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 500 }}>
            <ToolCall
              name="kubectl.get_pods"
              status="success"
              duration={245}
              args={{ namespace: 'default', labelSelector: 'app=nginx' }}
              result={{ count: 3, pods: ['nginx-abc', 'nginx-def', 'nginx-ghi'] }}
            />
            <ToolCall
              name="kubectl.describe_pod"
              status="running"
              args={{ name: 'api-server-xyz', namespace: 'default' }}
            />
            <ToolCall
              name="kubectl.delete_pod"
              status="error"
              duration={1200}
              args={{ name: 'api-server-xyz' }}
              error={'Error: pods "api-server-xyz" is forbidden'}
            />
            <ToolCall
              name="kubectl.get_events"
              status="pending"
              args={{ namespace: 'default' }}
            />
          </Box>
        </Example>

        <Example title="Default Expanded">
          <Box sx={{ maxWidth: 500 }}>
            <ToolCall
              name="kubectl.get_deployment"
              status="success"
              duration={120}
              defaultExpanded
              args={{ name: 'nginx', namespace: 'default' }}
              result={{
                name: 'nginx',
                replicas: 3,
                availableReplicas: 3,
                conditions: [{ type: 'Available', status: 'True' }],
              }}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'name', type: 'string', description: 'Tool name' },
            { name: 'args', type: 'Record<string, unknown>', description: 'Tool arguments' },
            { name: 'result', type: 'unknown', description: 'Tool result' },
            { name: 'status', type: "'pending' | 'running' | 'success' | 'error'", description: 'Execution status' },
            { name: 'duration', type: 'number', description: 'Duration in ms' },
            { name: 'defaultExpanded', type: 'boolean', default: 'false', description: 'Start expanded' },
            { name: 'error', type: 'string', description: 'Error message' },
          ]}
        />
      </Section>

      {/* ---- ToolCallList ---- */}
      <Section title="ToolCallList" description="Vertical stack of ToolCall items with connecting line.">
        <ImportStatement code="import { ToolCallList } from '@omniviewdev/ui/ai';" />

        <Example title="Multiple Calls">
          <Box sx={{ maxWidth: 500 }}>
            <ToolCallList
              calls={[
                { name: 'kubectl.get_pods', status: 'success', duration: 245, args: { namespace: 'default' } },
                { name: 'kubectl.get_logs', status: 'success', duration: 890, args: { pod: 'api-server-xyz' } },
                { name: 'kubectl.describe_pod', status: 'running', args: { pod: 'api-server-xyz' } },
              ]}
            />
          </Box>
        </Example>
      </Section>

      {/* ---- ToolResult ---- */}
      <Section title="ToolResult" description="Standalone result display for text, JSON, and errors.">
        <ImportStatement code="import { ToolResult } from '@omniviewdev/ui/ai';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 500 }}>
            <ToolResult result="Pod nginx-abc is running and healthy." />
            <ToolResult result={{ replicas: 3, ready: 3, updated: 3 }} />
            <ToolResult result={null} error="Connection refused: unable to reach API server" />
          </Box>
        </Example>
      </Section>

      {/* ---- ActionBar ---- */}
      <Section title="ActionBar" description="Row of icon buttons: copy, regenerate, thumbs up/down.">
        <ImportStatement code="import { ActionBar } from '@omniviewdev/ui/ai';" />

        <Example title="Always Visible">
          <ActionBar
            content="Sample content to copy"
            onCopy={() => {}}
            onRegenerate={() => {}}
            onThumbsUp={() => {}}
            onThumbsDown={() => {}}
            alwaysVisible
          />
        </Example>
      </Section>

      {/* ---- ThinkingBlock ---- */}
      <Section title="ThinkingBlock" description="Collapsible section with animated shimmer border while active.">
        <ImportStatement code="import { ThinkingBlock } from '@omniviewdev/ui/ai';" />

        <Example title="Active vs Completed">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            <ThinkingBlock
              thinking="Let me analyze the pod's crash loop. I'll check the container's exit code, recent events, and resource limits to determine the root cause..."
              isActive
            />
            <ThinkingBlock
              thinking="The pod is crashing because the memory limit of 128Mi is too low for the application. The OOMKilled events confirm this."
              isActive={false}
              defaultExpanded
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'thinking', type: 'string', description: 'Thinking content text' },
            { name: 'isActive', type: 'boolean', default: 'false', description: 'Shows shimmer animation' },
            { name: 'defaultExpanded', type: 'boolean', default: 'false', description: 'Start expanded' },
            { name: 'label', type: 'string', default: '"Thinking..."', description: 'Header label' },
          ]}
        />
      </Section>

      {/* ---- ChainOfThought ---- */}
      <Section title="ChainOfThought" description="Vertical stepper with status icons and collapsible step content.">
        <ImportStatement code="import { ChainOfThought, ChainOfThoughtStep } from '@omniviewdev/ui/ai';" />

        <Example title="Multi-step Reasoning">
          <Box sx={{ maxWidth: 500 }}>
            <ChainOfThought>
              <ChainOfThoughtStep label="Analyzing query" status="complete" />
              <ChainOfThoughtStep label="Searching resources" status="complete">
                Found 3 pods matching criteria in the default namespace.
              </ChainOfThoughtStep>
              <ChainOfThoughtStep label="Checking pod health" status="active">
                Examining container statuses and recent events...
              </ChainOfThoughtStep>
              <ChainOfThoughtStep label="Generating response" status="pending" />
            </ChainOfThought>
          </Box>
        </Example>
      </Section>

      {/* ---- AILoader ---- */}
      <Section title="AILoader" description="General processing indicator with label.">
        <ImportStatement code="import { AILoader } from '@omniviewdev/ui/ai';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <AILoader />
            <AILoader label="Analyzing cluster..." />
            <AILoader label="Generating report..." size={16} />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
