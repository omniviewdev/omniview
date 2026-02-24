import { useState } from 'react';
import { Typography, Box } from '@mui/material';
import { LuActivity } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';
import Chip from '../../components/Chip';

import ExpandableSections from '../../components/ExpandableSections';
import { ExpandableSectionComponent } from '../../components/ExpandableSections';
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
      description="Clean text headers with chevron indicators. No chip wrapping — just typography and icons."
    >
      <ImportStatement
        code={`import { ExpandableSections } from '@omniviewdev/ui';
import type { ExpandableSectionItem } from '@omniviewdev/ui';`}
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
        </Box>
      ),
    },
    {
      title: 'Activity',
      icon: <LuActivity size={16} />,
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
      description="Each section can display an icon. Pass a string name from the icon library (e.g. 'LuBox') or a ReactNode."
    >
      <Example title="String and ReactNode Icons" description="Mix of string icon names and inline ReactNode icons.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Count Badges
// ---------------------------------------------------------------------------

function CountBadgesSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'Labels',
      icon: 'LuTag',
      count: 5,
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {['app=nginx', 'env=production', 'team=platform', 'version=v2', 'tier=frontend'].map((label) => (
            <Typography key={label} variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
              {label}
            </Typography>
          ))}
        </Box>
      ),
    },
    {
      title: 'Annotations',
      icon: 'LuTag',
      count: 2,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            kubectl.kubernetes.io/last-applied-configuration, deployment.kubernetes.io/revision
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Containers',
      icon: 'LuBox',
      count: 3,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            nginx, istio-proxy, fluentd-sidecar
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Count Badges"
      description="The count prop displays a small badge after the title, useful for showing item counts in each section."
    >
      <Example title="Sections with Counts" description="Labels (5), Annotations (2), and Containers (3).">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// End Decorators
// ---------------------------------------------------------------------------

function EndDecoratorsSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'Status',
      icon: 'LuActivity',
      endDecorator: <Chip size="xs" color="success" emphasis="soft" label="Healthy" />,
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            All 3 replicas are running and healthy.
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Security',
      icon: 'LuShield',
      endDecorator: <Chip size="xs" color="warning" emphasis="soft" label="2 Warnings" />,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            Pod is running with elevated privileges. Network policy is missing.
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="End Decorators"
      description="Trailing content in the header row — status chips, action buttons, or any ReactNode."
    >
      <Example title="Status Chips" description="Status badges in the trailing position of each section header.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function VariantsSection() {
  const makeSections = (): ExpandableSection[] => [
    {
      title: 'First Section',
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>Section content here.</Typography>
        </Box>
      ),
    },
    {
      title: 'Second Section',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>More content.</Typography>
        </Box>
      ),
    },
    {
      title: 'Third Section',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>Even more content.</Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Variants"
      description="Three visual variants: bordered (outer border + dividers), plain (dividers only), and flush (no borders or dividers)."
    >
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Example title="bordered (default)" description="Outer border with radius and dividers between sections.">
          <Box sx={{ width: 320 }}>
            <ExpandableSections sections={makeSections()} variant="bordered" />
          </Box>
        </Example>
        <Example title="plain" description="Dividers between sections, no outer border.">
          <Box sx={{ width: 320 }}>
            <ExpandableSections sections={makeSections()} variant="plain" />
          </Box>
        </Example>
        <Example title="flush" description="No borders or dividers — completely flat.">
          <Box sx={{ width: 320 }}>
            <ExpandableSections sections={makeSections()} variant="flush" />
          </Box>
        </Example>
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

function SizesSection() {
  const makeSections = (): ExpandableSection[] => [
    {
      title: 'Section A',
      icon: 'LuBox',
      count: 3,
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 1.5 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>Content.</Typography>
        </Box>
      ),
    },
    {
      title: 'Section B',
      icon: 'LuSettings',
      children: (
        <Box sx={{ p: 1.5 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>Content.</Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Sizes"
      description="Three density levels controlling header height, font size, and icon size."
    >
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Example title="sm (32px)" description="Compact density.">
          <Box sx={{ width: 280 }}>
            <ExpandableSections sections={makeSections()} size="sm" />
          </Box>
        </Example>
        <Example title="md (36px, default)" description="Default density.">
          <Box sx={{ width: 280 }}>
            <ExpandableSections sections={makeSections()} size="md" />
          </Box>
        </Example>
        <Example title="lg (44px)" description="Comfortable density.">
          <Box sx={{ width: 280 }}>
            <ExpandableSections sections={makeSections()} size="lg" />
          </Box>
        </Example>
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Exclusive Mode
// ---------------------------------------------------------------------------

function ExclusiveModeSection() {
  const sections: ExpandableSection[] = [
    {
      title: 'General',
      icon: 'LuSettings',
      defaultExpanded: true,
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            General configuration options for this resource.
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Networking',
      icon: 'LuActivity',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            Network policies and service mesh configuration.
          </Typography>
        </Box>
      ),
    },
    {
      title: 'Security',
      icon: 'LuShield',
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            RBAC policies, pod security standards, and secrets.
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Exclusive Mode"
      description="When exclusive is true, expanding one section automatically collapses all others — classic accordion behavior."
    >
      <Example title="One at a time" description="Try expanding different sections.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} exclusive />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Monospace
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
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)', whiteSpace: 'pre' }}
          >
            {'name: nginx\nimage: nginx:1.25\nports:\n  - containerPort: 80'}
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
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)', whiteSpace: 'pre' }}
          >
            {'- name: config-volume\n  configMap:\n    name: nginx-config'}
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
            sx={{ fontFamily: 'var(--ov-font-mono)', fontSize: 13, color: 'var(--ov-fg-default)', whiteSpace: 'pre' }}
          >
            {'- type: Available\n  status: "True"\n  reason: MinimumReplicasAvailable'}
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Monospace Mode"
      description="Enable monospace to render section titles in a monospace font, useful when titles represent code paths or spec keys."
    >
      <Example title="Spec Paths" description="Section titles styled as YAML spec paths.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSections sections={sections} monospace />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Controlled
// ---------------------------------------------------------------------------

function ControlledSection() {
  const [expandedKey, setExpandedKey] = useState<string | null>('overview');

  const sections: ExpandableSection[] = [
    {
      key: 'overview',
      title: 'Overview',
      expanded: expandedKey === 'overview',
      onExpandedChange: (exp) => setExpandedKey(exp ? 'overview' : null),
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            Controlled section — state managed externally.
          </Typography>
        </Box>
      ),
    },
    {
      key: 'details',
      title: 'Details',
      expanded: expandedKey === 'details',
      onExpandedChange: (exp) => setExpandedKey(exp ? 'details' : null),
      children: (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            Another controlled section.
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Section
      title="Controlled Mode"
      description="Use expanded and onExpandedChange for full control over which sections are open."
    >
      <Example title="External State" description="Expand state managed by parent component.">
        <Box sx={{ maxWidth: 560 }}>
          <Box sx={{ mb: 1, display: 'flex', gap: 1 }}>
            <Chip
              size="sm"
              color={expandedKey === 'overview' ? 'primary' : 'neutral'}
              emphasis={expandedKey === 'overview' ? 'solid' : 'outline'}
              label="Overview"
              onClick={() => setExpandedKey(expandedKey === 'overview' ? null : 'overview')}
            />
            <Chip
              size="sm"
              color={expandedKey === 'details' ? 'primary' : 'neutral'}
              emphasis={expandedKey === 'details' ? 'solid' : 'outline'}
              label="Details"
              onClick={() => setExpandedKey(expandedKey === 'details' ? null : 'details')}
            />
          </Box>
          <ExpandableSections sections={sections} />
        </Box>
      </Example>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Standalone Section
// ---------------------------------------------------------------------------

function StandaloneSection() {
  return (
    <Section
      title="Standalone Section"
      description="ExpandableSection (singular) wraps a single collapsible section with the same styling."
    >
      <ImportStatement
        code={`import { ExpandableSection } from '@omniviewdev/ui';`}
      />

      <Example title="Single Collapsible" description="A standalone bordered section.">
        <Box sx={{ maxWidth: 560 }}>
          <ExpandableSectionComponent
            title="Environment Variables"
            icon="LuSettings"
            count={4}
            defaultExpanded
          >
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>NODE_ENV=production</Typography>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>PORT=3000</Typography>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>LOG_LEVEL=info</Typography>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>DB_HOST=postgres.internal</Typography>
            </Box>
          </ExpandableSectionComponent>
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
          { name: 'variant', type: '"bordered" | "plain" | "flush"', default: '"bordered"', description: 'Visual variant controlling borders and dividers.' },
          { name: 'size', type: '"sm" | "md" | "lg"', default: '"md"', description: 'Size/density controlling header height and font size.' },
          { name: 'monospace', type: 'boolean', default: 'false', description: 'Renders section titles in a monospace font.' },
          { name: 'exclusive', type: 'boolean', default: 'false', description: 'Allow only one section open at a time.' },
          { name: 'sx', type: 'SxProps<Theme>', description: 'sx overrides on the root container.' },
        ]}
      />

      <Box sx={{ mt: 3 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, color: 'var(--ov-fg-base)', mb: '12px' }}
        >
          ExpandableSection (item)
        </Typography>
        <PropsTable
          props={[
            { name: 'key', type: 'string', description: 'Unique key for the section (falls back to index).' },
            { name: 'title', type: 'string | ReactNode', description: 'Title text displayed in the section header.' },
            { name: 'icon', type: 'string | ReactNode', description: 'Icon rendered in the section header. Strings resolve via the Icon component.' },
            { name: 'count', type: 'number', description: 'Count displayed as a small badge after the title.' },
            { name: 'endDecorator', type: 'ReactNode', description: 'Trailing content in the header row (status chips, action buttons).' },
            { name: 'children', type: 'ReactNode', description: 'Content displayed when the section is expanded.' },
            { name: 'defaultExpanded', type: 'boolean', default: 'false', description: 'Whether the section starts expanded (uncontrolled).' },
            { name: 'expanded', type: 'boolean', description: 'Controlled expanded state (overrides defaultExpanded).' },
            { name: 'onExpandedChange', type: '(expanded: boolean) => void', description: 'Callback when expanded state changes.' },
            { name: 'disabled', type: 'boolean', default: 'false', description: 'Disable this section.' },
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
      <CountBadgesSection />
      <EndDecoratorsSection />
      <VariantsSection />
      <SizesSection />
      <ExclusiveModeSection />
      <MonospaceSection />
      <ControlledSection />
      <StandaloneSection />
      <PropsSection />
    </>
  );
}
