import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuFile, LuSettings, LuTerminal } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { DraggableTabs, PersistentTabPanel } from '@omniviewdev/ui/navigation';
import type { DraggableTab } from '@omniviewdev/ui/navigation';

const initialTabs: DraggableTab[] = [
  { id: 'main', label: 'main.go', icon: <LuFile size={12} /> },
  { id: 'config', label: 'vite.config.ts', icon: <LuFile size={12} /> },
  { id: 'settings', label: 'Settings', icon: <LuSettings size={12} /> },
  { id: 'terminal', label: 'Terminal', icon: <LuTerminal size={12} />, closable: false },
];

export default function DraggableTabsPage() {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeId, setActiveId] = useState('main');
  let tabCounter = tabs.length;

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Draggable Tabs
      </Typography>

      <Section title="DraggableTabs" description="Tab strip with drag-to-reorder, close buttons on hover, add button, and context menu slot.">
        <ImportStatement code="import { DraggableTabs } from '@omniviewdev/ui/navigation';" />

        <Example title="Interactive Tabs" description="Drag tabs to reorder, hover to see close buttons, click + to add.">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <DraggableTabs
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={(id) => {
                setTabs((prev) => prev.filter((t) => t.id !== id));
                if (activeId === id && tabs.length > 1) {
                  const idx = tabs.findIndex((t) => t.id === id);
                  setActiveId(tabs[idx > 0 ? idx - 1 : 1]?.id ?? '');
                }
              }}
              onReorder={setTabs}
              onAdd={() => {
                tabCounter++;
                const newTab: DraggableTab = {
                  id: `new-${tabCounter}`,
                  label: `untitled-${tabCounter}`,
                  icon: <LuFile size={12} />,
                };
                setTabs((prev) => [...prev, newTab]);
                setActiveId(newTab.id);
              }}
            />
            <Box sx={{ height: 120, p: 2 }}>
              {tabs.map((tab) => (
                <PersistentTabPanel key={tab.id} value={tab.id} activeValue={activeId}>
                  <Typography sx={{ color: 'var(--ov-fg-muted)', fontSize: 'var(--ov-text-sm)' }}>
                    Content of {tab.label}
                  </Typography>
                </PersistentTabPanel>
              ))}
            </Box>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'tabs', type: 'DraggableTab[]', description: 'Array of tab definitions.' },
            { name: 'activeId', type: 'string', description: 'Currently active tab ID.' },
            { name: 'onSelect', type: '(id: string) => void', description: 'Called when a tab is clicked.' },
            { name: 'onClose', type: '(id: string) => void', description: 'Called when a tab close button is clicked.' },
            { name: 'onReorder', type: '(tabs: DraggableTab[]) => void', description: 'Called with new tab order after drag.' },
            { name: 'onAdd', type: '() => void', description: 'Called when the + button is clicked. Omit to hide.' },
            { name: 'onContextMenu', type: '(id: string, event: MouseEvent) => void', description: 'Right-click handler for tab context menu.' },
            { name: 'maxTabWidth', type: 'number', default: '180', description: 'Maximum tab width in pixels.' },
          ]}
        />
      </Section>

      <Section title="PersistentTabPanel" description="Like TabPanel but uses display:none instead of unmounting. Preserves DOM state (terminals, editors).">
        <ImportStatement code="import { PersistentTabPanel } from '@omniviewdev/ui/navigation';" />
        <PropsTable
          props={[
            { name: 'value', type: 'string', description: 'This panel\'s tab value.' },
            { name: 'activeValue', type: 'string', description: 'Currently active tab value.' },
            { name: 'children', type: 'ReactNode', description: 'Panel content (always in DOM).' },
          ]}
        />
      </Section>
    </Box>
  );
}
