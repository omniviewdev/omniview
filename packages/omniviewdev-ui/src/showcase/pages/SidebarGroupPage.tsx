import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import { LuPlus, LuRefreshCw, LuFile, LuFolder, LuImage, LuFileJson } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { SidebarGroup, SidebarTreeItem } from '../../sidebars';

export default function SidebarGroupPage() {
  const [selected, setSelected] = useState('');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        SidebarGroup & SidebarTreeItem
      </Typography>

      <Section title="SidebarGroup" description="Collapsible group within a SidebarPanel. Think EXPLORER / OUTLINE groups in VS Code.">
        <ImportStatement code="import { SidebarGroup } from '@omniviewdev/ui/sidebars';" />

        <Example title="Basic Groups" description="Collapsible groups with count badges and action icons on hover.">
          <Box sx={{ width: 280, bgcolor: 'var(--ov-bg-surface)', border: '1px solid var(--ov-border-default)', borderRadius: 1, py: 0.5 }}>
            <SidebarGroup
              title="Components"
              count={12}
              actions={
                <>
                  <IconButton size="small" sx={{ width: 18, height: 18 }}><LuPlus size={12} /></IconButton>
                  <IconButton size="small" sx={{ width: 18, height: 18 }}><LuRefreshCw size={12} /></IconButton>
                </>
              }
            >
              <SidebarTreeItem label="Button.tsx" icon={<LuFile size={14} />} selected={selected === 'btn'} onClick={() => setSelected('btn')} />
              <SidebarTreeItem label="Input.tsx" icon={<LuFile size={14} />} selected={selected === 'inp'} onClick={() => setSelected('inp')} />
              <SidebarTreeItem label="Select.tsx" icon={<LuFile size={14} />} selected={selected === 'sel'} onClick={() => setSelected('sel')} />
            </SidebarGroup>

            <SidebarGroup title="Assets" count={4} defaultExpanded={false}>
              <SidebarTreeItem label="logo.png" icon={<LuImage size={14} />} onClick={() => {}} />
              <SidebarTreeItem label="icon.svg" icon={<LuImage size={14} />} onClick={() => {}} />
            </SidebarGroup>

            <SidebarGroup title="Config" count={2}>
              <SidebarTreeItem label="tsconfig.json" icon={<LuFileJson size={14} />} onClick={() => {}} />
              <SidebarTreeItem label="package.json" icon={<LuFileJson size={14} />} onClick={() => {}} />
            </SidebarGroup>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'title', type: 'string', description: 'Group header text.' },
            { name: 'count', type: 'number', description: 'Badge count shown in the header.' },
            { name: 'defaultExpanded', type: 'boolean', default: 'true', description: 'Initial expanded state.' },
            { name: 'actions', type: 'ReactNode', description: 'Action icons shown on header hover.' },
          ]}
        />
      </Section>

      <Section title="SidebarTreeItem" description="Individual tree node for sidebars. Shows indent based on depth, expand/collapse chevron, hover reveals action icons.">
        <ImportStatement code="import { SidebarTreeItem } from '@omniviewdev/ui/sidebars';" />

        <Example title="Tree Structure" description="Nested items with depth indentation and expand/collapse.">
          <Box sx={{ width: 280, bgcolor: 'var(--ov-bg-surface)', border: '1px solid var(--ov-border-default)', borderRadius: 1, py: 0.5 }}>
            <SidebarTreeItem
              label="src"
              icon={<LuFolder size={14} />}
              hasChildren
              expanded
              depth={0}
              selected={selected === 'src'}
              onClick={() => setSelected('src')}
              actions={<IconButton size="small" sx={{ width: 16, height: 16 }}><LuPlus size={10} /></IconButton>}
            />
            <SidebarTreeItem
              label="components"
              icon={<LuFolder size={14} />}
              hasChildren
              expanded
              depth={1}
              selected={selected === 'comp'}
              onClick={() => setSelected('comp')}
            />
            <SidebarTreeItem label="Button.tsx" icon={<LuFile size={14} />} depth={2} selected={selected === 'b'} onClick={() => setSelected('b')} />
            <SidebarTreeItem label="Input.tsx" icon={<LuFile size={14} />} depth={2} selected={selected === 'i'} onClick={() => setSelected('i')} />
            <SidebarTreeItem
              label="utils"
              icon={<LuFolder size={14} />}
              hasChildren
              depth={1}
              selected={selected === 'utils'}
              onClick={() => setSelected('utils')}
            />
            <SidebarTreeItem label="index.ts" icon={<LuFile size={14} />} depth={0} selected={selected === 'idx'} onClick={() => setSelected('idx')} />
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'label', type: 'string', description: 'Item text label.' },
            { name: 'icon', type: 'ReactNode', description: 'Icon before the label.' },
            { name: 'badge', type: 'ReactNode', description: 'Badge element after the label.' },
            { name: 'actions', type: 'ReactNode', description: 'Action icons shown on hover.' },
            { name: 'depth', type: 'number', default: '0', description: 'Nesting level for indentation.' },
            { name: 'selected', type: 'boolean', default: 'false', description: 'Selected (highlighted) state.' },
            { name: 'expanded', type: 'boolean', default: 'false', description: 'Whether children are shown.' },
            { name: 'hasChildren', type: 'boolean', default: 'false', description: 'Shows expand/collapse chevron.' },
            { name: 'onClick', type: '() => void', description: 'Click handler.' },
            { name: 'onToggle', type: '() => void', description: 'Expand/collapse toggle handler.' },
          ]}
        />
      </Section>
    </Box>
  );
}
