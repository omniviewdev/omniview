import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { PropertyGrid } from '../../sidebars';
import type { PropertyGridItem } from '../../sidebars';

const basicItems: PropertyGridItem[] = [
  { key: 'name', label: 'Name', value: 'nginx-deployment-7d9c5b4f6-2x8kq' },
  { key: 'namespace', label: 'Namespace', value: 'production' },
  { key: 'status', label: 'Status', value: 'Running' },
  { key: 'restarts', label: 'Restarts', value: '0' },
  { key: 'age', label: 'Age', value: '3d 14h' },
  { key: 'node', label: 'Node', value: 'ip-10-0-1-42.ec2.internal' },
  { key: 'ip', label: 'Pod IP', value: '10.244.1.23' },
];

const typedItems: PropertyGridItem[] = [
  { key: 'name', label: 'Name', value: 'my-service', type: 'text' },
  { key: 'ready', label: 'Ready', value: true, type: 'boolean' },
  { key: 'color', label: 'Label Color', value: '#4CAF50', type: 'color' },
  { key: 'image', label: 'Image', value: 'nginx:1.25', type: 'code' },
  { key: 'docs', label: 'Documentation', value: 'View Docs', type: 'link' },
  { key: 'port', label: 'Port', value: '8080', type: 'code' },
  { key: 'protocol', label: 'Protocol', value: 'TCP' },
];

export default function PropertyGridPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        PropertyGrid
      </Typography>

      <Section title="PropertyGrid" description="Two-column key-value display optimized for inspectors and property panels. Alternating row backgrounds with optional inline editing.">
        <ImportStatement code="import { PropertyGrid } from '@omniviewdev/ui/sidebars';" />

        <Example title="Basic" description="Simple key-value display with striped rows.">
          <Box sx={{ maxWidth: 400 }}>
            <PropertyGrid items={basicItems} />
          </Box>
        </Example>

        <Example title="Typed Values" description="Different value types: boolean (checkbox), color (swatch), code (monospace), link (clickable).">
          <Box sx={{ maxWidth: 400 }}>
            <PropertyGrid items={typedItems} />
          </Box>
        </Example>

        <Example title="Two Columns" description="Split items into two side-by-side columns.">
          <PropertyGrid items={basicItems} columns={2} />
        </Example>

        <Example title="Editable" description="Double-click a value to edit inline.">
          <Box sx={{ maxWidth: 400 }}>
            <PropertyGrid
              items={basicItems}
              editable
              onEdit={(key, value) => console.log('Edit:', key, value)}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'items', type: 'PropertyGridItem[]', description: 'Array of key-value items to display.' },
            { name: 'columns', type: '1 | 2', default: '1', description: 'Number of columns.' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: 'Controls font size and row height.' },
            { name: 'editable', type: 'boolean', default: 'false', description: 'Enable inline editing on double-click.' },
            { name: 'onEdit', type: '(key: string, value: string) => void', description: 'Called when a value is edited.' },
          ]}
        />
      </Section>
    </Box>
  );
}
