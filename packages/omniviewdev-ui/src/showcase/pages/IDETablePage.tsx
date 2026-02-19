import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import { IDETable } from '../../table';

// --- Sample data ---

interface Pod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  cpu: string;
  memory: string;
  age: string;
  node: string;
}

const pods: Pod[] = [
  { name: 'nginx-deployment-abc123', namespace: 'default', status: 'Running', restarts: 0, cpu: '10m', memory: '64Mi', age: '2d', node: 'node-1' },
  { name: 'redis-master-0', namespace: 'cache', status: 'Running', restarts: 1, cpu: '50m', memory: '128Mi', age: '5d', node: 'node-2' },
  { name: 'api-gateway-xyz789', namespace: 'default', status: 'Running', restarts: 0, cpu: '25m', memory: '96Mi', age: '1d', node: 'node-1' },
  { name: 'postgres-0', namespace: 'database', status: 'Running', restarts: 0, cpu: '100m', memory: '256Mi', age: '14d', node: 'node-3' },
  { name: 'worker-batch-def456', namespace: 'jobs', status: 'CrashLoopBackOff', restarts: 12, cpu: '0m', memory: '32Mi', age: '3h', node: 'node-2' },
  { name: 'prometheus-server-0', namespace: 'monitoring', status: 'Running', restarts: 0, cpu: '200m', memory: '512Mi', age: '30d', node: 'node-1' },
  { name: 'grafana-abc000', namespace: 'monitoring', status: 'Running', restarts: 2, cpu: '15m', memory: '80Mi', age: '30d', node: 'node-3' },
  { name: 'cert-manager-xyz111', namespace: 'cert-manager', status: 'Running', restarts: 0, cpu: '5m', memory: '48Mi', age: '60d', node: 'node-1' },
  { name: 'ingress-nginx-abc222', namespace: 'ingress', status: 'Running', restarts: 0, cpu: '30m', memory: '120Mi', age: '45d', node: 'node-2' },
  { name: 'fluent-bit-ds-node1', namespace: 'logging', status: 'Pending', restarts: 0, cpu: '0m', memory: '0Mi', age: '1m', node: 'node-1' },
];

const statusColor: Record<string, string> = {
  Running: 'var(--ov-success-default)',
  CrashLoopBackOff: 'var(--ov-danger-default)',
  Pending: 'var(--ov-warning-default)',
};

const columns: ColumnDef<Pod, any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 240,
    cell: ({ getValue }) => (
      <Box component="span" sx={{ fontFamily: 'var(--ov-font-mono)', fontWeight: 500 }}>
        {getValue() as string}
      </Box>
    ),
  },
  {
    accessorKey: 'namespace',
    header: 'Namespace',
    size: 100,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
    cell: ({ getValue }) => {
      const status = getValue() as string;
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor[status] ?? 'var(--ov-fg-faint)' }} />
          {status}
        </Box>
      );
    },
  },
  { accessorKey: 'restarts', header: 'Restarts', size: 70 },
  { accessorKey: 'cpu', header: 'CPU', size: 60 },
  { accessorKey: 'memory', header: 'Memory', size: 70 },
  { accessorKey: 'age', header: 'Age', size: 60 },
  { accessorKey: 'node', header: 'Node', size: 80 },
];

export default function IDETablePage() {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const selectedCount = Object.keys(selection).length;

  const smallColumns = useMemo<ColumnDef<Pod, any>[]>(() => [
    { accessorKey: 'name', header: 'Name', size: 200 },
    { accessorKey: 'namespace', header: 'Namespace', size: 100 },
    { accessorKey: 'status', header: 'Status', size: 100 },
    { accessorKey: 'age', header: 'Age', size: 60 },
  ], []);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        IDETable
      </Typography>

      <Section title="IDETable" description="Ultra-compact data table optimized for IDE layouts. Built on TanStack React Table with 30px rows, sticky headers, integrated search, and row selection.">
        <ImportStatement code="import { IDETable } from '@omniviewdev/ui/table';" />

        <Example title="Full-Featured: Kubernetes Pods">
          <Box sx={{ height: 400, display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <IDETable
              columns={columns}
              data={pods}
              selection
              selectedRows={selection}
              onSelectionChange={setSelection}
              searchable
              countLabel={`${pods.length} Pods`}
              toolbar={
                selectedCount > 0 ? (
                  <Chip
                    size="small"
                    label={`${selectedCount} selected`}
                    onDelete={() => setSelection({})}
                    sx={{ fontSize: '0.6875rem' }}
                  />
                ) : undefined
              }
              onRowClick={(row) => console.log('Clicked:', row.name)}
            />
          </Box>
        </Example>

        <Example title="Loading State">
          <Box sx={{ height: 300, display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <IDETable
              columns={smallColumns}
              data={[]}
              loading
              skeletonRows={6}
              countLabel="Pods"
            />
          </Box>
        </Example>

        <Example title="Empty State">
          <Box sx={{ height: 200, display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <IDETable
              columns={smallColumns}
              data={[]}
              searchable
              countLabel="0 Pods"
              emptyState={
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.8125rem', color: 'var(--ov-fg-muted)', mb: 0.5 }}>
                    No pods found
                  </Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: 'var(--ov-fg-faint)' }}>
                    Try adjusting your search or namespace filter
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Example>

        <Example title="Minimal (No Search, No Selection)">
          <Box sx={{ height: 280, display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <IDETable
              columns={smallColumns}
              data={pods.slice(0, 5)}
              rowHeight={26}
            />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
