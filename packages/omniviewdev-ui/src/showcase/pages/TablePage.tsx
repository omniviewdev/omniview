import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import ColumnFilter from '../../table/ColumnFilter';
import TextCell from '../../cells/TextCell';
import { ChipCell } from '../../cells/ChipCell';

// --- Mock data ---

interface Pod {
  id: string;
  name: string;
  namespace: string;
  status: string;
  age: string;
  restarts: number;
}

const mockPods: Pod[] = [
  { id: '1', name: 'nginx-7d9fc-abcde', namespace: 'default', status: 'Running', age: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), restarts: 0 },
  { id: '2', name: 'redis-master-0', namespace: 'cache', status: 'Running', age: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), restarts: 1 },
  { id: '3', name: 'api-gateway-5f8b2-xyz12', namespace: 'production', status: 'Pending', age: new Date(Date.now() - 5 * 60 * 1000).toISOString(), restarts: 0 },
  { id: '4', name: 'worker-batch-job-9k3m1', namespace: 'jobs', status: 'Failed', age: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), restarts: 5 },
  { id: '5', name: 'monitoring-agent-ds-r7q2', namespace: 'kube-system', status: 'Running', age: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), restarts: 2 },
];

const statusColorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'> = {
  Running: 'success',
  Pending: 'warning',
  Failed: 'danger',
};

// --- Table styles ---

const tableStyles: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--ov-font-ui)',
  fontSize: 'var(--ov-text-sm)',
};

const thStyles: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  color: 'var(--ov-fg-muted)',
  borderBottom: '2px solid var(--ov-border-default)',
  whiteSpace: 'nowrap',
};

const tdStyles: React.CSSProperties = {
  padding: '6px 12px',
  color: 'var(--ov-fg-default)',
  borderBottom: '1px solid var(--ov-border-muted)',
  height: 36,
};

// --- Column definitions ---

const columnHelper = createColumnHelper<Pod>();

const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => <TextCell value={info.getValue()} />,
  }),
  columnHelper.accessor('namespace', {
    header: 'Namespace',
    cell: (info) => <TextCell value={info.getValue()} color="primary" />,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => (
      <ChipCell
        value={info.getValue()}
        colorMap={statusColorMap}
      />
    ),
  }),
  columnHelper.accessor('age', {
    header: 'Age',
    cell: (info) => <TextCell value={info.getValue()} formatter="age" />,
  }),
  columnHelper.accessor('restarts', {
    header: 'Restarts',
    cell: (info) => <TextCell value={info.getValue()} />,
  }),
];

// --- Page ---

export default function TablePage() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | undefined>(undefined);

  const data = useMemo(() => mockPods, []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleColumnFilterClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    setAnchorEl(anchorEl ? undefined : event.currentTarget);
  };

  const handleColumnFilterClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-bold)',
          color: 'var(--ov-fg-base)',
          mb: '32px',
        }}
      >
        Table
      </Typography>

      {/* ---- Full table demo ---- */}
      <Section
        title="TanStack Table with Cells"
        description="A complete table demo using @tanstack/react-table with ColumnFilter, TextCell, and ChipCell. The mock data simulates Kubernetes pods."
      >
        <ImportStatement code={`import { ColumnFilter } from '@omniviewdev/ui/table';
import { TextCell, ChipCell } from '@omniviewdev/ui/cells';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';`} />

        <Example title="Interactive table" description="Click the settings button to toggle column visibility.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Toolbar */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <ColumnFilter
                anchorEl={anchorEl}
                columns={table.getAllLeafColumns()}
                onClick={handleColumnFilterClick}
                onClose={handleColumnFilterClose}
              />
            </Box>

            {/* Table */}
            <Box sx={{ overflowX: 'auto' }}>
              <table style={tableStyles}>
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} style={thStyles}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} style={tdStyles}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Box>
        </Example>
      </Section>

      {/* ---- ColumnFilter props ---- */}
      <Section
        title="ColumnFilter"
        description="A popover button that lets users toggle column visibility in a TanStack Table instance."
      >
        <ImportStatement code="import { ColumnFilter } from '@omniviewdev/ui/table';" />

        <PropsTable
          props={[
            { name: 'anchorEl', type: 'HTMLElement | undefined', description: 'The anchor element for the popover. When set, the popover is open.' },
            { name: 'columns', type: 'Array<Column<any>>', description: 'Array of TanStack Table Column objects. Only columns with getCanHide() === true are shown.' },
            { name: 'onClose', type: '() => void', description: 'Called when the user clicks outside the popover to dismiss it.' },
            { name: 'onClick', type: 'MouseEventHandler<HTMLButtonElement>', description: 'Click handler for the toggle button that opens/closes the popover.' },
          ]}
        />
      </Section>

      {/* ---- Type definitions ---- */}
      <Section
        title="Type Definitions"
        description="Utility types exported from @omniviewdev/ui/table for building custom table integrations."
      >
        <ImportStatement code="import type { Memoizer, IdAccessor } from '@omniviewdev/ui/table';" />

        <Example title="Memoizer" description="Used to derive a memoization key from row data. Can be a property path string, array of paths, or a function.">
          <Box
            sx={{
              p: 2,
              borderRadius: '4px',
              bgcolor: 'var(--ov-bg-surface-inset)',
              fontFamily: 'var(--ov-font-mono)',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--ov-fg-default)',
            }}
          >
            type Memoizer = string | string[] | ((data: any) =&gt; string);
          </Box>
        </Example>

        <Example title="IdAccessor" description="Used to derive a unique row ID from row data. Can be a property path string or a function.">
          <Box
            sx={{
              p: 2,
              borderRadius: '4px',
              bgcolor: 'var(--ov-bg-surface-inset)',
              fontFamily: 'var(--ov-font-mono)',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--ov-fg-default)',
            }}
          >
            type IdAccessor = string | ((data: any) =&gt; string);
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'Memoizer', type: 'string | string[] | ((data: any) => string)', description: 'Derives a memoization key from row data. As a string, it is used as a property path. As an array, multiple paths are joined. As a function, it receives the row data and returns a string key.' },
            { name: 'IdAccessor', type: 'string | ((data: any) => string)', description: 'Derives a unique ID from row data. As a string, it is used as a property path. As a function, it receives the row data and returns a string ID.' },
          ]}
        />
      </Section>
    </Box>
  );
}
