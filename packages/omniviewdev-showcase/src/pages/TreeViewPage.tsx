import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { LuFolder, LuFile, LuFileCode } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { TreeView } from '@omniviewdev/ui/navigation';
import type { TreeNode } from '@omniviewdev/ui/navigation';

const sampleNodes: TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    icon: <LuFolder size={14} />,
    children: [
      {
        id: 'src/components',
        label: 'components',
        icon: <LuFolder size={14} />,
        children: [
          { id: 'src/components/Button.tsx', label: 'Button.tsx', icon: <LuFileCode size={14} /> },
          { id: 'src/components/Input.tsx', label: 'Input.tsx', icon: <LuFileCode size={14} /> },
        ],
      },
      {
        id: 'src/utils',
        label: 'utils',
        icon: <LuFolder size={14} />,
        children: [
          { id: 'src/utils/format.ts', label: 'format.ts', icon: <LuFile size={14} /> },
        ],
      },
      { id: 'src/index.ts', label: 'index.ts', icon: <LuFile size={14} />, badge: <Chip label="entry" size="small" sx={{ height: 16, fontSize: 10 }} /> },
    ],
  },
  {
    id: 'package.json',
    label: 'package.json',
    icon: <LuFile size={14} />,
  },
  {
    id: 'tsconfig.json',
    label: 'tsconfig.json',
    icon: <LuFile size={14} />,
    disabled: true,
  },
];

export default function TreeViewPage() {
  const [selected, setSelected] = useState<string | undefined>();
  const [checkSelected, setCheckSelected] = useState<string | undefined>();

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        TreeView
      </Typography>

      <Section title="TreeView" description="Recursive tree with expand/collapse, selection, and optional checkboxes.">
        <ImportStatement code="import { TreeView } from '@omniviewdev/ui/navigation';" />

        <Example title="Basic Tree">
          <Box sx={{ maxWidth: 360, border: '1px solid var(--ov-border-default)', borderRadius: 1, p: 1 }}>
            <TreeView
              nodes={sampleNodes}
              selected={selected}
              onSelect={setSelected}
            />
          </Box>
          {selected && (
            <Typography variant="body2" sx={{ mt: 1, color: 'var(--ov-fg-muted)' }}>
              Selected: {selected}
            </Typography>
          )}
        </Example>

        <Example title="With Checkboxes">
          <Box sx={{ maxWidth: 360, border: '1px solid var(--ov-border-default)', borderRadius: 1, p: 1 }}>
            <TreeView
              nodes={sampleNodes}
              selected={checkSelected}
              onSelect={setCheckSelected}
              checkboxes
            />
          </Box>
        </Example>

        <Example title="Lazy Loading" description="Expands load children asynchronously.">
          <Box sx={{ maxWidth: 360, border: '1px solid var(--ov-border-default)', borderRadius: 1, p: 1 }}>
            <TreeView
              nodes={[
                { id: 'lazy-1', label: 'Click to expand (lazy)', icon: <LuFolder size={14} />, children: [] },
                { id: 'lazy-2', label: 'Another lazy node', icon: <LuFolder size={14} />, children: [] },
              ]}
              lazyLoad
              onLoadChildren={async (id) => {
                await new Promise((r) => setTimeout(r, 1000));
                return [
                  { id: `${id}/child-1`, label: 'Loaded child 1', icon: <LuFile size={14} /> },
                  { id: `${id}/child-2`, label: 'Loaded child 2', icon: <LuFile size={14} /> },
                ];
              }}
            />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'nodes', type: 'TreeNode[]', description: 'Tree data (id, label, icon, children, badge, disabled)' },
            { name: 'selected', type: 'string', description: 'Currently selected node id' },
            { name: 'onSelect', type: '(id: string) => void', description: 'Selection handler' },
            { name: 'expanded', type: 'string[]', description: 'Controlled expanded node ids' },
            { name: 'onToggle', type: '(id: string) => void', description: 'Expand/collapse handler' },
            { name: 'checkboxes', type: 'boolean', default: 'false', description: 'Show checkboxes' },
            { name: 'lazyLoad', type: 'boolean', default: 'false', description: 'Load children on expand' },
            { name: 'onLoadChildren', type: '(id: string) => Promise<TreeNode[]>', description: 'Async child loader' },
          ]}
        />
      </Section>
    </Box>
  );
}
