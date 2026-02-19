import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InboxIcon from '@mui/icons-material/Inbox';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import SizePicker from '../helpers/SizePicker';

import { Alert, StatusDot, StatusPill, EmptyState, ErrorState, Skeleton } from '../../feedback';
import { Button } from '../../buttons';
import type { SemanticColor, Status, ComponentSize } from '../../types';

const alertColors: SemanticColor[] = ['success', 'warning', 'error', 'info', 'primary', 'neutral'];
const statuses: Status[] = ['healthy', 'warning', 'degraded', 'error', 'unknown', 'pending'];

export default function FeedbackPage() {
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [alertSize, setAlertSize] = useState<ComponentSize>('md');

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Feedback
      </Typography>

      {/* ---- Alert ---- */}
      <Section
        title="Alert"
        description="Consistent alert component with semantic colors and emphasis variants."
      >
        <ImportStatement code="import { Alert } from '@omniviewdev/ui/feedback';" />
        <SizePicker value={alertSize} onChange={setAlertSize} />

        <Example title="Colors (soft emphasis)">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {alertColors.map((color) => (
              <Alert key={color} color={color} emphasis="soft" size={alertSize}>
                This is a <strong>{color}</strong> alert with soft emphasis.
              </Alert>
            ))}
          </Box>
        </Example>

        <Example title="Emphasis variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Alert color="info" emphasis="solid" size={alertSize}>Solid emphasis alert.</Alert>
            <Alert color="info" emphasis="soft" size={alertSize}>Soft emphasis alert.</Alert>
            <Alert color="info" emphasis="outline" size={alertSize}>Outline emphasis alert.</Alert>
          </Box>
        </Example>

        <Example title="Dismissible">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {!dismissedAlerts.includes('demo') && (
              <Alert
                color="warning"
                emphasis="soft"
                size={alertSize}
                dismissible
                onDismiss={() => setDismissedAlerts((prev) => [...prev, 'demo'])}
              >
                This alert can be dismissed. Click the X button.
              </Alert>
            )}
            {dismissedAlerts.includes('demo') && (
              <Button
                emphasis="outline"
                color="primary"
                size="sm"
                onClick={() => setDismissedAlerts([])}
              >
                Reset
              </Button>
            )}
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'color', type: 'SemanticColor', default: '"info"', description: 'Alert color.' },
            { name: 'emphasis', type: '"solid" | "soft" | "outline"', default: '"soft"', description: 'Visual weight.' },
            { name: 'size', type: 'ComponentSize', default: '"md"', description: 'Controls padding, font size, icon size.' },
            { name: 'dismissible', type: 'boolean', default: 'false', description: 'Show dismiss button.' },
            { name: 'onDismiss', type: '() => void', description: 'Called when dismissed.' },
            { name: 'actions', type: 'ReactNode', description: 'Custom action elements.' },
            { name: 'icon', type: 'ReactNode | false', description: 'Custom icon or false to hide.' },
          ]}
        />
      </Section>

      {/* ---- StatusDot ---- */}
      <Section
        title="StatusDot"
        description="Colored dot indicator for status values."
      >
        <ImportStatement code="import { StatusDot } from '@omniviewdev/ui/feedback';" />

        <Example title="All statuses">
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {statuses.map((status) => (
              <StatusDot key={status} status={status} label={status} />
            ))}
          </Box>
        </Example>

        <Example title="With pulse">
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <StatusDot status="healthy" label="Running" pulse />
            <StatusDot status="pending" label="Starting" pulse />
          </Box>
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <StatusDot status="healthy" label="xs" size="xs" />
            <StatusDot status="healthy" label="sm" size="sm" />
            <StatusDot status="healthy" label="md" size="md" />
            <StatusDot status="healthy" label="lg" size="lg" />
            <StatusDot status="healthy" label="xl" size="xl" />
          </Box>
        </Example>
      </Section>

      {/* ---- StatusPill ---- */}
      <Section
        title="StatusPill"
        description="Chip-style status indicator."
      >
        <ImportStatement code="import { StatusPill } from '@omniviewdev/ui/feedback';" />

        <Example title="All statuses">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {statuses.map((status) => (
              <StatusPill key={status} status={status} />
            ))}
          </Box>
        </Example>
      </Section>

      {/* ---- EmptyState ---- */}
      <Section
        title="EmptyState"
        description="Centered empty state placeholder with optional icon and actions."
      >
        <ImportStatement code="import { EmptyState } from '@omniviewdev/ui/feedback';" />

        <Example title="With icon and actions">
          <EmptyState
            icon={<InboxIcon fontSize="inherit" />}
            title="No resources found"
            description="There are no pods running in this namespace. Create one to get started."
            primaryAction={<Button emphasis="solid" color="primary" size="sm">Create Pod</Button>}
            secondaryAction={<Button emphasis="ghost" color="neutral" size="sm">Learn more</Button>}
          />
        </Example>

        <Example title="Minimal">
          <EmptyState title="No results" size="sm" />
        </Example>
      </Section>

      {/* ---- ErrorState ---- */}
      <Section
        title="ErrorState"
        description="Error display with retry support and error ID copying."
      >
        <ImportStatement code="import { ErrorState } from '@omniviewdev/ui/feedback';" />

        <Example title="Panel variant (default)">
          <ErrorState
            message="Failed to fetch pod list from cluster."
            errorId="ERR-2024-0042"
            onRetry={() => {}}
          />
        </Example>

        <Example title="Inline variant">
          <ErrorState
            variant="inline"
            message="Connection timeout"
            onRetry={() => {}}
          />
        </Example>
      </Section>

      {/* ---- Skeleton ---- */}
      <Section
        title="Skeleton"
        description="Loading placeholder skeletons."
      >
        <ImportStatement code="import { Skeleton } from '@omniviewdev/ui/feedback';" />

        <Example title="Variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
            <Skeleton variant="text" />
            <Skeleton variant="rectangular" height={80} />
            <Skeleton variant="rounded" height={80} />
            <Skeleton variant="circular" width={48} height={48} />
          </Box>
        </Example>

        <Example title="Multi-line text">
          <Box sx={{ maxWidth: 400 }}>
            <Skeleton lines={4} />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
