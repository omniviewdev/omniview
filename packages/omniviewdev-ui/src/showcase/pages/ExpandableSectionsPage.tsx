import { Typography, Box } from '@mui/material';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import ExpandableSections from '../../components/ExpandableSections';
import type { ExpandableSection } from '../../components/ExpandableSections';

// ---------------------------------------------------------------------------
// Basic Usage
// ---------------------------------------------------------------------------

function BasicUsageSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'Overview',
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            This deployment manages 3 replicas of the nginx:1.25 container
            image, running in the production namespace. All pods are healthy
            and serving traffic through the nginx-service ClusterIP.
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Metadata',
      children: (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            <strong>Name:</strong> nginx-deployment
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            <strong>Namespace:</strong> production
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            <strong>Created:</strong> 2025-11-03T08:12:44Z
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Events',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)' }}>
            No recent events recorded for this resource.
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Basic Usage"
      description="A group of accordion sections rendered inside a bordered container. Each section can be independently expanded or collapsed. Use defaultExpanded to control the initial state."
    >
      <ImportStatement
        code={`import ExpandableSections from '@omniviewdev/ui/components/ExpandableSections';
import type { ExpandableSection } from '@omniviewdev/ui/components/ExpandableSections';`}
      />

      <Example title="Three Sections" description="An overview section starts expanded while the others are collapsed.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// With Icons
// ---------------------------------------------------------------------------

function WithIconsSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'Containers',
      icon: 'LuBox',
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            2 containers: <strong>nginx</strong> (port 80) and{' '}
            <strong>istio-proxy</strong> (port 15001).
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Labels',
      icon: 'LuTag',
      children: (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            app=nginx
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            env=production
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            team=platform
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Activity',
      icon: 'LuActivity',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            Last scaled at 2025-12-01T14:32:00Z from 2 to 3 replicas.
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="With Icons"
      description="Each section can display an icon in its header. Pass a string name from the icon library (e.g. 'LuBox') or a ReactNode."
    >
      <Example title="Icon Strings" description="Sections with LuBox, LuTag, and LuActivity icons.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Monospace Mode
// ---------------------------------------------------------------------------

function MonospaceSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'spec.containers[0]',
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)' }}
          >
            name: nginx{'\n'}
            image: nginx:1.25{'\n'}
            ports:{'\n'}
            {'  '}- containerPort: 80
          </Typography>
        </Box>
      ),
    },
    {
      title: 'spec.volumes',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)' }}
          >
            - name: config-volume{'\n'}
            {'  '}configMap:{'\n'}
            {'    '}name: nginx-config
          </Typography>
        </Box>
      ),
    },
    {
      title: 'status.conditions',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)' }}
          >
            - type: Available{'\n'}
            {'  '}status: "True"{'\n'}
            {'  '}reason: MinimumReplicasAvailable
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Monospace Mode"
      description="Enable monospace={true} to render section titles in a monospace font, useful when titles represent code paths or spec keys."
    >
      <Example title="Spec Paths" description="Section titles styled as YAML spec paths with monospace typography.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} monospace />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Props Tables
// ---------------------------------------------------------------------------

function PropsSection() {
  return (
    <Section title="Props Reference">
      <Typography
        variant="subtitle1"
        sx={{ fontWeight: 600, color: 'var(--ov-fg-base)', mb: '12px' }}
      >
        ExpandableSections
      </Typography>
      <PropsTable
        props={[
          { name: 'sections', type: 'ExpandableSection[]', description: 'Array of section definitions to render as accordion items.' },
          { name: 'monospace', type: 'boolean', default: 'false', description: 'Renders section titles in a monospace font when true.' },
        ]}
      />

      <Box sx={{ mt: 3 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, color: 'var(--ov-fg-base)', mb: '12px' }}
        >
          ExpandableSection
        </Typography>
        <PropsTable
          props={[
            { name: 'title', type: 'string', description: 'Text displayed in the accordion summary.' },
            { name: 'icon', type: 'string | ReactNode', description: 'Icon rendered inside the section header chip. Strings resolve via the Icon component.' },
            { name: 'endDecorator', type: 'ReactNode', description: 'Element rendered at the trailing edge of the summary row.' },
            { name: 'children', type: 'ReactNode', description: 'Content displayed when the section is expanded.' },
            { name: 'defaultExpanded', type: 'boolean', default: 'false', description: 'Whether the section starts in the expanded state.' },
          ]}
        />
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpandableSectionsPage() {
  return (
    <>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-bold)',
          color: 'var(--ov-fg-base)',
          mb: '32px',
        }}
      >
        Expandable Sections
      </Typography>
      <BasicUsageSection />
      <WithIconsSection />
      <MonospaceSection />
      <PropsSection />
    </>
  );
}
