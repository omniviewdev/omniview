import { Typography, Box, Chip } from '@mui/material';
import { LuServer, LuBox, LuClock, LuActivity, LuDatabase, LuPlug, LuArrowRight, LuImage, LuShield, LuWifi } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import { Card, DetailsCard, StatCard, MediaCard, ActionCard, ListCard, StatusCard } from '../../index';
import type { DetailsCardEntry, ListCardItem } from '../../index';
import KVCard from '../../components/KVCard';
import { Button } from '../../buttons';

// ---------------------------------------------------------------------------
// Card Section
// ---------------------------------------------------------------------------

function CardSection() {
  return (
    <Section
      title="Card"
      description="A general-purpose card with a title bar that supports an optional icon and title decorator. Use it to wrap arbitrary content in a bordered container with a consistent header."
    >
      <ImportStatement code="import { Card } from '@omniviewdev/ui';" />

      <Example title="Basic" description="A card with only a title and text children.">
        <Card title="Pod Details">
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            nginx-deployment-7fb96c846b-4xklm is running on node
            ip-10-0-1-42.ec2.internal and has been healthy for 14 days.
          </Typography>
        </Card>
      </Example>

      <Example title="With Icon (string)" description="Pass an icon-library name string such as 'LuBox' to render an icon in the title bar.">
        <Card title="Containers" icon="LuBox">
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            2 containers running: nginx (port 80), istio-proxy (port 15001).
          </Typography>
        </Card>
      </Example>

      <Example title="With Title Decorator" description="A string or number decorator renders as a Chip beside the title, useful for counts.">
        <Card title="Replicas" titleDecorator={5}>
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            5 of 5 desired replicas are available and ready.
          </Typography>
        </Card>
      </Example>

      <Example title="With ReactNode Icon" description="Pass a ReactNode directly for full control over the icon.">
        <Card
          title="Nodes"
          icon={<LuServer size={14} style={{ color: 'var(--ov-fg-muted)' }} />}
          titleDecorator={
            <Chip
              size="small"
              label="healthy"
              color="success"
              variant="outlined"
              sx={{ borderRadius: '4px' }}
            />
          }
        >
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
            All 3 nodes are in Ready condition with sufficient capacity.
          </Typography>
        </Card>
      </Example>

      <PropsTable
        props={[
          { name: 'title', type: 'string', description: 'Header text displayed in the title bar.' },
          { name: 'icon', type: 'string | ReactNode', description: 'Icon shown before the title. Strings are resolved via the Icon component; URLs render an Avatar.' },
          { name: 'titleDecorator', type: 'string | number | ReactNode', description: 'Element rendered on the right side of the title bar. Primitives render as a Chip.' },
          { name: 'children', type: 'ReactNode', description: 'Content rendered inside the card body.' },
          { name: 'noPadding', type: 'boolean', default: 'false', description: 'Remove body padding (useful when children provide their own).' },
          { name: 'sx', type: 'SxProps', description: 'MUI sx overrides for the root card.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// StatCard Section
// ---------------------------------------------------------------------------

function StatCardSection() {
  return (
    <Section
      title="StatCard"
      description="A metric display card with a prominent value, label, optional trend indicator, and icon. Ideal for dashboards and summary views."
    >
      <ImportStatement code="import { StatCard } from '@omniviewdev/ui';" />

      <Example title="Basic" description="Simple stat with value and label.">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, maxWidth: 720 }}>
          <StatCard value={42} label="Running Pods" color="success" />
          <StatCard value="3.2s" label="Avg Response" color="info" />
          <StatCard value="99.9%" label="Uptime" color="primary" />
        </Box>
      </Example>

      <Example title="With Trend" description="Trend arrows show direction and magnitude.">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, maxWidth: 720 }}>
          <StatCard
            value={128}
            label="Active Connections"
            trend={{ value: 12, label: 'vs last hour' }}
            icon={<LuActivity size={20} />}
            color="primary"
          />
          <StatCard
            value="4.1s"
            label="P99 Latency"
            trend={{ value: -8, label: 'improved' }}
            icon={<LuClock size={20} />}
            color="warning"
          />
          <StatCard
            value={7}
            label="Error Rate"
            trend={{ value: 23, label: 'vs yesterday' }}
            description="Needs attention"
            icon={<LuShield size={20} />}
            color="error"
          />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'value', type: 'string | number', description: 'The large metric value displayed prominently.' },
          { name: 'label', type: 'string', description: 'Label beneath the value.' },
          { name: 'description', type: 'string', description: 'Optional description text.' },
          { name: 'icon', type: 'ReactNode', description: 'Icon displayed in the top-right corner.' },
          { name: 'trend', type: '{ value: number; label?: string }', description: 'Trend indicator: positive shows up arrow, negative shows down arrow.' },
          { name: 'color', type: 'SemanticColor', default: '"primary"', description: 'Accent color for the value.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// MediaCard Section
// ---------------------------------------------------------------------------

function MediaCardSection() {
  return (
    <Section
      title="MediaCard"
      description="A card with a media area (image or ReactNode), title, description, and optional action buttons. Useful for plugin cards, feature tiles, etc."
    >
      <ImportStatement code="import { MediaCard } from '@omniviewdev/ui';" />

      <Example title="With ReactNode Media" description="Pass a ReactNode instead of a URL for the media area.">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, maxWidth: 720 }}>
          <MediaCard
            media={<LuPlug size={40} />}
            mediaHeight={100}
            title="Kubernetes Plugin"
            description="Full cluster management with resource browsing, exec, and logs."
            meta="v2.1.0 — Official"
            actions={<Button emphasis="soft" color="primary" size="sm">Install</Button>}
          />
          <MediaCard
            media={<LuDatabase size={40} />}
            mediaHeight={100}
            title="PostgreSQL Plugin"
            description="Connect to PostgreSQL databases, run queries, and manage schemas."
            meta="v1.3.0 — Community"
            actions={<Button emphasis="soft" color="primary" size="sm">Install</Button>}
          />
          <MediaCard
            media={<LuWifi size={40} />}
            mediaHeight={100}
            title="AWS Plugin"
            description="Manage EC2, S3, Lambda, and other AWS services from one place."
            meta="v0.9.0 — Beta"
            actions={<Button emphasis="soft" color="primary" size="sm">Install</Button>}
          />
        </Box>
      </Example>

      <Example title="Clickable" description="Pass onClick to make the entire card interactive.">
        <Box sx={{ maxWidth: 240 }}>
          <MediaCard
            media={<LuImage size={40} />}
            mediaHeight={80}
            title="Click Me"
            description="This card has a hover effect and cursor pointer."
            onClick={() => {}}
          />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'media', type: 'string | ReactNode', description: 'Image URL or ReactNode for the media area.' },
          { name: 'mediaHeight', type: 'number', default: '140', description: 'Media area height in pixels.' },
          { name: 'title', type: 'string', description: 'Card title.' },
          { name: 'description', type: 'string', description: 'Short description text.' },
          { name: 'meta', type: 'string | ReactNode', description: 'Metadata line (author, date, version).' },
          { name: 'actions', type: 'ReactNode', description: 'Action buttons at the bottom.' },
          { name: 'onClick', type: '() => void', description: 'Click handler for the entire card.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// ActionCard Section
// ---------------------------------------------------------------------------

function ActionCardSection() {
  return (
    <Section
      title="ActionCard"
      description="A card with an icon, title, description, and action buttons. Supports horizontal and vertical layouts. Good for feature discovery, onboarding steps, and CTAs."
    >
      <ImportStatement code="import { ActionCard } from '@omniviewdev/ui';" />

      <Example title="Vertical Layout (default)" description="Icon above, actions below.">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
          <ActionCard
            icon={<LuPlug size={28} />}
            title="Install a Plugin"
            description="Browse the plugin marketplace and extend Omniview with new functionality."
            primaryAction={<Button emphasis="solid" color="primary" size="sm">Browse Plugins</Button>}
            secondaryAction={<Button emphasis="ghost" color="neutral" size="sm">Learn More</Button>}
          />
        </Box>
      </Example>

      <Example title="Horizontal Layout" description="Icon left, actions right — compact row.">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 600 }}>
          <ActionCard
            direction="horizontal"
            icon={<LuDatabase size={24} />}
            title="Connect a Database"
            description="Add a PostgreSQL, MySQL, or Redis connection."
            primaryAction={<Button emphasis="soft" color="primary" size="sm">Connect</Button>}
          />
          <ActionCard
            direction="horizontal"
            icon={<LuServer size={24} />}
            title="Add a Cluster"
            description="Import a kubeconfig to manage your Kubernetes cluster."
            primaryAction={<Button emphasis="soft" color="primary" size="sm">Import</Button>}
          />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'icon', type: 'ReactNode', description: 'Icon displayed before the content.' },
          { name: 'title', type: 'string', description: 'Card title.' },
          { name: 'description', type: 'string', description: 'Description text.' },
          { name: 'primaryAction', type: 'ReactNode', description: 'Primary action element.' },
          { name: 'secondaryAction', type: 'ReactNode', description: 'Secondary action element.' },
          { name: 'direction', type: '"horizontal" | "vertical"', default: '"vertical"', description: 'Layout direction.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// ListCard Section
// ---------------------------------------------------------------------------

function ListCardSection() {
  const recentItems: ListCardItem[] = [
    { key: '1', label: 'nginx-deployment-7fb96c', secondary: 'production', icon: <LuBox size={14} />, onClick: () => {} },
    { key: '2', label: 'redis-master-0', secondary: 'cache', icon: <LuDatabase size={14} />, onClick: () => {} },
    { key: '3', label: 'api-gateway-5d8f9', secondary: 'production', icon: <LuServer size={14} />, onClick: () => {} },
    { key: '4', label: 'worker-batch-job-12', secondary: 'jobs', icon: <LuActivity size={14} />, onClick: () => {} },
  ];

  return (
    <Section
      title="ListCard"
      description="A card with a header and a scrollable list of items. Items can be clickable, show icons, secondary text, and trailing elements."
    >
      <ImportStatement code="import { ListCard } from '@omniviewdev/ui';" />

      <Example title="Recent Resources" description="Clickable items with icons and secondary text.">
        <Box sx={{ maxWidth: 400 }}>
          <ListCard
            title="Recent Resources"
            icon={<LuClock size={14} />}
            headerAction={
              <Chip size="small" variant="outlined" label={recentItems.length} sx={{ borderRadius: '4px' }} />
            }
            items={recentItems}
          />
        </Box>
      </Example>

      <Example title="With Trailing Elements" description="Each item can have a trailing ReactNode.">
        <Box sx={{ maxWidth: 400 }}>
          <ListCard
            title="Quick Actions"
            items={[
              { key: '1', label: 'View Logs', icon: <LuActivity size={14} />, trailing: <LuArrowRight size={14} style={{ color: 'var(--ov-fg-faint)' }} />, onClick: () => {} },
              { key: '2', label: 'Open Terminal', icon: <LuServer size={14} />, trailing: <LuArrowRight size={14} style={{ color: 'var(--ov-fg-faint)' }} />, onClick: () => {} },
              { key: '3', label: 'Port Forward', icon: <LuWifi size={14} />, trailing: <LuArrowRight size={14} style={{ color: 'var(--ov-fg-faint)' }} />, onClick: () => {} },
            ]}
          />
        </Box>
      </Example>

      <Example title="Empty State" description="Shows a message when the list is empty.">
        <Box sx={{ maxWidth: 400 }}>
          <ListCard title="Bookmarks" items={[]} emptyMessage="No bookmarked resources yet." />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'title', type: 'string', description: 'Card header title.' },
          { name: 'icon', type: 'ReactNode', description: 'Icon in the header.' },
          { name: 'headerAction', type: 'ReactNode', description: 'Header right-side element.' },
          { name: 'items', type: 'ListCardItem[]', description: 'List items to display.' },
          { name: 'maxVisible', type: 'number', default: '5', description: 'Max visible items before scrolling.' },
          { name: 'emptyMessage', type: 'string', default: '"No items"', description: 'Text shown when the list is empty.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// StatusCard Section
// ---------------------------------------------------------------------------

function StatusCardSection() {
  return (
    <Section
      title="StatusCard"
      description="A card showing a resource's status prominently with a status dot, description, and optional key-value metadata rows."
    >
      <ImportStatement code="import { StatusCard } from '@omniviewdev/ui';" />

      <Example title="Healthy" description="A healthy resource with metadata.">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, maxWidth: 720 }}>
          <StatusCard
            title="api-gateway"
            icon={<LuServer size={14} />}
            status="healthy"
            statusLabel="Running"
            description="All 3 replicas are available and passing health checks."
            metadata={[
              { label: 'Namespace', value: 'production' },
              { label: 'Replicas', value: '3/3' },
              { label: 'Uptime', value: '14d 6h' },
            ]}
          />
          <StatusCard
            title="redis-primary"
            icon={<LuDatabase size={14} />}
            status="warning"
            statusLabel="Degraded"
            description="Memory usage at 92% of limit. Consider scaling."
            metadata={[
              { label: 'Namespace', value: 'cache' },
              { label: 'Memory', value: '920Mi / 1Gi' },
              { label: 'Connections', value: '847' },
            ]}
          />
        </Box>
      </Example>

      <Example title="Error & Pending" description="Other status states.">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, maxWidth: 720 }}>
          <StatusCard
            title="batch-processor"
            icon={<LuActivity size={14} />}
            status="error"
            statusLabel="CrashLoopBackOff"
            description="Container repeatedly crashing. Check logs for OOM errors."
          />
          <StatusCard
            title="new-deployment"
            icon={<LuBox size={14} />}
            status="pending"
            statusLabel="Deploying"
            description="Rolling update in progress: 1 of 3 replicas ready."
          />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'title', type: 'string', description: 'Resource or service name.' },
          { name: 'icon', type: 'ReactNode', description: 'Icon in the header.' },
          { name: 'status', type: 'Status', description: 'Current status value.' },
          { name: 'statusLabel', type: 'string', description: 'Human-readable status label (defaults to status value).' },
          { name: 'description', type: 'string', description: 'Optional description or summary.' },
          { name: 'metadata', type: 'StatusCardMeta[]', description: 'Key-value metadata rows.' },
          { name: 'headerAction', type: 'ReactNode', description: 'Action elements in the header.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// DetailsCard Section
// ---------------------------------------------------------------------------

function DetailsCardSection() {
  const basicEntries: DetailsCardEntry[] = [
    { key: 'Namespace', value: 'production' },
    { key: 'Image', value: 'nginx:1.25' },
    { key: 'Restart Policy', value: 'Always' },
  ];

  const entriesWithRatios: DetailsCardEntry[] = [
    { key: 'CPU', value: '500m', used: '120m', ratio: [4, 8] },
    { key: 'Memory', value: '256Mi', used: '98Mi', ratio: [4, 8] },
    { key: 'Ephemeral Storage', value: '1Gi', used: '340Mi', ratio: [4, 8] },
  ];

  return (
    <Section
      title="DetailsCard"
      description="A card designed for key-value detail rows with optional icons, grid ratios, and usage displays. Ideal for resource summaries."
    >
      <ImportStatement code="import { DetailsCard } from '@omniviewdev/ui';" />

      <Example title="Basic" description="Three simple key-value entries.">
        <Box sx={{ maxWidth: 420 }}>
          <DetailsCard data={basicEntries} />
        </Box>
      </Example>

      <Example title="With Title and Icon" description="Provide a title and icon string for a labeled header.">
        <Box sx={{ maxWidth: 420 }}>
          <DetailsCard
            title="Pod Spec"
            icon="LuBox"
            data={[
              { key: 'Service Account', value: 'default' },
              { key: 'Node Name', value: 'ip-10-0-1-42.ec2.internal' },
              { key: 'Priority', value: '0' },
            ]}
          />
        </Box>
      </Example>

      <Example title="With Usage Ratios" description="Use the 'used' field to display a used/total format, useful for resource quotas.">
        <Box sx={{ maxWidth: 420 }}>
          <DetailsCard
            title="Resource Requests"
            icon="LuServer"
            data={entriesWithRatios}
          />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'title', type: 'string', description: 'Optional header label for the card.' },
          { name: 'titleSize', type: "'sm' | 'md' | 'lg'", default: "'md'", description: 'Controls the font size of the title.' },
          { name: 'icon', type: 'string | ReactNode', description: 'Icon rendered beside the title.' },
          { name: 'data', type: 'DetailsCardEntry[]', description: 'Array of key-value entry objects to display.' },
          { name: 'endAdornment', type: 'ReactNode', description: 'Element rendered at the trailing edge of the title bar.' },
          { name: 'showUndefined', type: 'boolean', default: 'false', description: 'When true, entries with undefined values are still rendered.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// KVCard Section
// ---------------------------------------------------------------------------

function KVCardSection() {
  return (
    <Section
      title="KVCard"
      description="An accordion-based card for displaying key-value pairs. Shows a count badge and can be expanded or collapsed. Automatically disables when the map is empty."
    >
      <ImportStatement code="import KVCard from '@omniviewdev/ui/components/KVCard';" />

      <Example title="Default Expanded" description="A KVCard with four label pairs, expanded by default.">
        <Box sx={{ maxWidth: 480 }}>
          <KVCard
            title="Labels"
            defaultExpanded
            kvs={{
              'app': 'nginx',
              'env': 'production',
              'team': 'platform',
              'version': 'v1.25.3',
            }}
          />
        </Box>
      </Example>

      <Example title="Collapsed" description="Six annotation pairs in a collapsed accordion.">
        <Box sx={{ maxWidth: 480 }}>
          <KVCard
            title="Annotations"
            kvs={{
              'kubectl.kubernetes.io/last-applied-configuration': '...',
              'deployment.kubernetes.io/revision': '4',
              'kubernetes.io/change-cause': 'image updated to nginx:1.25',
              'prometheus.io/scrape': 'true',
              'prometheus.io/port': '9090',
              'sidecar.istio.io/inject': 'true',
            }}
          />
        </Box>
      </Example>

      <Example title="Empty (Disabled)" description="When the kvs map is empty the accordion is automatically disabled.">
        <Box sx={{ maxWidth: 480 }}>
          <KVCard title="Finalizers" kvs={{}} />
        </Box>
      </Example>

      <PropsTable
        props={[
          { name: 'title', type: 'string', description: 'Accordion summary label.' },
          { name: 'kvs', type: 'Record<string, string>', description: 'Key-value pairs to display inside the accordion.' },
          { name: 'defaultExpanded', type: 'boolean', default: 'false', description: 'Whether the accordion starts in the expanded state.' },
        ]}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CardPage() {
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
        Cards
      </Typography>
      <CardSection />
      <StatCardSection />
      <MediaCardSection />
      <ActionCardSection />
      <ListCardSection />
      <StatusCardSection />
      <DetailsCardSection />
      <KVCardSection />
    </>
  );
}
