import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import {
  LuFiles, LuSearch, LuGitBranch, LuBug, LuBlocks,
  LuSettings, LuUser, LuChevronRight,
} from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { ActivityBar, SidebarPanel, SidebarGroup, SidebarTreeItem } from '../../sidebars';
import type { ActivityBarItem } from '../../sidebars';

const mainItems: ActivityBarItem[] = [
  { id: 'files', icon: <LuFiles size={22} />, label: 'Explorer' },
  { id: 'search', icon: <LuSearch size={22} />, label: 'Search', badge: 3 },
  { id: 'git', icon: <LuGitBranch size={22} />, label: 'Source Control', badge: true },
  { id: 'debug', icon: <LuBug size={22} />, label: 'Debug' },
  { id: 'extensions', icon: <LuBlocks size={22} />, label: 'Extensions' },
];

const bottomItems: ActivityBarItem[] = [
  { id: 'account', icon: <LuUser size={22} />, label: 'Account' },
  { id: 'settings', icon: <LuSettings size={22} />, label: 'Settings' },
];

export default function ActivityBarPage() {
  const [activeId, setActiveId] = useState('files');
  const [selected, setSelected] = useState('src');

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        ActivityBar & SidebarPanel
      </Typography>

      <Section title="ActivityBar" description="VS Code-style vertical icon strip. Active item shows accent indicator bar. Bottom items are pinned to the bottom.">
        <ImportStatement code="import { ActivityBar } from '@omniviewdev/ui/sidebars';" />

        <Example title="With SidebarPanel Composition" description="ActivityBar + SidebarPanel working together as an IDE sidebar.">
          <Box sx={{ display: 'flex', height: 400, border: '1px solid var(--ov-border-default)', borderRadius: 1, overflow: 'hidden' }}>
            <ActivityBar
              items={mainItems}
              activeId={activeId}
              onChange={setActiveId}
              bottomItems={bottomItems}
            />
            <SidebarPanel
              title={activeId === 'files' ? 'Explorer' : activeId === 'search' ? 'Search' : activeId}
              searchable={activeId === 'search'}
              toolbar={
                <IconButton size="small" sx={{ width: 20, height: 20 }}>
                  <LuChevronRight size={14} />
                </IconButton>
              }
            >
              <SidebarGroup title="Open Editors" count={3}>
                <SidebarTreeItem label="App.tsx" selected={selected === 'app'} onClick={() => setSelected('app')} />
                <SidebarTreeItem label="index.ts" selected={selected === 'index'} onClick={() => setSelected('index')} />
                <SidebarTreeItem label="styles.css" selected={selected === 'styles'} onClick={() => setSelected('styles')} />
              </SidebarGroup>
              <SidebarGroup title="Project" count={5} defaultExpanded>
                <SidebarTreeItem
                  label="src"
                  hasChildren
                  expanded
                  depth={0}
                  selected={selected === 'src'}
                  onClick={() => setSelected('src')}
                  icon={<LuFiles size={14} />}
                />
                <SidebarTreeItem label="components" hasChildren depth={1} selected={selected === 'components'} onClick={() => setSelected('components')} />
                <SidebarTreeItem label="Button.tsx" depth={2} selected={selected === 'btn'} onClick={() => setSelected('btn')} />
                <SidebarTreeItem label="Input.tsx" depth={2} selected={selected === 'inp'} onClick={() => setSelected('inp')} />
                <SidebarTreeItem label="package.json" depth={0} selected={selected === 'pkg'} onClick={() => setSelected('pkg')} />
              </SidebarGroup>
            </SidebarPanel>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'items', type: 'ActivityBarItem[]', description: 'Main navigation items.' },
            { name: 'activeId', type: 'string', description: 'Currently active item id.' },
            { name: 'onChange', type: '(id: string) => void', description: 'Called when an item is clicked.' },
            { name: 'position', type: "'left' | 'right'", default: "'left'", description: 'Side of the screen.' },
            { name: 'bottomItems', type: 'ActivityBarItem[]', description: 'Items pinned to the bottom (settings, account).' },
            { name: 'width', type: 'number', default: '48', description: 'Width of the activity bar in pixels.' },
          ]}
        />
      </Section>

      <Section title="SidebarPanel" description="Content panel that sits next to ActivityBar. Has header with title/icon, optional search, toolbar actions, and scrollable content.">
        <ImportStatement code="import { SidebarPanel } from '@omniviewdev/ui/sidebars';" />
        <PropsTable
          props={[
            { name: 'title', type: 'string', description: 'Panel header title.' },
            { name: 'icon', type: 'ReactNode', description: 'Icon next to the title.' },
            { name: 'toolbar', type: 'ReactNode', description: 'Action buttons in the header.' },
            { name: 'searchable', type: 'boolean', default: 'false', description: 'Show search input below header.' },
            { name: 'onSearch', type: '(query: string) => void', description: 'Called when search input changes.' },
            { name: 'badge', type: 'ReactNode', description: 'Badge shown in the header.' },
            { name: 'width', type: 'number | string', default: '260', description: 'Panel width.' },
          ]}
        />
      </Section>
    </Box>
  );
}
