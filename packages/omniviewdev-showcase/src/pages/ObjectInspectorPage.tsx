import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';

import { ObjectInspector } from '@omniviewdev/ui/domain';

const samplePod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: 'nginx-abc123',
    namespace: 'default',
    labels: {
      app: 'nginx',
      version: 'v1.25',
    },
    creationTimestamp: '2024-01-15T10:30:00Z',
  },
  spec: {
    nodeName: 'worker-01',
    containers: 'nginx',
    restartPolicy: 'Always',
  },
  status: {
    phase: 'Running',
    podIP: '10.244.1.42',
    hostIP: '192.168.1.10',
    startTime: '2024-01-15T10:30:05Z',
  },
};

export default function ObjectInspectorPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        ObjectInspector
      </Typography>

      <Section
        title="ObjectInspector"
        description="Tabbed inspector for Kubernetes objects. Shows Summary, YAML, and JSON tabs by default."
      >
        <ImportStatement code="import { ObjectInspector } from '@omniviewdev/ui/domain';" />

        <Example title="Pod Inspector">
          <ObjectInspector
            data={samplePod}
            title="Pod: nginx-abc123"
          />
        </Example>

        <Example title="With Custom Tabs">
          <ObjectInspector
            data={samplePod}
            title="Pod with Events Tab"
            tabs={[
              {
                key: 'events',
                label: 'Events',
                content: (
                  <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)' }}>
                    Events would be rendered here using EventsList component.
                  </Typography>
                ),
              },
            ]}
          />
        </Example>
      </Section>
    </Box>
  );
}
