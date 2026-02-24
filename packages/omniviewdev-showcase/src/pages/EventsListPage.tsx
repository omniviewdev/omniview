import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { EventsList } from '@omniviewdev/ui/domain';
import type { KubeEvent } from '@omniviewdev/ui/domain';

const sampleEvents: KubeEvent[] = [
  {
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Successfully assigned default/nginx-abc123 to worker-01',
    count: 1,
    firstTimestamp: '2024-01-15T10:30:00Z',
    lastTimestamp: '2024-01-15T10:30:00Z',
    involvedObject: { kind: 'Pod', name: 'nginx-abc123', namespace: 'default' },
  },
  {
    type: 'Normal',
    reason: 'Pulling',
    message: 'Pulling image "nginx:1.25"',
    count: 1,
    firstTimestamp: '2024-01-15T10:30:01Z',
    lastTimestamp: '2024-01-15T10:30:01Z',
    involvedObject: { kind: 'Pod', name: 'nginx-abc123', namespace: 'default' },
  },
  {
    type: 'Normal',
    reason: 'Pulled',
    message: 'Successfully pulled image "nginx:1.25" in 2.3s',
    count: 1,
    firstTimestamp: '2024-01-15T10:30:03Z',
    lastTimestamp: '2024-01-15T10:30:03Z',
    involvedObject: { kind: 'Pod', name: 'nginx-abc123', namespace: 'default' },
  },
  {
    type: 'Normal',
    reason: 'Started',
    message: 'Started container nginx',
    count: 1,
    firstTimestamp: '2024-01-15T10:30:04Z',
    lastTimestamp: '2024-01-15T10:30:04Z',
    involvedObject: { kind: 'Pod', name: 'nginx-abc123', namespace: 'default' },
  },
  {
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container sidecar in pod api-server-xyz789',
    count: 12,
    firstTimestamp: '2024-01-15T09:00:00Z',
    lastTimestamp: '2024-01-15T10:25:00Z',
    involvedObject: { kind: 'Pod', name: 'api-server-xyz789', namespace: 'production' },
  },
  {
    type: 'Warning',
    reason: 'FailedMount',
    message: 'MountVolume.SetUp failed for volume "config-vol": configmap "app-config" not found',
    count: 3,
    firstTimestamp: '2024-01-15T10:10:00Z',
    lastTimestamp: '2024-01-15T10:20:00Z',
    involvedObject: { kind: 'Pod', name: 'worker-pod-001', namespace: 'staging' },
  },
  {
    type: 'Normal',
    reason: 'ScalingReplicaSet',
    message: 'Scaled up replica set api-server-6f7d8c9 to 3',
    count: 1,
    firstTimestamp: '2024-01-15T10:28:00Z',
    lastTimestamp: '2024-01-15T10:28:00Z',
    involvedObject: { kind: 'Deployment', name: 'api-server', namespace: 'production' },
  },
];

export default function EventsListPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        EventsList
      </Typography>

      <Section
        title="EventsList"
        description="Filterable Kubernetes event list showing type, reason, message, count, and age."
      >
        <ImportStatement code="import { EventsList } from '@omniviewdev/ui/domain';" />

        <Example title="Basic Events">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <EventsList events={sampleEvents} />
          </Box>
        </Example>

        <Example title="Warning Events Only">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <EventsList events={sampleEvents.filter((e) => e.type === 'Warning')} />
          </Box>
        </Example>

        <Example title="Loading State">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <EventsList events={[]} loading />
          </Box>
        </Example>

        <Example title="Empty State">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <EventsList events={[]} />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'events', type: 'KubeEvent[]', description: 'Array of Kubernetes events to display' },
            { name: 'loading', type: 'boolean', default: 'false', description: 'Show loading spinner' },
            { name: 'groupBy', type: "'object' | 'time'", description: 'Group events by involved object or time bucket' },
          ]}
        />
      </Section>
    </Box>
  );
}
