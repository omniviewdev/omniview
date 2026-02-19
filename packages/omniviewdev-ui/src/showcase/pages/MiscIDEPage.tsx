import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { LuServer, LuBox, LuContainer, LuCircleCheck, LuCircleAlert, LuClock } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import { FileIcon, TruncatedList, EmptySearch, LoadingOverlay, Kbd } from '../..';
import { ErrorOverlay } from '../../overlays';
import { ResourceBreadcrumb } from '../../domain';
import type { BreadcrumbSegment } from '../../domain';

const files = [
  'main.go', 'vite.config.ts', 'package.json', 'Dockerfile', 'README.md',
  'styles.css', 'index.html', 'app.py', 'Cargo.toml', 'schema.sql',
  'config.yaml', 'image.png', '.env', 'script.sh', 'types.proto',
];

const labels = ['app=nginx', 'env=production', 'team=backend', 'version=v2', 'tier=frontend', 'region=us-east-1', 'managed-by=helm'];

const breadcrumbSegments: BreadcrumbSegment[] = [
  { kind: 'cluster', label: 'prod-cluster', icon: <LuServer size={12} /> },
  { kind: 'namespace', label: 'default', icon: <LuBox size={12} /> },
  { kind: 'deployment', label: 'nginx-deployment', icon: <LuContainer size={12} /> },
];

export default function MiscIDEPage() {
  const [loadingActive, setLoadingActive] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Miscellaneous IDE Components
      </Typography>

      <Section title="FileIcon" description="Maps file extensions to appropriate icons and colors.">
        <ImportStatement code="import { FileIcon } from '@omniviewdev/ui';" />

        <Example title="File Extension Icons">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {files.map((f) => (
              <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FileIcon filename={f} size="md" />
                <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-default)' }}>{f}</Typography>
              </Box>
            ))}
          </Box>
        </Example>

        <Example title="Sizes">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FileIcon filename="main.go" size="xs" />
            <FileIcon filename="main.go" size="sm" />
            <FileIcon filename="main.go" size="md" />
            <FileIcon filename="main.go" size="lg" />
            <FileIcon filename="main.go" size="xl" />
          </Box>
        </Example>
      </Section>

      <Section title="TruncatedList" description="Shows first N items + '+X more' chip. Expanding reveals all.">
        <ImportStatement code="import { TruncatedList } from '@omniviewdev/ui';" />

        <Example title="Label Chips">
          <TruncatedList
            items={labels}
            maxVisible={3}
            renderItem={(item, i) => (
              <Chip key={i} label={String(item)} size="small" sx={{ fontSize: 'var(--ov-text-xs)' }} />
            )}
          />
        </Example>
      </Section>

      <Section title="EmptySearch" description="'No results' state with optional suggestion chips.">
        <ImportStatement code="import { EmptySearch } from '@omniviewdev/ui';" />

        <Example title="With Suggestions">
          <EmptySearch
            query="nginx-deploymnet"
            suggestions={['nginx-deployment', 'nginx-service', 'nginx-configmap']}
          />
        </Example>
      </Section>

      <Section title="LoadingOverlay" description="Semi-transparent overlay with spinner on top of children.">
        <ImportStatement code="import { LoadingOverlay } from '@omniviewdev/ui';" />

        <Example title="Interactive">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Chip
              label={loadingActive ? 'Click to stop loading' : 'Click to show loading'}
              onClick={() => setLoadingActive(!loadingActive)}
              sx={{ alignSelf: 'flex-start', cursor: 'pointer' }}
            />
            <LoadingOverlay active={loadingActive} label="Loading resources..." blur>
              <Box sx={{ p: 3, border: '1px solid var(--ov-border-default)', borderRadius: '6px', height: 120 }}>
                <Typography sx={{ color: 'var(--ov-fg-default)', fontSize: 'var(--ov-text-sm)' }}>
                  Content behind the overlay
                </Typography>
              </Box>
            </LoadingOverlay>
          </Box>
        </Example>
      </Section>

      <Section title="Kbd" description="Convenience wrapper for HotkeyHint. Parses shortcut strings like 'Cmd+Shift+P'.">
        <ImportStatement code="import { Kbd } from '@omniviewdev/ui';" />

        <Example title="Keyboard Shortcuts">
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Kbd shortcut="Meta+Shift+P" />
            <Kbd shortcut="Meta+S" />
            <Kbd shortcut="Control+C" />
            <Kbd shortcut="Escape" />
            <Kbd shortcut="Enter" />
          </Box>
        </Example>
      </Section>

      <Section title="ErrorOverlay" description="Dismissable blurred-backdrop error overlay with file/line info and action buttons.">
        <ImportStatement code="import { ErrorOverlay } from '@omniviewdev/ui/overlays';" />

        <Example title="Interactive">
          <Chip label="Show Error Overlay" onClick={() => setErrorOpen(true)} sx={{ cursor: 'pointer' }} />
          <ErrorOverlay
            open={errorOpen}
            onClose={() => setErrorOpen(false)}
            title="Plugin Build Error"
            message="Cannot find module '@omniviewdev/runtime' or its corresponding type declarations."
            file="plugins/kubernetes/ui/src/entry.ts"
            line={3}
            stack={`Error: Cannot find module '@omniviewdev/runtime'\n    at resolveModule (vite.config.ts:42)\n    at transformImport (plugin.ts:118)\n    at Object.transform (plugin.ts:85)`}
            actions={[
              { label: 'Open File', onClick: () => {} },
            ]}
          />
        </Example>
      </Section>

      <Section title="ResourceBreadcrumb" description="Resource path breadcrumb: Cluster > Namespace > Kind > Name.">
        <ImportStatement code="import { ResourceBreadcrumb } from '@omniviewdev/ui/domain';" />

        <Example title="Kubernetes Resource Path">
          <ResourceBreadcrumb
            segments={breadcrumbSegments}
            onNavigate={(seg) => alert(`Navigate to: ${seg.label}`)}
          />
        </Example>

        <Example title="With Status Icons">
          <ResourceBreadcrumb
            segments={[
              { kind: 'cluster', label: 'prod', icon: <LuCircleCheck size={12} color="var(--ov-success-default)" /> },
              { kind: 'namespace', label: 'monitoring', icon: <LuCircleAlert size={12} color="var(--ov-warning-default)" /> },
              { kind: 'pod', label: 'grafana-abc123', icon: <LuClock size={12} color="var(--ov-info-default)" /> },
            ]}
            size="md"
          />
        </Example>
      </Section>
    </Box>
  );
}
