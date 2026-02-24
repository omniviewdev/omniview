import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuGitBranch, LuBell, LuCircleAlert, LuTriangleAlert } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { StatusBar, StatusBarItem, ProgressBar, ConnectionIndicator, RunButton } from '@omniviewdev/ui/feedback';
import type { ConnectionStatus } from '@omniviewdev/ui/feedback';

const connectionStatuses: ConnectionStatus[] = ['connected', 'connecting', 'disconnected', 'error'];

export default function StatusBarPage() {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleStart = () => {
    setLoading(true);
    setTimeout(() => { setLoading(false); setRunning(true); }, 1000);
  };

  const handleStop = () => {
    setLoading(true);
    setTimeout(() => { setLoading(false); setRunning(false); }, 500);
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Status Bar & Feedback
      </Typography>

      <Section title="StatusBar & StatusBarItem" description="Fixed-height bottom bar with left/right item grouping.">
        <ImportStatement code="import { StatusBar, StatusBarItem } from '@omniviewdev/ui/feedback';" />

        <Example title="Full Status Bar">
          <StatusBar>
            <StatusBarItem icon={<LuGitBranch size={12} />} separator>main</StatusBarItem>
            <StatusBarItem icon={<LuCircleAlert size={12} />} color="error">3</StatusBarItem>
            <StatusBarItem icon={<LuTriangleAlert size={12} />} color="warning">12</StatusBarItem>
            <StatusBarItem align="right" icon={<LuBell size={12} />} onClick={() => {}}>Notifications</StatusBarItem>
            <StatusBarItem align="right">Ln 42, Col 18</StatusBarItem>
            <StatusBarItem align="right">UTF-8</StatusBarItem>
          </StatusBar>
        </Example>

        <PropsTable
          props={[
            { name: 'children', type: 'ReactNode', description: 'StatusBarItem children.' },
            { name: 'height', type: 'number', default: '24', description: 'Bar height in pixels.' },
            { name: 'align', type: '"left" | "right"', default: '"left"', description: '(StatusBarItem) Which side to group into.' },
            { name: 'icon', type: 'ReactNode', description: '(StatusBarItem) Icon before text.' },
            { name: 'onClick', type: '() => void', description: '(StatusBarItem) Makes the item clickable.' },
            { name: 'tooltip', type: 'string', description: '(StatusBarItem) Tooltip on hover.' },
            { name: 'color', type: 'SemanticColor', description: '(StatusBarItem) Text color.' },
            { name: 'separator', type: 'boolean', description: '(StatusBarItem) Show right border separator.' },
          ]}
        />
      </Section>

      <Section title="ProgressBar" description="Linear progress bar with determinate and indeterminate modes.">
        <ImportStatement code="import { ProgressBar } from '@omniviewdev/ui/feedback';" />

        <Example title="Determinate">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ProgressBar value={30} label="Uploading..." showValue />
            <ProgressBar value={75} color="success" label="Build progress" showValue size="md" />
            <ProgressBar value={90} color="warning" size="lg" />
          </Box>
        </Example>

        <Example title="Indeterminate">
          <ProgressBar indeterminate color="primary" label="Loading..." />
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <ProgressBar value={60} size="xs" />
            <ProgressBar value={60} size="sm" />
            <ProgressBar value={60} size="md" />
            <ProgressBar value={60} size="lg" />
            <ProgressBar value={60} size="xl" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'number', description: 'Progress value (0-100).' },
            { name: 'indeterminate', type: 'boolean', default: 'false', description: 'Show animated indeterminate bar.' },
            { name: 'color', type: 'SemanticColor', default: '"primary"', description: 'Bar color.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Bar height.' },
            { name: 'label', type: 'string', description: 'Label above the bar.' },
            { name: 'showValue', type: 'boolean', default: 'false', description: 'Show percentage text.' },
          ]}
        />
      </Section>

      <Section title="ConnectionIndicator" description="Small colored dot with optional label for connection status.">
        <ImportStatement code="import { ConnectionIndicator } from '@omniviewdev/ui/feedback';" />

        <Example title="All States">
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {connectionStatuses.map((status) => (
              <ConnectionIndicator key={status} status={status} />
            ))}
          </Box>
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <ConnectionIndicator status="connected" size="xs" label="xs" />
            <ConnectionIndicator status="connected" size="sm" label="sm" />
            <ConnectionIndicator status="connected" size="md" label="md" />
            <ConnectionIndicator status="connected" size="lg" label="lg" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'status', type: '"connected" | "connecting" | "disconnected" | "error"', description: 'Connection status.' },
            { name: 'label', type: 'string', description: 'Override the default label.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Dot and label size.' },
            { name: 'showLabel', type: 'boolean', default: 'true', description: 'Whether to show the label text.' },
          ]}
        />
      </Section>

      <Section title="RunButton" description="Play/Stop toggle button. Shows spinner when transitioning between states.">
        <ImportStatement code="import { RunButton } from '@omniviewdev/ui/feedback';" />

        <Example title="Interactive Run/Stop">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <RunButton
              running={running}
              onStart={handleStart}
              onStop={handleStop}
              loading={loading}
            />
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)' }}>
              Status: {loading ? 'transitioning...' : running ? 'Running' : 'Stopped'}
            </Typography>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'running', type: 'boolean', description: 'Whether the process is currently running.' },
            { name: 'onStart', type: '() => void', description: 'Called when the user clicks Play.' },
            { name: 'onStop', type: '() => void', description: 'Called when the user clicks Stop.' },
            { name: 'loading', type: 'boolean', default: 'false', description: 'Shows spinner during state transitions.' },
            { name: 'label', type: 'string', description: 'Override default "Run"/"Stop" label.' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Button size.' },
          ]}
        />
      </Section>
    </Box>
  );
}
