import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { MetricCard, SecretValueMask, DescriptionList } from '@omniviewdev/ui/domain';

export default function MetricCardPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        MetricCard, SecretValueMask & DescriptionList
      </Typography>

      {/* MetricCard */}
      <Section
        title="MetricCard"
        description="Stat card with label, value, unit, delta indicator, sparkline slot, and loading state."
      >
        <ImportStatement code="import { MetricCard } from '@omniviewdev/ui/domain';" />

        <Example title="Metrics Grid">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
            <MetricCard label="CPU Usage" value={42} unit="%" delta={5.2} deltaDirection="up" />
            <MetricCard label="Memory" value="1.8" unit="GiB" delta={-3.1} deltaDirection="down" />
            <MetricCard label="Pods Running" value={24} delta={0} deltaDirection="neutral" />
            <MetricCard label="Requests/sec" value="1.2k" unit="req/s" delta={12} deltaDirection="up" />
          </Box>
        </Example>

        <Example title="Loading State">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
            <MetricCard label="" value="" loading />
            <MetricCard label="" value="" loading />
            <MetricCard label="" value="" loading />
          </Box>
        </Example>

        <Example title="Without Delta">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
            <MetricCard label="Nodes" value={5} />
            <MetricCard label="Namespaces" value={12} />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'label', type: 'string', description: 'Metric label text' },
            { name: 'value', type: 'string | number', description: 'Display value' },
            { name: 'unit', type: 'string', description: 'Unit suffix (%, GiB, etc.)' },
            { name: 'delta', type: 'number', description: 'Percentage change value' },
            { name: 'deltaDirection', type: "'up' | 'down' | 'neutral'", default: "'neutral'", description: 'Color of delta indicator' },
            { name: 'sparkline', type: 'ReactNode', description: 'Sparkline chart slot' },
            { name: 'loading', type: 'boolean', default: 'false', description: 'Show skeleton loading' },
          ]}
        />
      </Section>

      {/* SecretValueMask */}
      <Section
        title="SecretValueMask"
        description="Masked secret value with reveal toggle and optional copy button."
      >
        <ImportStatement code="import { SecretValueMask } from '@omniviewdev/ui/domain';" />

        <Example title="Basic">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <SecretValueMask value="super-secret-api-key-12345" />
            <SecretValueMask value="database-password-xyz" copyable />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'The secret value to mask' },
            { name: 'revealed', type: 'boolean', description: 'Controlled reveal state' },
            { name: 'onReveal', type: '() => void', description: 'Callback on reveal toggle' },
            { name: 'copyable', type: 'boolean', default: 'false', description: 'Show copy button for raw value' },
          ]}
        />
      </Section>

      {/* DescriptionList */}
      <Section
        title="DescriptionList"
        description="Key-value pairs in a definition list layout with grid columns."
      >
        <ImportStatement code="import { DescriptionList } from '@omniviewdev/ui/domain';" />

        <Example title="Single Column">
          <DescriptionList
            items={[
              { label: 'Name', value: 'nginx-abc123' },
              { label: 'Namespace', value: 'default' },
              { label: 'Node', value: 'worker-01' },
              { label: 'Status', value: 'Running' },
              { label: 'IP', value: '10.244.1.42', copyable: true },
            ]}
          />
        </Example>

        <Example title="Two Columns">
          <DescriptionList
            columns={2}
            items={[
              { label: 'API Version', value: 'v1' },
              { label: 'Kind', value: 'Pod' },
              { label: 'Name', value: 'nginx-abc123' },
              { label: 'Namespace', value: 'default' },
              { label: 'UID', value: 'a1b2c3d4-e5f6', copyable: true },
              { label: 'Created', value: '2024-01-15T10:30:00Z' },
            ]}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'items', type: 'DescriptionItem[]', description: 'Key-value items to display' },
            { name: 'columns', type: '1 | 2 | 3', default: '1', description: 'Grid column count' },
            { name: 'size', type: 'ComponentSize', default: "'sm'", description: 'Font size' },
          ]}
        />
      </Section>
    </Box>
  );
}
