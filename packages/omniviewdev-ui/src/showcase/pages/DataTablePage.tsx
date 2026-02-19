import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { createColumnHelper } from '@tanstack/react-table';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { DataTable, TableToolbar, TableSkeleton } from '../../table';

interface Pod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  age: string;
}

const sampleData: Pod[] = [
  { name: 'nginx-abc123', namespace: 'default', status: 'Running', restarts: 0, age: '2d' },
  { name: 'redis-xyz789', namespace: 'cache', status: 'Running', restarts: 1, age: '5h' },
  { name: 'api-server-def456', namespace: 'backend', status: 'CrashLoopBackOff', restarts: 12, age: '1h' },
  { name: 'postgres-ghi012', namespace: 'database', status: 'Running', restarts: 0, age: '7d' },
  { name: 'worker-jkl345', namespace: 'default', status: 'Pending', restarts: 0, age: '5m' },
  { name: 'ingress-mno678', namespace: 'networking', status: 'Running', restarts: 0, age: '3d' },
];

const columnHelper = createColumnHelper<Pod>();

const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => <Typography variant="body2" sx={{ fontWeight: 500 }}>{info.getValue()}</Typography>,
  }),
  columnHelper.accessor('namespace', {
    header: 'Namespace',
    cell: (info) => <Chip label={info.getValue()} size="small" variant="outlined" />,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = info.getValue();
      const color = s === 'Running' ? 'success' : s === 'Pending' ? 'info' : 'error';
      return <Chip label={s} size="small" color={color} />;
    },
  }),
  columnHelper.accessor('restarts', { header: 'Restarts' }),
  columnHelper.accessor('age', { header: 'Age' }),
];

export default function DataTablePage() {
  const [search, setSearch] = useState('');

  const filteredData = useMemo(() => {
    if (!search) return sampleData;
    return sampleData.filter((p) => p.name.includes(search) || p.namespace.includes(search));
  }, [search]);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        DataTable
      </Typography>

      <Section title="DataTable" description="Full-featured table built on TanStack Table with density, selection, and sorting.">
        <ImportStatement code="import { DataTable, TableToolbar } from '@omniviewdev/ui/table';" />

        <Example title="With Toolbar and Search">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <TableToolbar title="Pods" searchValue={search} onSearch={setSearch} />
            <DataTable
              columns={columns}
              data={filteredData}
              onRowClick={(row) => alert(`Clicked: ${row.name}`)}
            />
          </Box>
        </Example>

        <Example title="Density">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
              <Box key={d}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mb: 0.5, display: 'block' }}>{d}</Typography>
                <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
                  <DataTable columns={columns} data={sampleData.slice(0, 3)} density={d} />
                </Box>
              </Box>
            ))}
          </Box>
        </Example>

        <Example title="Multi-Selection">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <DataTable
              columns={columns}
              data={sampleData}
              selection="multi"
              density="compact"
            />
          </Box>
        </Example>

        <Example title="Expandable Rows">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <DataTable
              columns={columns}
              data={sampleData.slice(0, 3)}
              expandable
              renderDetail={(row) => (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" sx={{ color: 'var(--ov-fg-default)' }}>
                    Pod: {row.name} in namespace {row.namespace}. Status: {row.status}, Restarts: {row.restarts}, Age: {row.age}
                  </Typography>
                </Box>
              )}
            />
          </Box>
        </Example>

        <Example title="Loading State">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <DataTable columns={columns} data={[]} loading />
          </Box>
        </Example>

        <Example title="Empty State">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <DataTable
              columns={columns}
              data={[]}
              emptyState={
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>No pods found</Typography>
                  <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)', mt: 0.5 }}>Try adjusting your search or filters.</Typography>
                </Box>
              }
            />
          </Box>
        </Example>

        <Example title="TableSkeleton">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <TableSkeleton columns={5} rows={4} density="compact" />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'columns', type: 'ColumnDef[]', description: 'TanStack Table column definitions' },
            { name: 'data', type: 'T[]', description: 'Row data array' },
            { name: 'density', type: "'compact' | 'comfortable' | 'spacious'", default: "'comfortable'", description: 'Row height and padding' },
            { name: 'loading', type: 'boolean', default: 'false', description: 'Show skeleton loading state' },
            { name: 'emptyState', type: 'ReactNode', description: 'Content shown when data is empty' },
            { name: 'selection', type: "'none' | 'single' | 'multi'", default: "'none'", description: 'Row selection mode' },
            { name: 'stickyHeader', type: 'boolean', default: 'false', description: 'Stick header on scroll' },
            { name: 'expandable', type: 'boolean', default: 'false', description: 'Enable row expansion' },
            { name: 'renderDetail', type: '(row: T) => ReactNode', description: 'Expanded row content' },
            { name: 'onRowClick', type: '(row: T) => void', description: 'Row click handler' },
          ]}
        />
      </Section>
    </Box>
  );
}
