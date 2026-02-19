import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuBox, LuServer, LuKey, LuShield } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ResourceRef, ResourceStatus } from '../../domain';

export default function ResourceRefPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Resource Components
      </Typography>

      {/* ResourceRef */}
      <Section title="ResourceRef" description="Compact reference to a Kubernetes resource with kind, name, and optional namespace.">
        <ImportStatement code="import { ResourceRef } from '@omniviewdev/ui/domain';" />

        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ResourceRef kind="Pod" name="nginx-abc123" namespace="default" icon={<LuBox size={14} />} />
            <ResourceRef kind="Node" name="worker-01" icon={<LuServer size={14} />} />
            <ResourceRef kind="Secret" name="db-credentials" namespace="backend" icon={<LuKey size={14} />} />
          </Box>
        </Example>

        <Example title="Interactive" description="Clickable link style.">
          <ResourceRef
            kind="Deployment"
            name="api-server"
            namespace="production"
            icon={<LuShield size={14} />}
            interactive
            onNavigate={() => alert('Navigate to api-server')}
          />
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
              <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', width: 24 }}>{s}</Typography>
                <ResourceRef kind="Pod" name="nginx" size={s} icon={<LuBox size={14} />} />
              </Box>
            ))}
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'kind', type: 'string', description: 'Resource kind (Pod, Service, etc.)' },
            { name: 'name', type: 'string', description: 'Resource name' },
            { name: 'namespace', type: 'string', description: 'Namespace (shown in parentheses)' },
            { name: 'icon', type: 'ReactNode', description: 'Icon before the kind chip' },
            { name: 'interactive', type: 'boolean', default: 'false', description: 'Render as clickable link' },
            { name: 'onNavigate', type: '() => void', description: 'Click handler when interactive' },
            { name: 'size', type: 'ComponentSize', default: "'sm'", description: 'Font and chip size' },
          ]}
        />
      </Section>

      {/* ResourceStatus */}
      <Section title="ResourceStatus" description="Kubernetes status indicator with automatic color mapping.">
        <ImportStatement code="import { ResourceStatus } from '@omniviewdev/ui/domain';" />

        <Example title="Status Values">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {['Running', 'Pending', 'Succeeded', 'Failed', 'CrashLoopBackOff', 'Terminating', 'Unknown'].map((s) => (
              <ResourceStatus key={s} status={s} />
            ))}
          </Box>
        </Example>

        <Example title="With Conditions Tooltip" description="Hover to see conditions.">
          <ResourceStatus
            status="Running"
            conditions={[
              { type: 'Ready', status: 'True' },
              { type: 'ContainersReady', status: 'True' },
              { type: 'Initialized', status: 'True' },
              { type: 'PodScheduled', status: 'True' },
            ]}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'status', type: 'string', description: 'Kubernetes status string' },
            { name: 'conditions', type: 'Condition[]', description: 'Pod/resource conditions for tooltip' },
            { name: 'size', type: 'ComponentSize', default: "'sm'", description: 'Size of the status pill' },
            { name: 'showTooltip', type: 'boolean', default: 'true', description: 'Show conditions in tooltip' },
          ]}
        />
      </Section>
    </Box>
  );
}
