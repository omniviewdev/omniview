import { useState, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import {
  AgentStatusItem,
  AgentPopup,
  AgentTaskList,
  AgentControls,
  AgentBanner,
} from '@omniviewdev/ui/ai';
import type { AgentTask, AgentStatus } from '@omniviewdev/ui/ai';

const mockTasks: AgentTask[] = [
  { id: '1', label: 'Analyzing deployment configuration', status: 'complete', timestamp: '10:00' },
  { id: '2', label: 'Checking pod health status', status: 'complete', timestamp: '10:01', detail: 'Found 2 unhealthy pods' },
  { id: '3', label: 'Reviewing resource limits', status: 'running', timestamp: '10:02' },
  { id: '4', label: 'Generating recommendations', status: 'queued' },
];

const statuses: AgentStatus[] = ['idle', 'running', 'paused', 'error', 'completed'];

export default function AIAgentStatusPage() {
  const [popupOpen, setPopupOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Agent Status
      </Typography>

      {/* ---- AgentStatusItem ---- */}
      <Section title="AgentStatusItem" description="Status bar item for the bottom bar showing agent state.">
        <ImportStatement code="import { AgentStatusItem } from '@omniviewdev/ui/ai';" />

        <Example title="All States">
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              p: 1,
              bgcolor: 'var(--ov-bg-surface)',
              borderRadius: '4px',
              border: '1px solid var(--ov-border-default)',
            }}
          >
            {statuses.map((status) => (
              <AgentStatusItem
                key={status}
                status={status}
                taskName={status === 'running' ? 'Analyzing cluster' : undefined}
                progress={status === 'running' ? 67 : undefined}
              />
            ))}
          </Box>
        </Example>

        <Example title="Clickable (opens popup)">
          <Box
            ref={anchorRef}
            sx={{
              display: 'inline-flex',
              p: 1,
              bgcolor: 'var(--ov-bg-surface)',
              borderRadius: '4px',
              border: '1px solid var(--ov-border-default)',
            }}
          >
            <AgentStatusItem
              status="running"
              taskName="Analyzing cluster health"
              progress={67}
              onClick={() => setPopupOpen(true)}
            />
          </Box>
          <AgentPopup
            open={popupOpen}
            anchorEl={anchorRef.current}
            onClose={() => setPopupOpen(false)}
            agent={{
              id: 'agent-1',
              status: 'running',
              taskName: 'Cluster Health Analysis',
              startedAt: '2 minutes ago',
              tasks: mockTasks,
              output: [
                '> Checking deployment nginx...',
                '> Found 3 replicas, all healthy',
                '> Checking deployment api-server...',
                '> WARNING: 2 pods in CrashLoopBackOff',
              ],
            }}
            onPause={() => alert('Paused')}
            onCancel={() => setPopupOpen(false)}
            onDetach={() => alert('Detached')}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'status', type: "'idle' | 'running' | 'paused' | 'error' | 'completed'", description: 'Agent state' },
            { name: 'taskName', type: 'string', description: 'Current task label' },
            { name: 'progress', type: 'number', description: 'Progress 0-100' },
            { name: 'onClick', type: '() => void', description: 'Click handler (opens popup)' },
          ]}
        />
      </Section>

      {/* ---- AgentTaskList ---- */}
      <Section title="AgentTaskList" description="List of agent tasks with status icons and timestamps.">
        <ImportStatement code="import { AgentTaskList } from '@omniviewdev/ui/ai';" />

        <Example title="Task List">
          <Box sx={{ maxWidth: 400 }}>
            <AgentTaskList tasks={mockTasks} />
          </Box>
        </Example>
      </Section>

      {/* ---- AgentControls ---- */}
      <Section title="AgentControls" description="Control buttons: pause, resume, cancel, detach.">
        <ImportStatement code="import { AgentControls } from '@omniviewdev/ui/ai';" />

        <Example title="Running vs Paused">
          <Box sx={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Box>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', display: 'block', mb: 0.5 }}>
                Running
              </Typography>
              <AgentControls
                status="running"
                onPause={() => {}}
                onCancel={() => {}}
                onDetach={() => {}}
              />
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', display: 'block', mb: 0.5 }}>
                Paused
              </Typography>
              <AgentControls
                status="paused"
                onResume={() => {}}
                onCancel={() => {}}
              />
            </Box>
          </Box>
        </Example>
      </Section>

      {/* ---- AgentBanner ---- */}
      <Section title="AgentBanner" description="Inline banner for background agent status.">
        <ImportStatement code="import { AgentBanner } from '@omniviewdev/ui/ai';" />

        <Example title="Status Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <AgentBanner status="running" taskName="Cluster Health Analysis" onView={() => {}} />
            <AgentBanner status="paused" taskName="Security Audit" onView={() => {}} onDismiss={() => {}} />
            <AgentBanner status="completed" taskName="Resource Optimization" onView={() => {}} onDismiss={() => {}} />
            <AgentBanner status="error" taskName="Network Analysis" onView={() => {}} onDismiss={() => {}} />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
